# Stamp

AI-powered resume analyzer and generator.

Sign up or log in with email + password, then:
- **Analyzer** – upload a PDF resume + paste a job description → AI match score, feedback, strengths and gaps (saved to history).
- **ATS checklist** – every analysis also runs free, code-only checks (no AI, no quota): email, phone, standard section headings, length, action-verb bullets, bullets with numbers, one date format, no first-person pronouns.
- **Analyzer** also returns matched / missing keywords and grounded rewrite suggestions (rewrites may only reword what is already in your resume). Re-analysing the same resume + job description returns the saved result without using quota.
- **Generator** – enter your details (optionally a target job) → AI writes an ATS-friendly resume. Edit it, then export as **PDF**, **Word (.docx)** or Markdown. Every generated resume is saved.
- **Improve** – after an analysis, tick the missing keywords you genuinely have and the AI rewrites your resume for that job (only facts from your resume plus the ticked keywords; lines with invented numbers, tech terms, unticked missing keywords or job-description tools/names you never mentioned are dropped). The rewrite is scored against the same job (saved to History as "Improved: …", and it can be improved again) and opens in the Generator with match score and keyword coverage before → after. One quota unit covers the rewrite and the re-score. **Compare with original** shows the words the rewrite added and the words of your original it dropped. Improve is also available from any analysis in History that kept its resume text (analyses made before this feature need to be re-run).
- **Templates** – Modern, Classic or Compact styling for the preview and PDF/Word export; the choice is saved with each resume.
- **History** – paginated analyses (with delete and a score trend) and your saved generated resumes. **Admin** – all users' analyses (role `admin` only).
- **Account** – delete your account and all its data.

## Structure
```
backend/   Express + MongoDB + Cohere   (src/config, models, middleware, services, controllers, routes)
frontend/  React + Vite + MUI           (src/pages, components, context, services)
docs/      Report, paper, PPT, declaration
```

## Run
```bash
cd backend  && cp .env.example .env   # fill in MONGO_URI, COHERE_API_KEY, JWT_SECRET, then:
npm install && npm run dev            # http://localhost:4000
cd frontend && cp .env.example .env
npm install && npm run dev            # http://localhost:5173
```

## Make someone an admin
Put their email in `ADMIN_EMAILS` (backend `.env`) before they register, or set `role: "admin"` on their document in the `users` collection.

## Limits and password reset
- Each user can make `DAILY_AI_LIMIT` (default 20) AI calls per UTC day; failed calls are not counted.
- Login/register/reset are limited to 10 attempts per 15 minutes per IP.
- Password reset emails go through Resend (`RESEND_API_KEY`, `MAIL_FROM`). Without a key the reset link is printed in the backend console (not in production).
- New accounts must verify their email (link valid 24h, sent like the reset email) before using the analyzer/generator. Accounts created before this feature are treated as verified.
- Storage caps per user: 100 analyses, 50 generated resumes (oldest are dropped).
- AI calls time out after 45s and retry twice on 429/5xx; unreadable JSON answers are retried once, then return 502 (quota refunded).
- Scanned (image-only) PDFs are not OCR'd: the user is told to upload a text-based PDF.
- Logs are structured JSON (pino) with a request id, also returned as the `X-Request-Id` header. `LOG_LEVEL` sets verbosity. `/health` reports DB state and uptime.
- CI (`.github/workflows/ci.yml`) runs backend tests + `npm audit`, and frontend tests + build.
- Tests: `cd backend && npm test`; `cd frontend && npm test` (first run downloads an in-memory MongoDB).
- Set `TRUST_PROXY` to the number of reverse proxies in front of the API (default 0). Behind a single proxy such as Render use `1`; otherwise per-IP rate limits see the proxy's address (everyone shares one bucket) or can be spoofed.
