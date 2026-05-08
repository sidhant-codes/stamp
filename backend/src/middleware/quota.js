const Usage = require('../models/usage');
const { DAILY_AI_LIMIT } = require('../config/env');

const today = () => new Date().toISOString().slice(0, 10);

const nextReset = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
};

const bump = (user) =>
  Usage.findOneAndUpdate({ user, day: today() }, { $inc: { count: 1 } }, { upsert: true, returnDocument: 'after' });

// Atomically takes one unit of today's quota. Controllers call req.refundQuota() when the AI call
// does not produce a result, so failures never cost the user anything.
exports.requireQuota = async (req, res, next) => {
  try {
    let usage;
    try {
      usage = await bump(req.user._id);
    } catch (err) {
      // Two first-ever requests of the day can race on the unique index; the loser just retries.
      if (err.code !== 11000) throw err;
      usage = await bump(req.user._id);
    }
    req.refundQuota = () =>
      Usage.updateOne({ _id: usage._id }, { $inc: { count: -1 } })
        .then(() => {})
        .catch((e) => require('../config/logger').error({ err: e }, 'Quota refund failed'));

    if (usage.count > DAILY_AI_LIMIT) {
      await req.refundQuota();
      return res.status(429).json({
        message: `Daily limit of ${DAILY_AI_LIMIT} AI requests reached. Try again after midnight UTC.`,
        resetAt: nextReset().toISOString(),
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};
