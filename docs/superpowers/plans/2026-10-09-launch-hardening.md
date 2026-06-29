# Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the resume app safe to expose publicly: rate limits, a 20/day per-user AI quota, security headers and input caps, password reset by email, and tests for all of it.

**Architecture:** Small Express middlewares (`rateLimit`, `validate`, `quota`) are mounted in the route files; a `usage` collection counts AI calls per user per UTC day with an atomic `$inc`. Password reset stores a hashed single-use token on the user and bumps a `tokenVersion` that every JWT carries, so old sessions die on reset. Tests use `node:test` + `supertest` against an in-memory MongoDB with the Cohere and mail services stubbed.

**Tech Stack:** Node 24 (project has Node >= 18 syntax), Express 5, Mongoose 9, `express-rate-limit`, `helmet`, `supertest` + `mongodb-memory-server` (dev), Resend HTTPS API through built-in `fetch`, React 19 + Vite for the two new pages.

**Spec:** `docs/superpowers/specs/2026-10-09-launch-hardening-design.md`

## Global Constraints

- Daily AI limit: **20** per user (analyze + generate combined), env `DAILY_AI_LIMIT`, day boundary is **UTC**.
- Auth rate limit: **10 requests / 15 min per IP** on `login`, `register`, `forgot`, `reset` (one shared counter).
- Other `/api` rate limits: **60 requests / min per logged-in user** (resume routes) plus a **120 requests / min per IP** backstop on all `/api` (deviation from the spec's "keyed by user id when authenticated": keying on an unverified `Authorization` header would let an attacker rotate fake tokens for fresh buckets, so the user limiter runs *after* `requireUser`).
- JSON body limit **1mb**; `job_desc` max **6000** chars (400 beyond that); password minimum stays **6** chars.
- JWT lifetime **24h** (was 7d); payload `{ id, v }` where `v` is the user's `tokenVersion`.
- Reset token: 32 random bytes hex, only its **SHA-256** is stored, expires in **30 minutes**, single use. `forgot` always answers 200 with the same body.
- Email via **Resend** (`RESEND_API_KEY`, `MAIL_FROM`) using built-in `fetch`; no new mail dependency. Unset key => log link to console when `NODE_ENV !== 'production'`.
- All error responses keep the existing `{ message }` shape; 429s from the quota also include `resetAt` (ISO string).
- No new test framework: use `node:test` (`node --test`) only.
- Out of scope: email verification, cookies, billing, usage dashboard, export/templates, analysis changes.

## Review Focus

1. 21 simultaneous AI requests from one user at a fresh day: exactly 20 succeed, the rest get 429, stored count ends at 20 (Task 4).
2. An AI failure or an unreadable/garbage PDF must not burn a quota unit (Task 4).
3. Asking for a reset for an unknown email must look identical to a known one (status and body) (Task 6).
4. Reset link emails differing only in case from the registered address must still work, while a valid token with the wrong email must fail (Task 6).
5. Rotating fake `Bearer` values must not escape the per-IP limit (Task 2).

## File Structure

Backend (`backend/`):
- `package.json` - add deps and `test` script.
- `server.js` - log unhandled rejections.
- `src/app.js` - helmet, trust proxy, 1mb JSON, `/health`, IP limiter.
- `src/config/env.js` - `DAILY_AI_LIMIT`, `RESEND_API_KEY`, `MAIL_FROM`.
- `src/middleware/error.js` - generic 500 text in production, pass through 4xx status.
- `src/middleware/rateLimit.js` (new) - `authLimiter`, `ipLimiter`, `userLimiter`.
- `src/middleware/validate.js` (new) - `analyzeInput`, `generateInput`.
- `src/middleware/quota.js` (new) - `requireQuota` sets `req.refundQuota()`.
- `src/middleware/auth.js` - reject JWTs whose `v` != `user.tokenVersion`.
- `src/models/usage.js` (new), `src/models/user.js` (+`tokenVersion`, reset fields).
- `src/services/mail.js` (new) - `sendResetEmail(to, link)`.
- `src/controllers/user.js` (+`forgot`, `reset`, email check, 24h token), `src/controllers/resume.js` (refunds, validation moved out).
- `src/routes/user.js`, `src/routes/resume.js`.
- `tests/helpers.js`, `tests/*.test.js` (new).
- `.env.example` - new variables.

Frontend (`frontend/src/`):
- `pages/ForgotPassword/ForgotPassword.jsx`, `pages/ResetPassword/ResetPassword.jsx` (new), `pages/Login/Login.jsx` (link), `pages/Login/Login.module.css` (`.notice`), `App.jsx` (routes).

Repo root: `README.md` (env vars + quota note), `.gitignore` check.

---

### Task 1: Test harness, repo hygiene, `/health`, helmet, body cap, safe errors

**Files:**
- Modify: `backend/package.json`, `backend/server.js`, `backend/src/app.js`, `backend/src/middleware/error.js`
- Create: `backend/tests/helpers.js`, `backend/tests/health.test.js`
- Delete: `backend/uploads/` (unused leftovers; upload middleware is memory-only)

**Interfaces:**
- Produces (`tests/helpers.js`): `start()`, `stop()` (async, in-memory Mongo), `app()` (returns the Express app), `makeUser(overrides?) -> Promise<UserDoc>`, `tokenFor(user) -> string` (Bearer JWT with `{id, v}`), `ip() -> string` (a unique fake client IP for `X-Forwarded-For`). Every later task's tests use these exact names.

- [ ] **Step 1: Initialise git and confirm secrets are ignored**

The folder is not a git repository yet. From `D:\Projects\Major Project`:

```bash
git init
git check-ignore -v backend/.env frontend/.env backend/uploads
```
Expected: three lines naming `backend/.gitignore` / `frontend/.gitignore` rules. If `frontend/.env` is not listed, stop and add `.env` to `frontend/.gitignore`. Then:

```bash
git add -A
git status --short | grep -E "\.env$" || echo "no .env staged"
```
Expected: `no .env staged` (only `.env.example` files may appear). Commit: `git commit -m "chore: initial import of the existing project"`.

- [ ] **Step 2: Install dependencies and add the test script**

```bash
cd backend
npm install express-rate-limit helmet
npm install -D supertest mongodb-memory-server
```
Edit `backend/package.json` scripts to add `"test": "node --test"`:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test"
},
```
Note: the first test run downloads a MongoDB binary (a few hundred MB) once; allow a few minutes.

- [ ] **Step 3: Write the test helper**

Create `backend/tests/helpers.js`:

```js
// Must run before anything requires src/config/env.js (dotenv never overrides vars that are already set,
// so the real backend/.env values cannot leak into tests).
Object.assign(process.env, {
  MONGO_URI: 'mongodb://unused',
  COHERE_API_KEY: 'test-key',
  JWT_SECRET: 'test-secret',
  NODE_ENV: 'test',
  DAILY_AI_LIMIT: '20',
  RESEND_API_KEY: '',
  MAIL_FROM: 'test@example.com',
  CLIENT_ORIGIN: 'http://localhost:5173',
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let mongod;
let counter = 0;

exports.start = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
};

exports.stop = async () => {
  await mongoose.disconnect();
  await mongod.stop();
};

exports.app = () => require('../src/app');

exports.makeUser = (overrides = {}) =>
  require('../src/models/user').create({
    name: 'Test User',
    email: `user${++counter}@example.com`,
    password: 'not-a-real-hash',
    ...overrides,
  });

exports.tokenFor = (user) =>
  jwt.sign({ id: user._id, v: user.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Rate limits key on req.ip; with `trust proxy` set, X-Forwarded-For controls it.
exports.ip = () => `10.${(++counter >> 8) & 255}.${counter & 255}.1`;
```

- [ ] **Step 4: Write the failing tests**

Create `backend/tests/health.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

test('GET /health reports ok when Mongo is connected', async () => {
  const res = await request(h.app()).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
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
```

- [ ] **Step 5: Run to verify they fail**

Run (from `backend/`): `npm test`
Expected: FAIL (`/health` returns 404, no 413, no header, error handler leaks text).

- [ ] **Step 6: Implement**

Replace `backend/src/app.js`:

```js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { CLIENT_ORIGIN } = require('./config/env');
const { errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1); // behind the host's proxy; req.ip is the real client
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

app.get('/health', (req, res) => {
  const ok = mongoose.connection.readyState === 1;
  res.status(ok ? 200 : 503).json({ ok });
});

app.use('/api/user', require('./routes/user'));
app.use('/api/resume', require('./routes/resume'));
app.use(errorHandler);

module.exports = app;
```

Replace `backend/src/middleware/error.js`:

```js
exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  const known = err.name === 'MulterError' || err.message === 'Only PDF allowed';
  const status = known ? 400 : err.status >= 400 && err.status < 500 ? err.status : 500;
  // Never leak internal error text to clients in production.
  const message = status === 500 && process.env.NODE_ENV === 'production' ? 'Server error' : err.message || 'Server error';
  res.status(status).json({ message });
};
```

Replace `backend/server.js`:

```js
const env = require('./src/config/env');
const connectDB = require('./src/config/db');
const app = require('./src/app');

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

connectDB().then(() => {
  app.listen(env.PORT, () => console.log('Backend running on port', env.PORT));
});
```

Delete the unused folder: `rm -rf backend/uploads` (PowerShell: `Remove-Item -Recurse -Force backend\uploads`). Look at it first with `ls backend/uploads` to confirm it only holds old `*.pdf` files.

- [ ] **Step 7: Run to verify they pass**

Run (from `backend/`): `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: test harness, /health, helmet, 1mb body cap, safe 500s"
```

---

### Task 2: Rate limiting

**Files:**
- Create: `backend/src/middleware/rateLimit.js`, `backend/tests/rateLimit.test.js`
- Modify: `backend/src/app.js`, `backend/src/routes/user.js`, `backend/src/routes/resume.js`

**Interfaces:**
- Consumes: `tests/helpers.js` (`start`, `stop`, `app`, `makeUser`, `tokenFor`, `ip`).
- Produces: `authLimiter`, `ipLimiter`, `userLimiter` (Express middlewares exported from `middleware/rateLimit.js`). `authLimiter` is reused by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/rateLimit.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/rateLimit.test.js`
Expected: FAIL (the 11th login returns 401, not 429).

- [ ] **Step 3: Implement**

Create `backend/src/middleware/rateLimit.js`:

```js
const rateLimit = require('express-rate-limit');

const base = { standardHeaders: true, legacyHeaders: false };
const tooMany = (message) => (req, res) => res.status(429).json({ message });

// login / register / forgot / reset share one counter per IP (brute force + email spam guard).
exports.authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: tooMany('Too many attempts, please try again in a few minutes'),
});

// Backstop for every /api request, keyed by IP.
exports.ipLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 120,
  handler: tooMany('Too many requests, please slow down'),
});

// Per logged-in user. Mount AFTER requireUser so req.user is verified, never from a raw header.
exports.userLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => String(req.user._id),
  handler: tooMany('Too many requests, please slow down'),
});
```

In `backend/src/app.js` add the require and mount the backstop before the routes:

```js
const { ipLimiter } = require('./middleware/rateLimit');
// ...
app.use('/api', ipLimiter);
app.use('/api/user', require('./routes/user'));
```

Replace `backend/src/routes/user.js`:

```js
const router = require('express').Router();
const { requireUser } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { register, login, me } = require('../controllers/user');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', requireUser, me);

module.exports = router;
```

Replace `backend/src/routes/resume.js`:

```js
const router = require('express').Router();
const { requireUser, requireAdmin } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/resume');

router.use(requireUser, userLimiter);
router.post('/analyze', upload.single('resume'), ctrl.analyze);
router.post('/generate', ctrl.generate);
router.get('/history', ctrl.myHistory);
router.get('/all', requireAdmin, ctrl.allHistory);

module.exports = router;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS (health + rate limit tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rate limit auth, per-IP backstop and per-user API calls"
```

---

### Task 3: Input validation (email format, job description cap)

**Files:**
- Create: `backend/src/middleware/validate.js`, `backend/tests/validation.test.js`
- Modify: `backend/src/controllers/user.js` (register), `backend/src/controllers/resume.js`, `backend/src/routes/resume.js`

**Interfaces:**
- Produces: `analyzeInput`, `generateInput` middlewares (run after auth/multer, before the controller; Task 4 inserts the quota middleware after them so invalid input never costs quota).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/validation.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

before(() => h.start());
after(() => h.stop());

const authed = async (method, path) => {
  const user = await h.makeUser();
  return request(h.app())[method](path).set('X-Forwarded-For', h.ip()).set('Authorization', `Bearer ${h.tokenFor(user)}`);
};

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
  const res = (await authed('post', '/api/resume/generate')).send({ name: 'A' });
  assert.equal((await res).status, 400);
});

test('generate with no body returns 400, not 500', async () => {
  assert.equal((await (await authed('post', '/api/resume/generate'))).status, 400);
});

test('generate rejects a job description over 6000 chars', async () => {
  const res = await (await authed('post', '/api/resume/generate')).send({ name: 'A', skills: 'js', job_desc: 'x'.repeat(6001) });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /6000/);
});

test('analyze rejects a missing job description', async () => {
  const res = await (await authed('post', '/api/resume/analyze')).attach('resume', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400);
});

test('analyze rejects a job description over 6000 chars', async () => {
  const res = await (await authed('post', '/api/resume/analyze'))
    .attach('resume', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' })
    .field('job_desc', 'x'.repeat(6001));
  assert.equal(res.status, 400);
  assert.match(res.body.message, /6000/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/validation.test.js`
Expected: FAIL (malformed email accepted; no-body requests return 500; the 6001-char descriptions are not rejected).

- [ ] **Step 3: Implement**

Create `backend/src/middleware/validate.js`:

```js
const MAX_JOB_DESC = 6000;

const bad = (res, message) => res.status(400).json({ message });
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Runs after multer, so req.file / req.body are populated.
exports.analyzeInput = (req, res, next) => {
  const jobDesc = str(req.body?.job_desc);
  if (!req.file || !jobDesc) return bad(res, 'Resume PDF and job description are required');
  if (jobDesc.length > MAX_JOB_DESC) return bad(res, `Job description must be at most ${MAX_JOB_DESC} characters`);
  next();
};

exports.generateInput = (req, res, next) => {
  const body = req.body || {};
  if (!str(body.name) || !str(body.skills)) return bad(res, 'Name and skills are required');
  if (str(body.job_desc).length > MAX_JOB_DESC) return bad(res, `Job description must be at most ${MAX_JOB_DESC} characters`);
  next();
};
```

In `backend/src/routes/resume.js` wire them in:

```js
const { analyzeInput, generateInput } = require('../middleware/validate');
// ...
router.post('/analyze', upload.single('resume'), analyzeInput, ctrl.analyze);
router.post('/generate', generateInput, ctrl.generate);
```

In `backend/src/controllers/resume.js` remove the now-duplicate checks. The `analyze` and `generate` bodies become:

```js
exports.analyze = async (req, res, next) => {
  try {
    const jobDesc = req.body.job_desc.trim();
    const text = await extractText(req.file.buffer);
    if (!text) return res.status(422).json({ message: 'Could not read any text from this PDF' });

    const result = await ai.analyzeResume(text, jobDesc);
    const resume = await Resume.create({
      user: req.user._id,
      resume_name: req.file.originalname,
      job_desc: jobDesc,
      ...result,
    });
    res.json({ message: 'Your analysis is ready', data: resume });
  } catch (err) {
    next(err);
  }
};

exports.generate = async (req, res, next) => {
  try {
    const { job_desc, ...profile } = req.body;
    res.json({ resume: await ai.generateResume(profile, (job_desc || '').trim()) });
  } catch (err) {
    next(err);
  }
};
```
(`myHistory` and `allHistory` stay as they are.)

In `backend/src/controllers/user.js` register: add the email pattern near the top and tolerate a missing body.

```js
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```
and in `register`:

```js
const { name, email, password } = req.body || {};
if (!name?.trim() || !email?.trim() || !password) {
  return res.status(400).json({ message: 'Name, email and password are required' });
}
if (!EMAIL.test(email.trim())) {
  return res.status(400).json({ message: 'Enter a valid email address' });
}
```
(keep the existing password-length check, duplicate check and `User.create` after it.)

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: validate email format, job description length and missing bodies"
```

---

### Task 4: Daily AI quota with refunds

**Files:**
- Create: `backend/src/models/usage.js`, `backend/src/middleware/quota.js`, `backend/tests/quota.test.js`
- Modify: `backend/src/config/env.js`, `backend/src/routes/resume.js`, `backend/src/controllers/resume.js`

**Interfaces:**
- Consumes: `analyzeInput`/`generateInput` (Task 3), `userLimiter` (Task 2).
- Produces: `requireQuota` middleware; it sets `req.refundQuota(): Promise<void>` (never rejects). `DAILY_AI_LIMIT` (number) exported from `config/env.js`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/quota.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

const app = h.app();
const ai = require('../src/services/ai');
const Usage = require('../src/models/usage');

before(() => h.start());
after(() => h.stop());

const generate = (token) =>
  request(app)
    .post('/api/resume/generate')
    .set('X-Forwarded-For', h.ip())
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'A', skills: 'js' });

const count = async (user) => (await Usage.findOne({ user: user._id }))?.count ?? 0;

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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/quota.test.js`
Expected: FAIL (`Cannot find module '../src/models/usage'`).

- [ ] **Step 3: Implement**

In `backend/src/config/env.js` add to the exported object:

```js
  DAILY_AI_LIMIT: Number(process.env.DAILY_AI_LIMIT) || 20,
```

Create `backend/src/models/usage.js`:

```js
const mongoose = require('mongoose');

// One document per user per UTC day; `count` is the number of AI calls made.
const UsageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 }, // TTL: old days clean themselves up
});
UsageSchema.index({ user: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('usage', UsageSchema);
```

Create `backend/src/middleware/quota.js`:

```js
const Usage = require('../models/usage');
const { DAILY_AI_LIMIT } = require('../config/env');

const today = () => new Date().toISOString().slice(0, 10);

const nextReset = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
};

const bump = (user) =>
  Usage.findOneAndUpdate({ user, day: today() }, { $inc: { count: 1 } }, { upsert: true, new: true });

// Atomically takes one unit of today's quota. Controllers call req.refundQuota() when the AI call
// does not produce a result, so failures never cost the user anything.
exports.requireQuota = async (req, res, next) => {
  try {
    let usage;
    try {
      usage = await bump(req.user._id);
    } catch (err) {
      // Two first-ever requests of the day can race on the unique index; the loser just retries.
      if (err.code !== 11000) throw err;
      usage = await bump(req.user._id);
    }
    req.refundQuota = () =>
      Usage.updateOne({ _id: usage._id }, { $inc: { count: -1 } })
        .then(() => {})
        .catch((e) => console.error('Quota refund failed', e));

    if (usage.count > DAILY_AI_LIMIT) {
      await req.refundQuota();
      return res.status(429).json({
        message: `Daily limit of ${DAILY_AI_LIMIT} AI requests reached. Try again after midnight UTC.`,
        resetAt: nextReset().toISOString(),
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};
```

Replace `backend/src/routes/resume.js`:

```js
const router = require('express').Router();
const { requireUser, requireAdmin } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');
const { analyzeInput, generateInput } = require('../middleware/validate');
const { requireQuota } = require('../middleware/quota');
const ctrl = require('../controllers/resume');

router.use(requireUser, userLimiter);
router.post('/analyze', upload.single('resume'), analyzeInput, requireQuota, ctrl.analyze);
router.post('/generate', generateInput, requireQuota, ctrl.generate);
router.get('/history', ctrl.myHistory);
router.get('/all', requireAdmin, ctrl.allHistory);

module.exports = router;
```

In `backend/src/controllers/resume.js` refund on every non-success path of the two AI handlers:

```js
exports.analyze = async (req, res, next) => {
  try {
    const jobDesc = req.body.job_desc.trim();
    const text = await extractText(req.file.buffer);
    if (!text) {
      await req.refundQuota();
      return res.status(422).json({ message: 'Could not read any text from this PDF' });
    }

    const result = await ai.analyzeResume(text, jobDesc);
    const resume = await Resume.create({
      user: req.user._id,
      resume_name: req.file.originalname,
      job_desc: jobDesc,
      ...result,
    });
    res.json({ message: 'Your analysis is ready', data: resume });
  } catch (err) {
    await req.refundQuota();
    next(err);
  }
};

exports.generate = async (req, res, next) => {
  try {
    const { job_desc, ...profile } = req.body;
    res.json({ resume: await ai.generateResume(profile, (job_desc || '').trim()) });
  } catch (err) {
    await req.refundQuota();
    next(err);
  }
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS. If the concurrency test shows 500s instead of 200s/429, the `11000` retry in `quota.js` is the thing to check.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 20/day AI quota per user with refunds on failure"
```

---

### Task 5: Token versioning and 24-hour sessions

**Files:**
- Modify: `backend/src/models/user.js`, `backend/src/controllers/user.js`, `backend/src/middleware/auth.js`
- Create: `backend/tests/token.test.js`

**Interfaces:**
- Produces: `User.tokenVersion` (Number, default 0); JWT payload `{ id, v }`; `sign(user)` stays internal to `controllers/user.js`. Task 6 increments `tokenVersion` on reset.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/token.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/token.test.js`
Expected: FAIL (stale token accepted; lifetime is 7 days; `v` undefined).

- [ ] **Step 3: Implement**

In `backend/src/models/user.js` add the field to the schema object (after `role`):

```js
    tokenVersion: { type: Number, default: 0 }, // bumped on password reset; invalidates older JWTs
```

In `backend/src/controllers/user.js` change `sign`:

```js
const sign = (user) => jwt.sign({ id: user._id, v: user.tokenVersion }, JWT_SECRET, { expiresIn: '24h' });
```

In `backend/src/middleware/auth.js` replace the `try` body in `requireUser`:

```js
  try {
    const { id, v = 0 } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(id);
    if (!user) return res.status(401).json({ message: 'User no longer exists' });
    if (v !== user.tokenVersion) {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }
    req.user = user;
    next();
  } catch (err) {
```
(the existing `catch` block stays unchanged).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 24h JWTs carrying tokenVersion so sessions can be revoked"
```

---

### Task 6: Password reset (backend)

**Files:**
- Create: `backend/src/services/mail.js`, `backend/tests/reset.test.js`
- Modify: `backend/src/config/env.js`, `backend/src/models/user.js`, `backend/src/controllers/user.js`, `backend/src/routes/user.js`

**Interfaces:**
- Consumes: `authLimiter` (Task 2), `tokenVersion` (Task 5).
- Produces: `POST /api/user/forgot {email}` -> `200 {message}`; `POST /api/user/reset {email, token, password}` -> `200 {message}` or `400 {message}`. Reset link format `CLIENT_ORIGIN/reset?token=<hex>&email=<urlencoded email>` (Task 7 reads exactly these query params). `mail.sendResetEmail(to, link): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/reset.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');

const app = h.app();
const mail = require('../src/services/mail');
const User = require('../src/models/user');

let sent;
before(async () => {
  await h.start();
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/reset.test.js`
Expected: FAIL (`Cannot find module '../src/services/mail'`).

- [ ] **Step 3: Implement**

In `backend/src/config/env.js` add to the exported object:

```js
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  MAIL_FROM: process.env.MAIL_FROM || 'onboarding@resend.dev',
```

In `backend/src/models/user.js` add to the schema object (after `tokenVersion`):

```js
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
```

Create `backend/src/services/mail.js`:

```js
const { RESEND_API_KEY, MAIL_FROM } = require('../config/env');

exports.sendResetEmail = async (to, link) => {
  if (!RESEND_API_KEY) {
    // No provider configured: make local development usable by printing the link.
    if (process.env.NODE_ENV !== 'production') console.log(`[mail disabled] password reset link for ${to}: ${link}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject: 'Reset your password',
      text: `Use this link to choose a new password (valid for 30 minutes):\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded with ${res.status}`);
};
```

In `backend/src/controllers/user.js` update the requires at the top and add the two handlers at the end:

```js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const mail = require('../services/mail');
const { JWT_SECRET, ADMIN_EMAILS, CLIENT_ORIGIN } = require('../config/env');
```
(keep everything else already in the file), then append:

```js
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const RESET_TTL_MS = 30 * 60 * 1000;

// Always answers the same way so it cannot be used to find out who has an account.
exports.forgot = async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = email && (await User.findOne({ email }));
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await User.updateOne(
        { _id: user._id },
        { resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + RESET_TTL_MS) }
      );
      const link = `${CLIENT_ORIGIN}/reset?token=${token}&email=${encodeURIComponent(email)}`;
      mail.sendResetEmail(email, link).catch((e) => console.error('Reset email failed', e));
    }
    res.json({ message: 'If that email is registered, a reset link has been sent' });
  } catch (err) {
    next(err);
  }
};

exports.reset = async (req, res, next) => {
  try {
    const { email, token, password } = req.body || {};
    if ([email, token, password].some((v) => typeof v !== 'string' || !v)) {
      return res.status(400).json({ message: 'Email, token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    // One atomic update: only matches a live, unused token for this exact email, and consumes it.
    const user = await User.findOneAndUpdate(
      { email: email.trim().toLowerCase(), resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } },
      {
        $set: { password: await bcrypt.hash(password, 10) },
        $unset: { resetTokenHash: 1, resetTokenExpires: 1 },
        $inc: { tokenVersion: 1 },
      }
    );
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' });
    res.json({ message: 'Password updated, please log in' });
  } catch (err) {
    next(err);
  }
};
```

Replace `backend/src/routes/user.js`:

```js
const router = require('express').Router();
const { requireUser } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { register, login, me, forgot, reset } = require('../controllers/user');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot', authLimiter, forgot);
router.post('/reset', authLimiter, reset);
router.get('/me', requireUser, me);

module.exports = router;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS (all test files).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: password reset by emailed single-use token"
```

---

### Task 7: Frontend - forgot/reset pages and quota messaging

**Files:**
- Create: `frontend/src/pages/ForgotPassword/ForgotPassword.jsx`, `frontend/src/pages/ResetPassword/ResetPassword.jsx`
- Modify: `frontend/src/pages/Login/Login.jsx`, `frontend/src/pages/Login/Login.module.css`, `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `POST /api/user/forgot`, `POST /api/user/reset` and the reset link format from Task 6; `api` and `errorMessage` from `services/api.js`. 429 messages from rate limit/quota already reach users because pages show `errorMessage(err)`.

There is no frontend test setup, and the spec adds none; verification is a production build plus a manual pass (Step 5).

- [ ] **Step 1: Add the notice style**

Append to `frontend/src/pages/Login/Login.module.css`:

```css
.notice { margin: 0 0 12px; color: var(--ok); font-weight: 600; }
```

- [ ] **Step 2: Create the forgot-password page**

Create `frontend/src/pages/ForgotPassword/ForgotPassword.jsx`:

```jsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import api, { errorMessage } from '../../services/api'
import styles from '../Login/Login.module.css'

const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { data } = await api.post('/api/user/forgot', { email })
      setNotice(data.message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.Login}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginCardTitle}>
          <h1>Forgot password</h1>
          <VpnKeyIcon />
        </div>

        <input className={`field ${styles.input}`} type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        {error && <p className={`error-text ${styles.error}`} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <button type="submit" className={`btn ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Please wait...' : 'Send reset link'}
        </button>
        <Link className={styles.switch} to="/">Back to login</Link>
      </form>
    </div>
  )
}

export default ForgotPassword
```

- [ ] **Step 3: Create the reset page**

Create `frontend/src/pages/ResetPassword/ResetPassword.jsx`:

```jsx
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import api, { errorMessage } from '../../services/api'
import styles from '../Login/Login.module.css'

const ResetPassword = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const email = params.get('email')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/api/user/reset', { email, token, password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.Login}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginCardTitle}>
          <h1>New password</h1>
          <VpnKeyIcon />
        </div>

        {!token || !email ? (
          <p className={`error-text ${styles.error}`} role="alert">This reset link is incomplete. Request a new one.</p>
        ) : (
          <>
            <input className={`field ${styles.input}`} type="password" placeholder="New password" aria-label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            {error && <p className={`error-text ${styles.error}`} role="alert">{error}</p>}
            <button type="submit" className={`btn ${styles.submitBtn}`} disabled={busy}>
              {busy ? 'Please wait...' : 'Update password'}
            </button>
          </>
        )}
        <Link className={styles.switch} to="/forgot">Request a new link</Link>
      </form>
    </div>
  )
}

export default ResetPassword
```

- [ ] **Step 4: Wire the routes and the login link**

In `frontend/src/App.jsx` add the imports and routes:

```jsx
import ForgotPassword from './pages/ForgotPassword/ForgotPassword'
import ResetPassword from './pages/ResetPassword/ResetPassword'
```
```jsx
        <Route path="/" element={<Login />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
```

In `frontend/src/pages/Login/Login.jsx` add `import { Link, useNavigate } from 'react-router-dom'` (replacing the existing `useNavigate`-only import) and insert this line between the submit button and the existing mode-switch button, shown only in login mode:

```jsx
        {isLogin && <Link className={styles.switch} to="/forgot">Forgot password?</Link>}
```

- [ ] **Step 5: Build and verify manually**

Run (from `frontend/`): `npm run build`
Expected: build succeeds with no errors.

Manual pass (needs your real `.env`, so do it after Task 8's key rotation): start `npm run dev` in both folders, register a user, click "Forgot password?", submit the email, copy the `[mail disabled] password reset link` line from the backend console, open it, set a new password, confirm you land on the login page and can log in with it, and that the old link now says "invalid or has expired".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: forgot/reset password pages"
```

---

### Task 8: Config, docs, dependency audit and credential rotation

**Files:**
- Modify: `backend/.env.example`, `README.md`, `backend/package.json`/`package-lock.json` (via audit fixes), `frontend/package-lock.json`

- [ ] **Step 1: Document the new variables**

Append to `backend/.env.example`:

```
# max AI calls (analyze + generate) per user per UTC day
DAILY_AI_LIMIT=20
# password reset emails via https://resend.com (leave empty in dev: the link is printed in the server console)
RESEND_API_KEY=
MAIL_FROM=onboarding@resend.dev
```

In `README.md` add under "Run" a short section:

```markdown
## Limits and password reset
- Each user can make `DAILY_AI_LIMIT` (default 20) AI calls per UTC day; failed calls are not counted.
- Login/register/reset are limited to 10 attempts per 15 minutes per IP.
- Password reset emails go through Resend (`RESEND_API_KEY`, `MAIL_FROM`). Without a key the reset link is printed in the backend console (not in production).
- Tests: `cd backend && npm test` (first run downloads an in-memory MongoDB).
```

- [ ] **Step 2: Audit dependencies**

Run in `backend/` and then `frontend/`: `npm audit`
Fix high/critical issues with `npm audit fix` (do not use `--force` without looking at what it upgrades). Re-run `npm audit` and `npm test` (backend) / `npm run build` (frontend).
Expected: no high or critical findings remain, tests and build pass. If one cannot be fixed without a breaking upgrade, note it in the commit message instead of forcing it.

- [ ] **Step 3: Rotate credentials (manual, you do this)**

The real Cohere key and Mongo password in `backend/.env` have lived in an unversioned folder. In the Cohere dashboard create a new API key and delete the old one; in MongoDB Atlas change the database user's password. Update `backend/.env` locally. For deployment, set the values only in the host's environment settings. Then also set a new random `JWT_SECRET` (this logs everyone out, which is fine before launch).

- [ ] **Step 4: Full verification**

Run: `cd backend && npm test` then `cd ../frontend && npm run build`
Expected: all backend tests pass and the frontend builds.

- [ ] **Step 5: Commit**

```bash
git add -A
git status --short | grep -E "(^|/)\.env$" && echo "STOP: .env is staged" || true
git commit -m "chore: document limits and reset, audit dependencies"
```

---

## Self-review notes

- **Spec coverage:** rate limits (Task 2), quota + refunds + TTL (Task 4), helmet / 1mb / job_desc cap / email check / uploads removal (Tasks 1, 3), audit + rotation + 24h sessions (Tasks 5, 8), reset flow incl. tokenVersion and Resend (Tasks 5-7), `/health` + unhandledRejection + generic 500 (Task 1), tests (every task). The only intentional deviation (user limiter placed after `requireUser`, plus an IP backstop) is listed under Global Constraints.
- **Names used consistently:** `authLimiter`, `ipLimiter`, `userLimiter`, `analyzeInput`, `generateInput`, `requireQuota`, `req.refundQuota`, `tokenVersion`, `resetTokenHash`, `resetTokenExpires`, `sendResetEmail`, `h.start/stop/app/makeUser/tokenFor/ip`.
- **Known limit:** rate-limit counters live in process memory (fine for one instance; switch to a shared store if you ever run several).
