const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const mail = require('../services/mail');
const logger = require('../config/logger');
const Resume = require('../models/resume');
const Generated = require('../models/generated');
const Usage = require('../models/usage');
const { JWT_SECRET, ADMIN_EMAILS, CLIENT_ORIGIN } = require('../config/env');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sign = (user) => jwt.sign({ id: user._id, v: user.tokenVersion }, JWT_SECRET, { expiresIn: '24h' });
const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, emailVerified: u.emailVerified !== false });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// Stores a fresh single-use verification token for the user and emails the link.
async function sendVerification(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { verifyTokenHash: sha256(token), verifyTokenExpires: new Date(Date.now() + VERIFY_TTL_MS) });
  const link = `${CLIENT_ORIGIN}/verify?token=${token}&email=${encodeURIComponent(user.email)}`;
  mail.sendVerifyEmail(user.email, link).catch((e) => logger.error({ err: e }, 'Verification email failed'));
}

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!EMAIL.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (await User.exists({ email: email.trim().toLowerCase() })) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 10),
      role: ADMIN_EMAILS.includes(email.trim().toLowerCase()) ? 'admin' : 'user',
      emailVerified: false,
    });
    await sendVerification(user);
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').trim().toLowerCase() }).select('+password');
    if (!user || !(await bcrypt.compare(password || '', user.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

exports.me = (req, res) => res.json({ user: publicUser(req.user) });

const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_COOLDOWN_MS = 5 * 60 * 1000; // no new link/email while the last one is this fresh

// Always answers the same way so it cannot be used to find out who has an account.
exports.forgot = async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = email && (await User.findOne({ email }).select('+resetTokenExpires'));
    const justIssued = user?.resetTokenExpires && user.resetTokenExpires.getTime() > Date.now() + RESET_TTL_MS - RESET_COOLDOWN_MS;
    if (user && !justIssued) {
      const token = crypto.randomBytes(32).toString('hex');
      await User.updateOne(
        { _id: user._id },
        { resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + RESET_TTL_MS) }
      );
      const link = `${CLIENT_ORIGIN}/reset?token=${token}&email=${encodeURIComponent(email)}`;
      mail.sendResetEmail(email, link).catch((e) => logger.error({ err: e }, 'Reset email failed'));
    }
    res.json({ message: 'If that email is registered, a reset link has been sent' });
  } catch (err) {
    next(err);
  }
};

exports.reset = async (req, res, next) => {
  try {
    const { email, token, password } = req.body || {};
    if ([email, token, password].some((v) => typeof v !== 'string' || !v)) {
      return res.status(400).json({ message: 'Email, token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    // One atomic update: only matches a live, unused token for this exact email, and consumes it.
    const user = await User.findOneAndUpdate(
      { email: email.trim().toLowerCase(), resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } },
      {
        $set: { password: await bcrypt.hash(password, 10) },
        $unset: { resetTokenHash: 1, resetTokenExpires: 1 },
        $inc: { tokenVersion: 1 },
      }
    );
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' });
    res.json({ message: 'Password updated, please log in' });
  } catch (err) {
    next(err);
  }
};

// Consumes a live verification token for this exact email.
exports.verify = async (req, res, next) => {
  try {
    const { email, token } = req.body || {};
    if ([email, token].some((v) => typeof v !== 'string' || !v)) {
      return res.status(400).json({ message: 'Email and token are required' });
    }
    const user = await User.findOneAndUpdate(
      { email: email.trim().toLowerCase(), verifyTokenHash: sha256(token), verifyTokenExpires: { $gt: new Date() } },
      { $set: { emailVerified: true }, $unset: { verifyTokenHash: 1, verifyTokenExpires: 1 } }
    );
    if (!user) return res.status(400).json({ message: 'This verification link is invalid or has expired' });
    res.json({ message: 'Email verified' });
  } catch (err) {
    next(err);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    if (req.user.emailVerified !== false) return res.json({ message: 'Already verified' });
    await sendVerification(req.user);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    next(err);
  }
};

// Deletes the account and everything it owns. Requires the password so a stolen session can't do it.
exports.deleteMe = async (req, res, next) => {
  try {
    const password = req.body?.password;
    const user = await User.findById(req.user._id).select('+password');
    if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Incorrect password' });
    }
    await Promise.all([
      Resume.deleteMany({ user: user._id }),
      Generated.deleteMany({ user: user._id }),
      Usage.deleteMany({ user: user._id }),
    ]);
    await User.deleteOne({ _id: user._id });
    res.json({ message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
};
