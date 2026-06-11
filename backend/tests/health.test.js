const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

test('GET /health reports ok when Mongo is connected', async () => {
  const res = await request(h.app()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.db, true);
});

test('JSON bodies over 1mb are rejected with 413', async () => {
  const res = await request(h.app())
    .post('/api/user/login')
    .send({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(res.status, 413);
});

test('security headers are set', async () => {
  const res = await request(h.app()).get('/health');
  assert.ok(res.headers['x-content-type-options']);
});

test('production 500s hide the error text, other envs keep it', () => {
  const { errorHandler } = require('../src/middleware/error');
  const run = (err, env) => {
    const prev = process.env.NODE_ENV;
    const log = console.error;
    process.env.NODE_ENV = env;
    console.error = () => {};
    let out = {};
    const res = {
      status(s) { out.status = s; return this; },
      json(b) { out.body = b; },
    };
    errorHandler(err, {}, res, () => {});
    console.error = log;
    process.env.NODE_ENV = prev;
    return out;
  };
  assert.deepEqual(run(new Error('secret db detail'), 'production'), { status: 500, body: { message: 'Server error' } });
  assert.equal(run(new Error('secret db detail'), 'development').body.message, 'secret db detail');
  assert.equal(run(Object.assign(new Error('bad json'), { status: 400 }), 'production').status, 400);
});
