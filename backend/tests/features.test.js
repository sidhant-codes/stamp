const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const PDFDocument = require('pdfkit');
const h = require('./helpers');

const app = h.app();
const ai = require('../src/services/ai');
const Resume = require('../src/models/resume');
const User = require('../src/models/user');

before(() => h.start());
after(() => h.stop());

const as = (token, req) => req.set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${token}`);
const login = async (overrides) => {
  const user = await h.makeUser(overrides);
  return { user, token: h.tokenFor(user) };
};

const pdfWith = (text) =>
  new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    if (text) doc.text(text);
    doc.end();
  });

const analyze = (token, pdf, jd = 'Need Node.js and AWS') =>
  as(token, request(app).post('/api/resume/analyze')).field('job_desc', jd).attach('resume', pdf, { filename: 'cv.pdf', contentType: 'application/pdf' });

const count = async (user) => (await require('../src/models/usage').findOne({ user: user._id }))?.count ?? 0;

test('identical re-analysis is served from the saved result: no AI call, no quota', async () => {
  let calls = 0;
  ai.analyzeResume = async () => {
    calls++;
    return { score: 80, feedback: 'ok', strengths: [], gaps: [], keywords_matched: [], keywords_missing: [], suggestions: [] };
  };
  const { user, token } = await login();
  const pdf = await pdfWith('Jane Doe. Backend developer with five years of Node.js experience building APIs.');
  const first = await analyze(token, pdf);
  const second = await analyze(token, pdf);
  assert.equal(first.status, 200);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.data._id, first.body.data._id);
  assert.equal(calls, 1);
  assert.equal(await count(user), 1);
});

test('a PDF without selectable text gets a clear 422 and no quota is used', async () => {
  const { user, token } = await login();
  const res = await analyze(token, await pdfWith(''));
  assert.equal(res.status, 422);
  assert.match(res.body.message, /scan|selectable/i);
  assert.equal(await count(user), 0);
});

test('history is paginated and only the owner can delete an entry', async () => {
  const { user, token } = await login();
  const other = await login();
  const docs = await Resume.insertMany(
    Array.from({ length: 25 }, (_, i) => ({ user: user._id, resume_name: `r${i}`, job_desc: 'jd', score: i }))
  );
  const page2 = await as(token, request(app).get('/api/resume/history?page=2&limit=10'));
  assert.equal(page2.body.resumes.length, 10);
  assert.equal(page2.body.total, 25);
  assert.equal(page2.body.pages, 3);

  const denied = await as(other.token, request(app).delete(`/api/resume/history/${docs[0]._id}`));
  assert.equal(denied.status, 404);
  const ok = await as(token, request(app).delete(`/api/resume/history/${docs[0]._id}`));
  assert.equal(ok.status, 200);
  assert.equal(await Resume.countDocuments({ user: user._id }), 24);
  assert.equal((await as(token, request(app).delete('/api/resume/history/not-an-id'))).status, 404);
});

test('generated resumes are saved, editable, listed and deletable', async () => {
  ai.generateResume = async () => '# Ann\n\n## Summary\nStudent.';
  const { token } = await login();
  const gen = await as(token, request(app).post('/api/resume/generate')).send({ name: 'Ann', skills: 'js' });
  assert.equal(gen.status, 200);
  const id = gen.body.id;
  assert.ok(id);

  const edit = await as(token, request(app).put(`/api/resume/generated/${id}`)).send({ content: '# Ann\n\nEdited' });
  assert.equal(edit.body.resume.content, '# Ann\n\nEdited');
  assert.equal((await as(token, request(app).put(`/api/resume/generated/${id}`)).send({ content: '  ' })).status, 400);

  const list = await as(token, request(app).get('/api/resume/generated'));
  assert.equal(list.body.resumes.length, 1);
  assert.equal((await as(token, request(app).delete(`/api/resume/generated/${id}`))).status, 200);
  assert.equal((await as(token, request(app).get('/api/resume/generated'))).body.resumes.length, 0);
});

test('export returns a real PDF and a real DOCX, and rejects bad input', async () => {
  const { token } = await login();
  const md = '# Ann Lee\nann@example.com\n\n## Skills\nJS, Node\n\n## Experience\n- Built **APIs**';
  const bin = (res) => {
    res.buffer(true);
    res.parse((r, done) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    return res;
  };
  const get = (format) => bin(as(token, request(app).post(`/api/resume/export?format=${format}`)).send({ markdown: md, name: 'Ann Lee' }));
  const p = await get('pdf');
  assert.equal(p.status, 200);
  assert.equal(p.body.subarray(0, 4).toString(), '%PDF');
  assert.match(p.headers['content-disposition'], /Ann_Lee_resume\.pdf/);
  const d = await get('docx');
  assert.equal(d.status, 200);
  assert.equal(d.body.subarray(0, 2).toString(), 'PK'); // docx is a zip
  assert.equal((await as(token, request(app).post('/api/resume/export?format=exe')).send({ markdown: md })).status, 400);
  assert.equal((await as(token, request(app).post('/api/resume/export?format=pdf')).send({ markdown: '' })).status, 400);
});

test('unverified accounts cannot use AI features until they verify with the emailed token', async () => {
  const logs = [];
  const log = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  const email = 'verify-me@example.com';
  const reg = await request(app).post('/api/user/register').set('X-Forwarded-For', h.ip()).send({ name: 'V', email, password: 'secret12' });
  console.log = log;
  assert.equal(reg.body.user.emailVerified, false);
  const link = logs.join('\n').match(/token=([a-f0-9]+)/);
  assert.ok(link, 'verification link is printed in dev');

  const blocked = await as(reg.body.token, request(app).post('/api/resume/generate')).send({ name: 'V', skills: 'js' });
  assert.equal(blocked.status, 403);

  const wrong = await request(app).post('/api/user/verify').set('X-Forwarded-For', h.ip()).send({ email, token: 'nope' });
  assert.equal(wrong.status, 400);
  const good = await request(app).post('/api/user/verify').set('X-Forwarded-For', h.ip()).send({ email, token: link[1] });
  assert.equal(good.status, 200);
  const again = await request(app).post('/api/user/verify').set('X-Forwarded-For', h.ip()).send({ email, token: link[1] });
  assert.equal(again.status, 400); // single use

  ai.generateResume = async () => '# V';
  assert.equal((await as(reg.body.token, request(app).post('/api/resume/generate')).send({ name: 'V', skills: 'js' })).status, 200);
});

test('accounts created before verification existed are not blocked', async () => {
  ai.generateResume = async () => '# A';
  const { token } = await login(); // emailVerified left undefined
  assert.equal((await as(token, request(app).post('/api/resume/generate')).send({ name: 'A', skills: 'js' })).status, 200);
});

test('deleting an account needs the password and removes the user and their data', async () => {
  const bcrypt = require('bcryptjs');
  const { user, token } = await login({ password: await bcrypt.hash('rightpass', 4) });
  await Resume.create({ user: user._id, resume_name: 'x', job_desc: 'y', score: 1 });
  assert.equal((await as(token, request(app).delete('/api/user/me')).send({ password: 'wrong' })).status, 401);
  assert.ok(await User.exists({ _id: user._id }));
  assert.equal((await as(token, request(app).delete('/api/user/me')).send({ password: 'rightpass' })).status, 200);
  assert.equal(await User.exists({ _id: user._id }), null);
  assert.equal(await Resume.countDocuments({ user: user._id }), 0);
});

test('analyzeResume: parses fenced JSON, drops keywords not in the texts and ungrounded rewrites', async () => {
  delete require.cache[require.resolve('../src/services/ai')];
  const real = require('../src/services/ai');
  const answer = {
    score: 72,
    feedback: 'Decent',
    strengths: ['Node'],
    gaps: ['AWS'],
    keywords_matched: ['Node.js', 'Rust', 'Java'], // Rust is not in the resume; Java only as part of JavaScript
    keywords_missing: ['AWS', 'Go'], // Go is not in the job description
    suggestions: [
      { gap: 'AWS', tip: 'Add only if true', rewrite: 'Deployed services to AWS with 99% uptime' }, // AWS + 99 invented
      { gap: 'API', tip: 'Be specific', rewrite: 'Built Node.js APIs for 5 years' }, // grounded
    ],
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ id: 'x', finish_reason: 'COMPLETE', message: { role: 'assistant', content: [{ type: 'text', text: 'Here you go:\n```json\n' + JSON.stringify(answer) + '\n```' }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  const out = await real.analyzeResume('Built Node.js APIs for 5 years in JavaScript', 'Need Node.js and AWS');
  assert.equal(out.score, 72);
  assert.deepEqual(out.keywords_matched, ['Node.js']);
  assert.deepEqual(out.keywords_missing, ['AWS']);
  assert.equal(out.suggestions[0].rewrite, '');
  assert.equal(out.suggestions[1].rewrite, 'Built Node.js APIs for 5 years');
});

test('analyzeResume: unreadable AI output becomes a 502 after one retry', async () => {
  const real = require('../src/services/ai');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ id: 'x', finish_reason: 'COMPLETE', message: { role: 'assistant', content: [{ type: 'text', text: 'sorry, no json' }] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await assert.rejects(() => real.analyzeResume('r', 'j'), (e) => e.status === 502);
  assert.equal(calls, 2);
});

test('improve: rewrites an analysed resume, passes only confirmed missing keywords, reports coverage and new score', async () => {
  const scores = [50, 78]; // first the uploaded resume, then the rewrite
  ai.analyzeResume = async () => ({
    score: scores.shift(), feedback: 'ok', strengths: [], gaps: ['Docker'], keywords_matched: ['Node.js'], keywords_missing: ['Docker', 'AWS'], suggestions: [],
  });
  let args;
  ai.improveResume = async (...a) => {
    args = a;
    return '# Jane Doe\njane@example.com\n\n## Skills\nNode.js, Docker';
  };
  const { user, token } = await login();
  const analysed = await analyze(token, await pdfWith('Jane Doe. Backend developer building Node.js APIs for clients.'), 'Node.js, Docker, AWS');
  const id = analysed.body.data._id;
  assert.equal(analysed.body.data.resume_text, undefined, 'resume text is not sent back');
  assert.equal(analysed.body.data.checks.length, 8); // ATS checklist
  assert.equal(analysed.body.data.checks.find((c) => c.label === 'Email address').pass, false);

  const res = await as(token, request(app).post(`/api/resume/improve/${id}`)).send({ confirmed: ['Docker', 'Kubernetes'], template: 'classic' });
  assert.equal(res.status, 200);
  assert.match(args[0], /Backend developer/); // the stored resume text
  assert.deepEqual(args[3], ['Docker']); // Kubernetes was never a missing keyword, so it is ignored
  assert.deepEqual(res.body.coverage, { before: 1, after: 2, total: 3 });
  assert.equal(res.body.score.before, 50);
  assert.equal(res.body.score.after, 78);
  const rescored = await Resume.findById(res.body.score.analysisId).select('+resume_text');
  assert.equal(rescored.resume_name, 'Improved: cv.pdf');
  assert.match(rescored.resume_text, /## Skills/); // can itself be improved again
  assert.match(res.body.original, /Backend developer building Node\.js APIs/); // for the before/after view
  assert.equal(res.body.name, 'Jane Doe');
  assert.equal(res.body.template, 'classic');
  assert.equal(await require('../src/models/generated').countDocuments({ user: user._id }), 1);
  assert.equal(await count(user), 2); // analyze + improve

  const other = await login();
  assert.equal((await as(other.token, request(app).post(`/api/resume/improve/${id}`)).send({})).status, 404);
  assert.equal(await count(other.user), 0); // refunded

  const legacy = await Resume.create({ user: user._id, resume_name: 'old.pdf', job_desc: 'jd', score: 1 });
  assert.equal((await as(token, request(app).post(`/api/resume/improve/${legacy._id}`)).send({})).status, 409);

  await Resume.create({ user: user._id, resume_name: 'pre-checklist.pdf', job_desc: 'jd', resume_text: 'Jane, jane@example.com', score: 1 });
  const hist = await as(token, request(app).get('/api/resume/history'));
  const flags = Object.fromEntries(hist.body.resumes.map((r) => [r.resume_name, r.improvable]));
  assert.deepEqual(flags, { 'pre-checklist.pdf': true, 'old.pdf': false, 'Improved: cv.pdf': true, 'cv.pdf': true });
  const backfilled = hist.body.resumes.find((r) => r.resume_name === 'pre-checklist.pdf');
  assert.equal(backfilled.checks.find((c) => c.label === 'Email address').pass, true); // computed on first view
  assert.equal((await Resume.findById(backfilled._id)).checks.length, 8); // and stored
  assert.ok(hist.body.resumes.every((r) => r.resume_text === undefined));
  assert.equal(await count(user), 2);
});

test('improveResume: confirmed keywords count as facts, invented ones are dropped', async () => {
  const real = require('../src/services/ai');
  let calls = 0;
  const text = '# Jane Doe\n\n## Skills\n- Node.js, Docker\n- AWS';
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ id: 'x', finish_reason: 'COMPLETE', message: { role: 'assistant', content: [{ type: 'text', text }] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const out = await real.improveResume('Jane Doe. Built Node.js APIs.', 'Node.js, Docker, AWS', { gaps: [], suggestions: [] }, ['Docker']);
  assert.equal(calls, 3);
  assert.match(out, /Node\.js, Docker/);
  assert.doesNotMatch(out, /AWS/);
});

test('templates: export and saved resumes accept known templates only', async () => {
  ai.generateResume = async () => '# Ann\nann@example.com\n\n## Summary\nStudent.';
  const { token } = await login();
  const gen = await as(token, request(app).post('/api/resume/generate')).send({ name: 'Ann', skills: 'js', template: 'compact' });
  assert.equal(gen.status, 200);
  const list = await as(token, request(app).get('/api/resume/generated'));
  assert.equal(list.body.resumes[0].template, 'compact');
  assert.equal((await as(token, request(app).post('/api/resume/generate')).send({ name: 'Ann', skills: 'js', template: 'fancy' })).status, 400);

  const put = await as(token, request(app).put(`/api/resume/generated/${gen.body.id}`)).send({ template: 'classic' });
  assert.equal(put.body.resume.template, 'classic');
  assert.equal(put.body.resume.content, '# Ann\nann@example.com\n\n## Summary\nStudent.');
  assert.equal((await as(token, request(app).put(`/api/resume/generated/${gen.body.id}`)).send({ template: 'constructor' })).status, 400);

  for (const template of ['classic', 'modern', 'compact']) {
    for (const format of ['pdf', 'docx']) {
      const res = await as(token, request(app).post(`/api/resume/export?format=${format}`)).send({ markdown: '# Ann\nann@example.com\n\n## Skills\n- JS', template });
      assert.equal(res.status, 200, `${template} ${format}`);
    }
  }
  assert.equal((await as(token, request(app).post('/api/resume/export?format=pdf')).send({ markdown: '# A', template: 'fancy' })).status, 400);
});

test('improve: a failed re-score still returns the rewrite, without a score', async () => {
  ai.improveResume = async () => '# Jane\n\n## Skills\nNode.js';
  ai.analyzeResume = async () => {
    throw Object.assign(new Error('AI down'), { status: 502 });
  };
  const { user, token } = await login();
  const analysis = await Resume.create({ user: user._id, resume_name: 'cv.pdf', job_desc: 'Node.js', resume_text: 'Jane. Node.js', score: 40 });
  const res = await as(token, request(app).post(`/api/resume/improve/${analysis._id}`)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.score, null);
  assert.equal(res.body.resume, '# Jane\n\n## Skills\nNode.js');
});

test('improveResume: drops lines using unconfirmed missing keywords or job terms the resume never mentions', async () => {
  const real = require('../src/services/ai');
  const text = '# Jane Doe\n\n## Skills\n- Node.js APIs\n- Docker\n- Deployed with kubernetes\n- Wrote Terraform modules';
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: 'x', finish_reason: 'COMPLETE', message: { role: 'assistant', content: [{ type: 'text', text }] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const out = await real.improveResume(
    'Jane Doe. Built Node.js APIs.',
    'You will work with Kubernetes and Terraform every day.',
    { gaps: [], suggestions: [], keywords_missing: ['Kubernetes', 'Docker'] },
    ['Docker']
  );
  assert.match(out, /Node\.js APIs/);
  assert.match(out, /Docker/); // confirmed by the user
  assert.doesNotMatch(out, /kubernetes/i); // a missing keyword they did not confirm, in any case
  assert.doesNotMatch(out, /Terraform/); // a job term not in the resume
});
