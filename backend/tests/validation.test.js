const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

// Headers for a fresh logged-in user. (Returning a supertest request from an async fn would send it early.)
const asUser = async () => ({ 'X-Forwarded-For': h.ip(), Authorization: `Bearer ${h.tokenFor(await h.makeUser())}` });

const pdf = { filename: 'r.pdf', contentType: 'application/pdf' };

test('register rejects a malformed email', async () => {
  const res = await request(h.app())
    .post('/api/user/register')
    .set('X-Forwarded-For', h.ip())
    .send({ name: 'A', email: 'not-an-email', password: 'secret1' });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /valid email/i);
});

test('register with no body returns 400, not 500', async () => {
  const res = await request(h.app()).post('/api/user/register').set('X-Forwarded-For', h.ip());
  assert.equal(res.status, 400);
});

test('generate requires name and skills', async () => {
  const res = await request(h.app()).post('/api/resume/generate').set(await asUser()).send({ name: 'A' });
  assert.equal(res.status, 400);
});

test('generate with no body returns 400, not 500', async () => {
  const res = await request(h.app()).post('/api/resume/generate').set(await asUser());
  assert.equal(res.status, 400);
});

test('generate rejects a job description over 6000 chars', async () => {
  const res = await request(h.app()).post('/api/resume/generate').set(await asUser()).send({ name: 'A', skills: 'js', job_desc: 'x'.repeat(6001) });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /6000/);
});

test('analyze rejects a missing job description', async () => {
  const res = await request(h.app()).post('/api/resume/analyze').set(await asUser()).attach('resume', Buffer.from('%PDF-1.4'), pdf);
  assert.equal(res.status, 400);
});

test('analyze rejects a job description over 6000 chars', async () => {
  const res = await request(h.app())
    .post('/api/resume/analyze')
    .set(await asUser())
    .attach('resume', Buffer.from('%PDF-1.4'), pdf)
    .field('job_desc', 'x'.repeat(6001));
  assert.equal(res.status, 400);
  assert.match(res.body.message, /6000/);
});

test('generate rejects an oversized profile field', async () => {
  const res = await request(h.app()).post('/api/resume/generate').set(await asUser()).send({ name: 'A', skills: 'js', experience: 'x'.repeat(4001) });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /experience/i);
});

test('generate rejects non-string fields instead of crashing', async () => {
  for (const extra of [{ job_desc: ['x'] }, { contact: { a: 1 } }, { projects: 5 }]) {
    const res = await request(h.app()).post('/api/resume/generate').set(await asUser()).send({ name: 'A', skills: 'js', ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
  }
});

test('generate only forwards known profile fields to the AI', async () => {
  const ai = require('../src/services/ai');
  let seen;
  ai.generateResume = async (profile) => {
    seen = profile;
    return '# A';
  };
  const res = await request(h.app()).post('/api/resume/generate').set(await asUser()).send({ name: 'A', skills: 'js', evil: 'x'.repeat(5000) });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(seen).sort(), ['name', 'skills']);
});
