// Accounts created before email verification existed have emailVerified undefined and stay allowed.
exports.requireVerified = (req, res, next) =>
  req.user.emailVerified === false
    ? res.status(403).json({ message: 'Please verify your email first. Check your inbox for the link.' })
    : next();
