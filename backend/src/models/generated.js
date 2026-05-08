const mongoose = require('mongoose');
const { TEMPLATES } = require('../services/export');

// A resume written by the generator (Markdown), editable by its owner.
const GeneratedSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    name: { type: String, required: true },
    content: { type: String, required: true, maxlength: 20000 },
    template: { type: String, enum: Object.keys(TEMPLATES), default: 'modern' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('generated', GeneratedSchema);
