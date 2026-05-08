const mongoose = require('mongoose');

// One document per user per UTC day; `count` is the number of AI calls made.
const UsageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 }, // TTL: old days clean themselves up
});
UsageSchema.index({ user: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('usage', UsageSchema);
