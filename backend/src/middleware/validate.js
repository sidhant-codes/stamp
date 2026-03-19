const { TEMPLATES } = require('../services/export');

const MAX_JOB_DESC = 6000;

const bad = (res, message) => res.status(400).json({ message });
const str = (v) => (typeof v === 'string' ? v.trim() : '');
exports.isTemplate = (t) => typeof t === 'string' && Object.hasOwn(TEMPLATES, t);

// Runs after multer, so req.file / req.body are populated.
exports.analyzeInput = (req, res, next) => {
  const jobDesc = str(req.body?.job_desc);
  if (!req.file || !jobDesc) return bad(res, 'Resume PDF and job description are required');
  if (jobDesc.length > MAX_JOB_DESC) return bad(res, `Job description must be at most ${MAX_JOB_DESC} characters`);
  next();
};

const PROFILE_FIELDS = ['name', 'contact', 'skills', 'experience', 'projects', 'education'];
const MAX_PROFILE_FIELD = 4000;

// Only known text fields, each size-capped, ever reach the AI (it bills per token).
exports.generateInput = (req, res, next) => {
  const body = req.body || {};
  const picked = {};
  for (const key of [...PROFILE_FIELDS, 'job_desc']) {
    if (body[key] === undefined || body[key] === null) continue;
    if (typeof body[key] !== 'string') return bad(res, `${key} must be text`);
    picked[key] = body[key];
  }
  if (!str(picked.name) || !str(picked.skills)) return bad(res, 'Name and skills are required');
  for (const key of PROFILE_FIELDS) {
    if (picked[key]?.length > MAX_PROFILE_FIELD) return bad(res, `${key} must be at most ${MAX_PROFILE_FIELD} characters`);
  }
  if (str(picked.job_desc).length > MAX_JOB_DESC) return bad(res, `Job description must be at most ${MAX_JOB_DESC} characters`);
  if (body.template !== undefined) {
    if (!exports.isTemplate(body.template)) return bad(res, 'Unknown template');
    picked.template = body.template; // styling only, never sent to the AI
  }
  req.body = picked;
  next();
};
