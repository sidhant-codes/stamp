const rateLimit = require('express-rate-limit');

const base = { standardHeaders: true, legacyHeaders: false };
const tooMany = (message) => (req, res) => res.status(429).json({ message });

// login / register / forgot / reset share one counter per IP (brute force + email spam guard).
exports.authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: tooMany('Too many attempts, please try again in a few minutes'),
});

// Backstop for every /api request, keyed by IP.
exports.ipLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 120,
  handler: tooMany('Too many requests, please slow down'),
});

// Per logged-in user. Mount AFTER requireUser so req.user is verified, never from a raw header.
exports.userLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => String(req.user._id),
  handler: tooMany('Too many requests, please slow down'),
});
