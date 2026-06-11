const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

const me = (token) =>
  request(h.app()).get('/api/user/me').set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${token}`);

test('a token with the current version works', async () => {
  const user = await h.makeUser();
  assert.equal((await me(h.tokenFor(user))).status, 200);
});

test('a token with a stale version is rejected', async () => {
  const user = await h.makeUser();
  const token = h.tokenFor(user);
  user.tokenVersion += 1;
  await user.save();
  assert.equal((await me(token)).status, 401);
});

test('a legacy token with no version still works for users at version 0', async () => {
  const user = await h.makeUser();
  const legacy = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await me(legacy)).status, 200);
});

test('login tokens last 24 hours and carry the version', async () => {
  const res = await request(h.app())
    .post('/api/user/register')
    .set('X-Forwarded-For', h.ip())
    .send({ name: 'A', email: 'fresh@example.com', password: 'secret1' });
  assert.equal(res.status, 201);
  const { exp, iat, v } = jwt.decode(res.body.token);
  assert.equal(exp - iat, 24 * 60 * 60);
  assert.equal(v, 0);
});
