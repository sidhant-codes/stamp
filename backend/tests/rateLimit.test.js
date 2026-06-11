const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

const login = (app, ip) =>
  request(app).post('/api/user/login').set('X-Forwarded-For', ip).send({ email: 'a@b.co', password: 'x' });

test('login allows 10 attempts per IP, then 429', async () => {
  const app = h.app();
  const ip = h.ip();
  for (let i = 0; i < 10; i++) assert.equal((await login(app, ip)).status, 401);
  const res = await login(app, ip);
  assert.equal(res.status, 429);
  assert.match(res.body.message, /too many/i);
});

test('another IP is not affected by the first IP being limited', async () => {
  assert.equal((await login(h.app(), h.ip())).status, 401);
});

test('rotating fake bearer tokens does not escape the per-IP limit', async () => {
  const app = h.app();
  const ip = h.ip();
  let last;
  for (let i = 0; i < 125; i++) {
    last = await request(app).get('/api/user/me').set('X-Forwarded-For', ip).set('Authorization', `Bearer fake${i}`);
  }
  assert.equal(last.status, 429);
});

test('a logged-in user is limited to 60 requests per minute across IPs', async () => {
  const app = h.app();
  const user = await h.makeUser();
  const token = h.tokenFor(user);
  const get = () => request(app).get('/api/resume/history').set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${token}`);
  for (let i = 0; i < 60; i++) assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 429);
});
