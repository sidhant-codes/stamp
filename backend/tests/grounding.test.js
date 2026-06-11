const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

let calls = 0;
// Fake Cohere HTTP API. By default the model "answers" but invents 2019 and Kubernetes, so the grounding
// check must reject all 3 attempts (each of which is a billed call).
let answer = '## Summary\nBuilt Kubernetes platforms since 2019.';
globalThis.fetch = async () => {
  calls++;
  const body = {
    id: 'x',
    finish_reason: 'COMPLETE',
    message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const app = h.app();
before(() => h.start());
after(() => h.stop());

test('a generation rejected by the grounding check keeps its quota unit and explains itself', async () => {
  const user = await h.makeUser();
  const res = await request(app)
    .post('/api/resume/generate')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${h.tokenFor(user)}`)
    .send({ name: 'A', skills: 'js' });
  assert.equal(calls, 3);
  assert.equal(res.status, 422);
  assert.match(res.body.message, /reliable resume/i);
  const usage = await require('../src/models/usage').findOne({ user: user._id });
  assert.equal(usage.count, 1);
});

test('after 3 ungrounded attempts the grounded lines are kept and the invented ones dropped', async () => {
  calls = 0;
  answer = '## Summary\nStudent who builds React apps.\n\n## Projects\n- Todo app in React\n- Scaled it on Kubernetes to 10000 users';
  const user = await h.makeUser();
  const res = await request(app)
    .post('/api/resume/generate')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${h.tokenFor(user)}`)
    .send({ name: 'B', skills: 'React', projects: 'Todo app in React' });
  assert.equal(calls, 3);
  assert.equal(res.status, 200);
  assert.match(res.body.resume, /Todo app in React/);
  assert.doesNotMatch(res.body.resume, /Kubernetes|10000/);
});

test('with a target job, lines using job terms the candidate never gave are dropped', async () => {
  calls = 0;
  answer = '## Summary\nStudent who builds React apps.\n\n## Projects\n- Todo app in React\n- Ran it on Kubernetes';
  const user = await h.makeUser();
  const send = (body) =>
    request(app).post('/api/resume/generate').set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${h.tokenFor(user)}`).send(body);
  const tailored = await send({ name: 'C', skills: 'React', projects: 'Todo app in React', job_desc: 'You will use React and Kubernetes daily.' });
  assert.equal(tailored.status, 200);
  assert.match(tailored.body.resume, /Todo app in React/);
  assert.doesNotMatch(tailored.body.resume, /Kubernetes/);
});
