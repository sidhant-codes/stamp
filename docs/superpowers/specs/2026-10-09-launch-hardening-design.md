# Launch Hardening (Sub-project A) - Design

Date: 2026-10-09

## Context and intent

The app (Express 5 + MongoDB + Cohere backend, React + Vite + MUI frontend) began as a college major project. The goal is a **free product real users rely on**. Cohere calls cost money and the API is public, so the first step is making it safe to expose and cheap to run.

Decisions made in brainstorming:
- Product is **free**; limits exist to cap abuse and Cohere spend, not to bill.
- **Password reset only**, no email verification (accepted risk: fake-email signups, blunted by rate limits and quota).
- **20 AI calls per user per day** (analyze + generate combined).
- Session stays a **Bearer JWT in `localStorage`** (frontend and backend are on different origins; httpOnly cookies would add CSRF and cookie-CORS work for little gain here).

## Roadmap (this spec covers A only)

| # | Sub-project | Status |
|---|---|---|
| A | Launch hardening (this spec) | In design |
| B | Output people can use: PDF/DOCX export, templates, editor, saved generations | Later |
| C | Trustworthy analysis: deterministic scoring, validated JSON, rewrite suggestions, scanned-PDF error | Later |
| D | Operate it: wider tests, CI, deployment, error tracking, admin usage/cost view | Later |

## Scope

### 1. Rate limiting (`express-rate-limit`)
- `/api/user/login`, `/api/user/register`, `/api/user/forgot`, `/api/user/reset`: 10 requests / 15 min per IP.
- Remaining `/api` routes: 60 requests / min, keyed by user id when authenticated, else IP.
- `app.set('trust proxy', 1)` so the IP is correct behind the host's proxy (Render/Vercel). Over the limit returns 429 with the standard `{ message }` shape.

### 2. Daily AI quota
- New model `usage`: `{ user, day: 'YYYY-MM-DD' (UTC), count }` with a unique index on `(user, day)`.
- Middleware `requireQuota` on `POST /api/resume/analyze` and `/generate`, placed after `requireUser`:
  `findOneAndUpdate({user, day}, {$inc:{count:1}}, {upsert:true, new:true})`. If `count > DAILY_AI_LIMIT` (env, default 20), decrement it again and respond 429 `{ message, resetAt }` (next UTC midnight).
- If the controller later fails (AI error, unreadable PDF), the count is decremented so failed calls do not burn quota. Implemented by the middleware exposing `req.refundQuota()` that controllers call in their error path.
- Optional TTL index on `usage` (e.g. 7 days) to keep the collection small.
- The frontend shows remaining calls when the API returns a 429 message; no new dashboard in this sub-project.

### 3. Headers, caps and hygiene
- `helmet()` on the API.
- `express.json({ limit: '1mb' })`; `job_desc` capped at 6000 chars server-side and returned as 400 beyond that; basic email format check at registration.
- Delete `backend/uploads/` (uploads are parsed in memory now; the folder is unused leftovers).
- **Rotate the Cohere key and Mongo password** and keep real values only in the host's environment settings; `.env` stays out of any repository (`.gitignore` already lists it in `backend/`).
- `npm audit` pass on both packages and fix high/critical findings.
- Session lifetime reduced from 7 days to 24 hours.

### 4. Password reset
- `POST /api/user/forgot { email }`: always returns 200 with the same message. If the user exists, create a random 32-byte token, store only its SHA-256 hash plus expiry (30 minutes) on the user (`resetTokenHash`, `resetTokenExpires`), and email a link `CLIENT_ORIGIN/reset?token=...&email=...`.
- `POST /api/user/reset { email, token, password }`: validates hash and expiry, enforces the existing 6-character minimum, sets the new bcrypt hash, clears the token fields, and increments `tokenVersion` on the user.
- JWTs carry `tokenVersion`; `requireUser` rejects tokens whose version does not match, so old sessions die after a reset.
- Email sending: **Resend** via its HTTPS API using Node's built-in `fetch` (no new dependency), configured by `RESEND_API_KEY` and `MAIL_FROM`. If those are unset, the reset link is logged to the server console in development and the endpoint still returns 200.
- Frontend: a "Forgot password?" link on the login card, a `/forgot` page (email field) and a `/reset` page (new password field), using the existing form styles and `errorMessage` helper.

### 5. Ops basics
- `GET /health` returns `{ ok: true }` and reflects Mongo connection state.
- Process-level `unhandledRejection` logging.
- The error handler returns a generic message for 500s in production instead of raw error text (multer and validation errors keep their specific messages).

### 6. Tests
- `supertest` + `node:test` (no new test framework), with the Cohere service stubbed and an in-memory or test Mongo database.
- Cases: login rate limit returns 429 after 10 tries; 21st AI call in a day returns 429; a failed AI call refunds quota; expired reset token is rejected; a reset token cannot be reused; an old JWT is rejected after a reset.

## Out of scope
Email verification, httpOnly cookies, billing or plans, admin usage dashboard (D), export/templates (B), analysis changes (C), deployment (D).

## Error handling
- Limiter and quota responses use 429 and the existing `{ message }` shape, plus `resetAt` for quota.
- Forgot/reset never reveal whether an email is registered.
- If the mail provider fails, log the error and still return 200 (so the response cannot be used to probe accounts).

## New environment variables
`DAILY_AI_LIMIT` (default 20), `RESEND_API_KEY`, `MAIL_FROM` (all optional with the defaults above). Add them to `backend/.env.example`.

## Success criteria
- Hammering login or the AI routes gets 429 rather than unlimited access or an unbounded Cohere bill.
- A user cannot exceed 20 successful AI calls per UTC day.
- A user who forgot their password can regain access by email, and old sessions stop working.
- All tests above pass, and `npm audit` shows no high/critical issues.
