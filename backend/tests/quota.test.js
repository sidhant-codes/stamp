const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

const app = h.app();
const ai = require('../src/services/ai');

before(() => h.start());
after(() => h.stop());

// Loaded lazily: the model only exists once Task 4's implementation is in place.
const Usage = () => require('../src/models/usage');

const generate = (token) =>
  request(app)
    .post('/api/resume/generate')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'A', skills: 'js' });

const count = async (user) => (await Usage().findOne({ user: user._id }))?.count ?? 0;

test('21 simultaneous requests: exactly 20 succeed, the rest get 429, count ends at 20', async () => {
  ai.generateResume = async () => '# A';
  const user = await h.makeUser();
  const token = h.tokenFor(user);
  const results = await Promise.all(Array.from({ length: 21 }, () => generate(token)));
  assert.equal(results.filter((r) => r.status === 200).length, 20);
  const blocked = results.filter((r) => r.status === 429);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].body.message, /daily limit/i);
  assert.ok(!Number.isNaN(Date.parse(blocked[0].body.resetAt)));
  assert.equal(await count(user), 20);
});

test('an AI failure refunds the quota unit', async () => {
  ai.generateResume = async () => {
    throw new Error('cohere down');
  };
  const user = await h.makeUser();
  const res = await generate(h.tokenFor(user));
  assert.equal(res.status, 500);
  assert.equal(await count(user), 0);
});

test('an unreadable PDF refunds the quota unit', async () => {
  const user = await h.makeUser();
  const res = await request(app)
    .post('/api/resume/analyze')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${h.tokenFor(user)}`)
    .attach('resume', Buffer.from('this is not a pdf'), { filename: 'r.pdf', contentType: 'application/pdf' })
    .field('job_desc', 'node developer');
  assert.notEqual(res.status, 200);
  assert.equal(await count(user), 0);
});

test('invalid input never touches the quota', async () => {
  const user = await h.makeUser();
  const res = await request(app)
    .post('/api/resume/generate')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${h.tokenFor(user)}`)
    .send({ name: 'A' });
  assert.equal(res.status, 400);
  assert.equal(await count(user), 0);
});
