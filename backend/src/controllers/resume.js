const crypto = require('crypto');
const mongoose = require('mongoose');
const Resume = require('../models/resume');
const Generated = require('../models/generated');
const { extractText } = require('../services/pdf');
const ai = require('../services/ai');
const exporter = require('../services/export');
const ats = require('../services/ats');
const { isTemplate } = require('../middleware/validate');

const MAX_ANALYSES = 100; // per user; oldest are dropped
const MAX_GENERATED = 50;

// Keeps only the newest `max` documents of a user's collection.
async function trim(Model, user, max) {
  const old = await Model.find({ user }).sort({ createdAt: -1 }).skip(max).select('_id');
  if (old.length) await Model.deleteMany({ _id: { $in: old.map((d) => d._id) } });
}

// ?page=1&limit=20 (limit capped at 50) -> { items, total, page, pages }
async function paginate(Model, filter, query, populate) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const total = await Model.countDocuments(filter);
  let q = Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  if (populate) q = q.populate(populate);
  return { items: await q, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

const validId = (id) => mongoose.isValidObjectId(id);

const hashOf = (text, jobDesc) => crypto.createHash('sha256').update(`${text}\0${jobDesc}`).digest('hex');

// Stores an analysis result (with the text it was made from, so it can be improved later).
async function saveAnalysis(user, name, text, jobDesc, result) {
  const doc = await Resume.create({
    user,
    resume_name: name,
    job_desc: jobDesc,
    resume_text: text,
    hash: hashOf(text, jobDesc),
    checks: ats.check(text),
    ...result,
  });
  await trim(Resume, user, MAX_ANALYSES);
  return { ...doc.toObject(), resume_text: undefined };
}

exports.analyze = async (req, res, next) => {
  try {
    const jobDesc = req.body.job_desc.trim();
    const text = await extractText(req.file.buffer);
    if (!text) {
      await req.refundQuota();
      return res.status(422).json({
        message:
          'No selectable text found in this PDF. It looks like a scan or image: export a text-based PDF from Word or Google Docs and try again.',
      });
    }

    // Same resume + same job description as a previous run: return that result, no AI call, no quota used.
    const cached = await Resume.findOne({ user: req.user._id, hash: hashOf(text, jobDesc), suggestions: { $exists: true } });
    if (cached) {
      await req.refundQuota();
      // Analyses saved before "improve" and the ATS checklist existed lack the text and checks.
      await Resume.updateOne({ _id: cached._id, resume_text: { $exists: false } }, { resume_text: text });
      if (!cached.checks?.length) {
        cached.checks = ats.check(text);
        await cached.save();
      }
      return res.json({ message: 'Your analysis is ready', data: cached, cached: true });
    }

    const result = await ai.analyzeResume(text, jobDesc);
    const data = await saveAnalysis(req.user._id, req.file.originalname, text, jobDesc, result);
    res.json({ message: 'Your analysis is ready', data });
  } catch (err) {
    await req.refundQuota();
    next(err);
  }
};

exports.generate = async (req, res, next) => {
  try {
    const { job_desc, template, ...profile } = req.body;
    const content = await ai.generateResume(profile, (job_desc || '').trim());
    const saved = await Generated.create({ user: req.user._id, name: profile.name.trim(), content, template });
    await trim(Generated, req.user._id, MAX_GENERATED);
    res.json({ resume: content, id: saved._id });
  } catch (err) {
    if (!err.billed) await req.refundQuota();
    next(err);
  }
};

// POST /improve/:id { confirmed?: [missing keywords the user really has], template? }
// Rewrites an analysed resume for its job description, saves it as a generated resume, then scores the
// rewrite against the same job and saves that as a new analysis. One quota unit covers the whole action.
exports.improve = async (req, res, next) => {
  try {
    const analysis = validId(req.params.id) && (await Resume.findOne({ _id: req.params.id, user: req.user._id }).select('+resume_text'));
    if (!analysis?.resume_text) {
      await req.refundQuota();
      return analysis
        ? res.status(409).json({ message: 'This analysis is older than the improve feature. Analyze the resume again, then improve it.' })
        : res.status(404).json({ message: 'Not found' });
    }
    const missing = analysis.keywords_missing || [];
    // Only keywords from the analysis may be confirmed, so nothing arbitrary reaches the resume.
    const confirmed = Array.isArray(req.body?.confirmed) ? missing.filter((k) => req.body.confirmed.includes(k)) : [];
    const template = isTemplate(req.body?.template) ? req.body.template : undefined;

    const content = await ai.improveResume(analysis.resume_text, analysis.job_desc, analysis, confirmed);
    const name = content.match(/^#\s+(.+)/m)?.[1].trim() || analysis.resume_name.replace(/\.pdf$/i, '');
    const saved = await Generated.create({ user: req.user._id, name, content, template });
    await trim(Generated, req.user._id, MAX_GENERATED);
    const keywords = [...(analysis.keywords_matched || []), ...missing];

    // A failed re-score must not lose the rewrite the user already paid for: it is just left out.
    let score = null;
    try {
      const rescored = await ai.analyzeResume(content, analysis.job_desc);
      const label = `Improved: ${analysis.resume_name.replace(/^Improved: /, '')}`;
      const doc = await saveAnalysis(req.user._id, label, content, analysis.job_desc, rescored);
      score = { before: analysis.score, after: rescored.score, analysisId: doc._id };
    } catch (err) {
      req.log?.warn({ err }, 'Scoring the improved resume failed');
    }
    res.json({
      original: analysis.resume_text, // the owner's own text, for the before/after view
      score,
      resume: content,
      id: saved._id,
      name,
      template: saved.template,
      coverage: { before: analysis.keywords_matched?.length || 0, after: ai.keywordHits(content, keywords), total: keywords.length },
    });
  } catch (err) {
    if (!err.billed) await req.refundQuota();
    next(err);
  }
};

exports.myHistory = async (req, res, next) => {
  try {
    const { items, ...meta } = await paginate(Resume, { user: req.user._id }, req.query);
    // Only analyses that kept their resume text can be improved; the text itself stays on the server.
    // Those saved before the ATS checklist existed get their checks computed (and stored) on first view.
    const withText = await Resume.find({ _id: { $in: items.map((i) => i._id) }, resume_text: { $exists: true } }).select('+resume_text checks');
    const checks = new Map();
    for (const d of withText) {
      if (!d.checks?.length) {
        d.checks = ats.check(d.resume_text);
        await d.save();
      }
      checks.set(String(d._id), d.checks);
    }
    res.json({
      resumes: items.map((i) => ({ ...i.toObject(), improvable: checks.has(String(i._id)), checks: checks.get(String(i._id)) || i.checks })),
      ...meta,
    });
  } catch (err) {
    next(err);
  }
};

exports.allHistory = async (req, res, next) => {
  try {
    const { items, ...meta } = await paginate(Resume, {}, req.query, { path: 'user', select: 'name email' });
    res.json({ resumes: items, ...meta });
  } catch (err) {
    next(err);
  }
};

exports.deleteAnalysis = async (req, res, next) => {
  try {
    const done = validId(req.params.id) && (await Resume.deleteOne({ _id: req.params.id, user: req.user._id })).deletedCount;
    res.status(done ? 200 : 404).json({ message: done ? 'Deleted' : 'Not found' });
  } catch (err) {
    next(err);
  }
};

exports.myGenerated = async (req, res, next) => {
  try {
    res.json({ resumes: await Generated.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(MAX_GENERATED) });
  } catch (err) {
    next(err);
  }
};

exports.updateGenerated = async (req, res, next) => {
  try {
    // { content?, template? }: at least one.
    const { content, template } = req.body || {};
    const update = {};
    if (content !== undefined || template === undefined) {
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text || text.length > 20000) return res.status(400).json({ message: 'Content must be 1-20000 characters' });
      update.content = text;
    }
    if (template !== undefined) {
      if (!isTemplate(template)) return res.status(400).json({ message: 'Unknown template' });
      update.template = template;
    }
    const doc =
      validId(req.params.id) &&
      (await Generated.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, update, { returnDocument: 'after' }));
    doc ? res.json({ resume: doc }) : res.status(404).json({ message: 'Not found' });
  } catch (err) {
    next(err);
  }
};

