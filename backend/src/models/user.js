const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    tokenVersion: { type: Number, default: 0 }, // bumped on password reset; invalidates older JWTs
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    // Left undefined for accounts created before verification existed; only an explicit false is blocked.
    emailVerified: Boolean,
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('user', UserSchema);
