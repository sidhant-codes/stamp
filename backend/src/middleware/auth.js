const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const User = require('../models/user');

// Reads "Authorization: Bearer <jwt>" and loads the DB user as req.user.
exports.requireUser = async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ message: 'Please log in' });
  try {
    const { id, v = 0 } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(id);
    if (!user) return res.status(401).json({ message: 'User no longer exists' });
    if (v !== user.tokenVersion) {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }
    next(err);
  }
};

exports.requireAdmin = [
  exports.requireUser,
  (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).json({ message: 'Admins only' }),
];
