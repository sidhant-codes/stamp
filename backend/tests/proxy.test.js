process.env.TRUST_PROXY = '0'; // no proxy in front: X-Forwarded-For must be ignored
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

test('with TRUST_PROXY=0 a spoofed X-Forwarded-For cannot dodge the auth limiter', async () => {
  const app = h.app();
  let last;
  for (let i = 0; i < 11; i++) {
    last = await request(app).post('/api/user/login').set('X-Forwarded-For', h.ip()).send({ email: 'a@b.co', password: 'x' });
  }
  assert.equal(last.status, 429);
});
