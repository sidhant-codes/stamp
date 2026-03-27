const mongoose = require('mongoose');

const ResumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    resume_name: { type: String, required: true },
    job_desc: { type: String, required: true },
    resume_text: { type: String, select: false }, // extracted PDF text, used only by "improve"; kept out of listings
    hash: String, // sha256(resume text + job description): identical re-analyses reuse the saved result
    score: { type: Number, min: 0, max: 100 },
    feedback: String,
    strengths: [String],
    gaps: [String],
    keywords_matched: [String],
    keywords_missing: [String],
    suggestions: [{ _id: false, gap: String, tip: String, rewrite: String }],
    checks: [{ _id: false, label: String, pass: Boolean, detail: String }], // ATS checklist, computed in code
  },
  { timestamps: true }
);
ResumeSchema.index({ user: 1, hash: 1 });

module.exports = mongoose.model('resume', ResumeSchema);