exports.deleteGenerated = async (req, res, next) => {
  try {
    const done = validId(req.params.id) && (await Generated.deleteOne({ _id: req.params.id, user: req.user._id })).deletedCount;
    res.status(done ? 200 : 404).json({ message: done ? 'Deleted' : 'Not found' });
  } catch (err) {
    next(err);
  }
};

// POST /export?format=pdf|docx  { markdown, name, template? } -> the file. No AI involved, so no quota.
exports.exportResume = async (req, res, next) => {
  try {
    const { markdown, name, template = 'modern' } = req.body || {};
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 20000) {
      return res.status(400).json({ message: 'Resume text must be 1-20000 characters' });
    }
    const format = ['pdf', 'docx'].includes(req.query.format) ? req.query.format : null;
    if (!format) return res.status(400).json({ message: 'format must be pdf or docx' });
    if (!isTemplate(template)) return res.status(400).json({ message: 'Unknown template' });
    const style = exporter.TEMPLATES[template];
    const base = String(name || 'resume').replace(/[^\w-]+/g, '_').slice(0, 60) || 'resume';
    const blocks = exporter.parse(markdown);
    res.setHeader('Content-Disposition', `attachment; filename="${base}_resume.${format}"`);
    if (format === 'pdf') {
      res.type('application/pdf');
      exporter.toPdf(blocks, res, style);
    } else {
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.send(await exporter.toDocx(blocks, style));
    }
  } catch (err) {
    next(err);
  }
};
