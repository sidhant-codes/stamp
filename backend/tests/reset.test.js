const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

const app = h.app();
const User = require('../src/models/user');

let sent;
before(async () => {
  await h.start();
  // Loaded here so a missing mail service fails as a test failure, not a crash on require.
  const mail = require('../src/services/mail');
  mail.sendResetEmail = async (to, link) => {
    sent = { to, link };
  };
});
after(() => h.stop());

const post = (path, body) => request(app).post(path).set('X-Forwarded-For', h.ip()).send(body);
const register = (email, password = 'oldpass1') => post('/api/user/register', { name: 'T', email, password });
const linkParams = () => new URL(sent.link).searchParams;

test('forgot looks identical for known and unknown emails; mail is only sent to known ones', async () => {
  await register('known@example.com');
  sent = null;
  const unknown = await post('/api/user/forgot', { email: 'nobody@example.com' });
  assert.equal(sent, null);
  const known = await post('/api/user/forgot', { email: 'known@example.com' });
  assert.equal(sent.to, 'known@example.com');
  assert.equal(known.status, unknown.status);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(known.status, 200);
});

test('full flow: reset sets the new password and old password stops working', async () => {
  await register('flow@example.com');
  await post('/api/user/forgot', { email: 'flow@example.com' });
  const { token, email } = Object.fromEntries(linkParams());
  const res = await post('/api/user/reset', { email, token, password: 'newpass1' });
  assert.equal(res.status, 200);
  assert.equal((await post('/api/user/login', { email: 'flow@example.com', password: 'newpass1' })).status, 200);
  assert.equal((await post('/api/user/login', { email: 'flow@example.com', password: 'oldpass1' })).status, 401);
});

test('the stored token is a hash, not the emailed value', async () => {
  await register('hash@example.com');
  await post('/api/user/forgot', { email: 'hash@example.com' });
  const token = linkParams().get('token');
  const user = await User.findOne({ email: 'hash@example.com' }).select('+resetTokenHash');
  assert.ok(user.resetTokenHash);
  assert.notEqual(user.resetTokenHash, token);
});

test('email case does not matter, but a valid token with a different email fails', async () => {
  await register('MiXed@Example.com');
  await register('other@example.com');
  await post('/api/user/forgot', { email: 'MIXED@example.COM' });
  assert.equal(sent.to, 'mixed@example.com');
  const token = linkParams().get('token');
  assert.equal((await post('/api/user/reset', { email: 'other@example.com', token, password: 'newpass1' })).status, 400);
  assert.equal((await post('/api/user/reset', { email: 'MIXED@EXAMPLE.com', token, password: 'newpass1' })).status, 200);
});

test('a reset token can only be used once', async () => {
  await register('once@example.com');
  await post('/api/user/forgot', { email: 'once@example.com' });
  const { token, email } = Object.fromEntries(linkParams());
  assert.equal((await post('/api/user/reset', { email, token, password: 'newpass1' })).status, 200);
  assert.equal((await post('/api/user/reset', { email, token, password: 'another1' })).status, 400);
});

test('an expired token is rejected', async () => {
  await register('late@example.com');
  await post('/api/user/forgot', { email: 'late@example.com' });
  const { token, email } = Object.fromEntries(linkParams());
  await User.updateOne({ email }, { resetTokenExpires: new Date(Date.now() - 1000) });
  assert.equal((await post('/api/user/reset', { email, token, password: 'newpass1' })).status, 400);
});

test('a too-short password is rejected without using up the token', async () => {
  await register('short@example.com');
  await post('/api/user/forgot', { email: 'short@example.com' });
  const { token, email } = Object.fromEntries(linkParams());
  assert.equal((await post('/api/user/reset', { email, token, password: '123' })).status, 400);
  assert.equal((await post('/api/user/reset', { email, token, password: 'newpass1' })).status, 200);
});

test('existing sessions stop working after a reset', async () => {
  const reg = await register('session@example.com');
  const old = reg.body.token;
  await post('/api/user/forgot', { email: 'session@example.com' });
  const { token, email } = Object.fromEntries(linkParams());
  await post('/api/user/reset', { email, token, password: 'newpass1' });
  const res = await request(app).get('/api/user/me').set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${old}`);
  assert.equal(res.status, 401);
});

test('reset with missing or non-string fields returns 400', async () => {
  assert.equal((await post('/api/user/reset', {})).status, 400);
  assert.equal((await post('/api/user/reset', { email: { $ne: 1 }, token: 'x', password: 'newpass1' })).status, 400);
});

test('repeated forgot requests do not resend or invalidate the live link', async () => {
  await register('spam@example.com');
  await post('/api/user/forgot', { email: 'spam@example.com' });
  const first = sent;
  sent = null;
  const again = await post('/api/user/forgot', { email: 'spam@example.com' });
  assert.equal(again.status, 200);
  assert.equal(sent, null);
  const { token, email } = Object.fromEntries(new URL(first.link).searchParams);
  assert.equal((await post('/api/user/reset', { email, token, password: 'newpass1' })).status, 200);
});
