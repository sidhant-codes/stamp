const logger = require('../config/logger');

exports.errorHandler = (err, req, res, next) => {
  (req.log || logger).error(err);
  const known = err.name === 'MulterError' || err.message === 'Only PDF allowed';
  const status = known ? 400 : err.status >= 400 && err.status < 500 ? err.status : err.status === 502 ? 502 : 500;
  // Never leak internal error text to clients in production.
  const message = status === 500 && process.env.NODE_ENV === 'production' ? 'Server error' : err.message || 'Server error';
  res.status(status).json({ message });
};
