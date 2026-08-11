# Product Requirements Document
## AI-Powered Recruitment Platform (Backend)

**Version:** 1.0
**Owner:** [Your Name]
**Status:** Draft — Ready for Engineering
**Stack:** NestJS · Prisma · Neon (PostgreSQL) · Redis · BullMQ · LLM API (no RAG) · Cloudinary (file storage) · Stripe & Paystack (payments, test/sandbox mode) · Swagger · Docker · Render (free tier)

---

## 1. Summary

An AI-powered recruitment platform that helps recruiters discover and evaluate candidates, and helps candidates find jobs that actually match their skills. This is not a "Mini LinkedIn" clone — it's a job marketplace with a real application pipeline, deterministic candidate scoring, and AI used only where it adds genuine value (extraction, normalization, and explanation — not autonomous decision-making).

**Core loop:** Recruiter posts a job → AI extracts structured requirements → candidates are filtered and deterministically scored → AI explains the score → recruiter reviews and moves candidates through a hiring pipeline.

**Explicitly out of scope for v1:** RAG, vector database as a hard dependency, GPU/self-hosted LLM, always-on AI worker process, email verification, live/production payment processing (Stripe and Paystack run in test/sandbox mode only for v1).

---

## 2. Goals / Non-Goals

### Goals
- Real authorization model (roles + resource ownership), not just CRUD.
- A genuine, auditable application pipeline with status history.
- AI used for extraction, normalization, and explanation — never as the sole source of truth for a score.
- Deployable end-to-end on free/low-cost infrastructure (Render + Neon + Redis).
- Fully documented API (Swagger) and tested core flows.

### Non-Goals (v1)
- No RAG / document Q&A system.
- No mandatory vector database — pgvector is a v2 optimization, not a v1 dependency.
- No real-time messaging (recruiter ↔ candidate chat) — v2/backlog.
- No email verification flow (explicitly removed from scope — see §5.1).
- No autonomous AI hiring decisions — AI supports, never decides.

---

## 3. Roles & Permissions

| Role | Description |
|---|---|
| `USER` (Candidate) | Manages own profile, searches/saves jobs, applies, views own applications. |
| `RECRUITER` | Manages own company profile, creates/publishes/edits/deletes own jobs, views/manages applicants to own jobs, moves applicants through pipeline stages. |
| `ADMIN` | Manages users/recruiters, moderates jobs and reported content, suspends accounts, views platform-wide analytics. |

**Hard authorization rules (must be enforced at the service layer, not just the controller):**
- User A cannot view or modify User B's application.
- Recruiter A cannot access Recruiter B's job applicants or analytics.
- Only the owning recruiter (or Admin) can edit/publish/delete a job.
- Admin actions must be logged to the audit log (see §10).

---

## 4. Domain Model (high-level entities)

```
User
 ├── Profile (bio, location, skills, experience, education, portfolio links, resume, profile picture, completion %)
 └── PointsTransaction[] (provider, providerReference, packageId, points, amount, currency, status — badge tier is derived from the sum, never stored directly)

Company
 └── Job
      ├── JobSkill
      ├── JobAIAnalysis (structured requirements extracted by LLM)
      └── JobMatch (per-candidate score, generated on publish)

Application
 ├── ApplicationStatusHistory (audit trail of stage transitions)
 └── CandidateScore (score, level, matched/missing skills, AI explanation)

Notification
AuditLog
```

### Job status pipeline
`DRAFT → PUBLISHED → UNPUBLISHED / CLOSED`

### Application status pipeline (default)
```
APPLIED → SCREENING → SHORTLISTED → INTERVIEW → OFFER → HIRED
                                   → REJECTED (can occur from any stage)
```
Every transition writes an `ApplicationStatusHistory` row (actor, from-status, to-status, timestamp).

---

## 5. Functional Requirements

### 5.1 Authentication & Account
- Register / Login with email + password.
- JWT access tokens + refresh tokens with rotation.
- Password reset flow (request → token → reset).
- ~~Email verification~~ — **removed from scope**. Accounts are active immediately on registration. (If added later, treat as a separate ticket; do not block registration/login on it in v1.)
- Logout / refresh token revocation.

### 5.2 User Profile
- CRUD on profile: name, bio, location, skills, experience, education, portfolio links, resume upload, profile picture.
- Server-computed **profile completion percentage**.
- Public profile view (subset of fields).
- Report a user (feeds Admin moderation queue — see §3, §5.10). ~~Follow/connect other users~~ and ~~block a user~~ — **cut from v1**: neither has a consuming feature in this PRD (no feed/activity stream for follow to power, no discovery filtering built for block); revisit only if a feed or messaging feature is added later.

**File uploads (resume + profile picture):**
- Storage: **Cloudinary** (no local disk storage; upload buffer is streamed to Cloudinary, only the returned secure URL + public ID are persisted in Neon).
- Resume: **PDF only** (`application/pdf`), max **5 MB**.
- Profile picture: max **5 MB** (standard image types — JPEG/PNG/WebP).
- Validation (mimetype + size) happens in a Nest `ParseFilePipe`/custom pipe **before** the buffer is sent to Cloudinary — never trust the client-provided `Content-Type` alone; sniff magic bytes.

### 5.3 Company & Recruiter
- Recruiter creates/edits a company profile.
- Company profile is publicly viewable.

### 5.4 Job Management
- Recruiter: create, edit, delete, publish, unpublish jobs.
- Job fields: `title, description, companyId, location, employmentType, workMode, salaryRangeMin/Max, experienceLevel, skills[], applicationDeadline, status`.
- On **publish**, queue AI job analysis + candidate matching (async — see §7).

### 5.5 Job Discovery
- Search by keyword (title, description, skills, company, location) — PostgreSQL full-text search for v1.
- Filters: skills, location, salary range, experience level, employment type, work mode.
- Sort: newest first (v1); relevance/match score later.
- Save job / share job (generate shareable link).

### 5.6 Applications
- `POST /jobs/:id/apply` creates an `Application` with initial status `APPLIED` and an immediate deterministic score (see §8) computed synchronously (cheap, no LLM call required at apply time).
- Recruiter can move an applicant through pipeline stages; each move is validated (no skipping rules required for v1, but log every transition).
- Candidate can view own application list with current status and full status history.
- Recruiter can view a ranked list of applicants per job (`GET /jobs/:id/matches`), sorted by score.

### 5.7 AI Capabilities (see §7 for architecture — no RAG)
1. **AI Job Analyzer** — job description → structured requirements (required skills, preferred skills, min. years experience, inferred work mode/level).
2. **AI Match Explanation** — given a computed score, generate a short human-readable explanation of why a candidate is/isn't a good fit. Optionally generate application feedback for the candidate ("You could improve your chances by highlighting...").
3. **AI Job Description Generator** (recruiter tool) — short prompt → draft JD (responsibilities, requirements, nice-to-haves, benefits). Always goes through `Draft → AI generation → Recruiter review → Publish`; AI never publishes directly.

**Not in v1 — AI Resume Analyzer.** Candidates enter skills/experience/education directly on their profile (structured form input) instead of uploading a resume for AI extraction. This is deferred to backlog (see §12, Phase 4); resume upload can still exist as a plain file attachment on the profile, but it is not parsed or analyzed by AI in v1.

### 5.8 Candidate Scoring (deterministic — see §8)
- NestJS computes the score. AI never outputs the final number.
- Score bands mapped to a human label (Excellent/Strong/Potential/Weak/Poor).

### 5.9 Notifications
- In-app notifications for: application status change, new job matching profile, profile viewed (optional/v2), recruiter message (if messaging is added later).
- Email notifications via a BullMQ worker (transactional, e.g. status change) — separate from the removed email-verification flow.

### 5.10 Analytics (Recruiter/Admin)
- Recruiter: jobs posted, active jobs, total applications, funnel counts per stage (screening/shortlisted/interview/offer/hired), conversion rate, average time-to-shortlist, applications over time, top candidate skills.
- Admin: platform-wide versions of the above plus user/recruiter counts and moderation queue size.

### 5.11 Audit Log
Track at minimum: `USER_CREATED, JOB_CREATED, JOB_PUBLISHED, APPLICATION_SUBMITTED, APPLICATION_STATUS_CHANGED, ROLE_CHANGED, ACCOUNT_SUSPENDED`. Each entry: `actor, action, target, timestamp, metadata`.

### 5.12 Points & Badges (Gamification)
- Any authenticated user (either role) can purchase **point packages** with real money. Points are cumulative and **never spent** — they exist purely to determine a **badge tier** displayed on the user's profile (a status/reputation signal, not a currency redeemable for anything else in v1).
- **Payment provider is user-selected at checkout, not auto-detected by IP/geo** (v1 simplification — see §13 open questions): **Stripe** for users outside Nigeria, **Paystack** for users within Nigeria.
- **Test/sandbox mode only for v1** — no live payment credentials, no real money moves. Stripe test secret keys (`sk_test_...`) and Paystack test secret keys, plus each provider's published test card numbers, are used throughout.
- A `PointsTransaction` ledger row is created (`status: PENDING`) the moment checkout is initiated. Points are only credited — `status: COMPLETED` — once the provider's **webhook** confirms the payment server-to-server. The client's post-checkout redirect is a UX convenience only and is never trusted to grant points (same "never trust the client" principle already applied to AI processing in §7).
- Badge tier is **server-computed** from `SUM(points) WHERE status = 'COMPLETED'` for that user, the same "derive, don't store" approach already used for profile completion % (§5.2) — there is no separate mutable `badge` field to fall out of sync.

#### Point Packages (v1 pricing — illustrative, easy to retune later)
| Package | Points | Stripe (USD) | Paystack (NGN) |
|---|---|---|---|
| Starter Pack | 100 | $5 | ₦4,000 |
| Growth Pack | 500 | $20 | ₦15,000 |
| Pro Pack | 1,500 | $50 | ₦35,000 |
| Elite Pack | 5,000 | $150 | ₦100,000 |

#### Badge Tiers (4 levels, cumulative lifetime points)
| Badge | Points Required |
|---|---|
| Bronze | 0 (default — every user starts here) |
| Silver | 500 |
| Gold | 2,000 |
| Platinum | 5,000 |

---

## 6. API Surface (representative — full spec lives in Swagger at `/api/docs`)

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/password-reset/request
POST   /auth/password-reset/confirm

GET    /users/me
PATCH  /users/me
GET    /users/:id            (public profile)
POST   /users/:id/report

POST   /companies
PATCH  /companies/:id
GET    /companies/:id

POST   /jobs
PATCH  /jobs/:id
DELETE /jobs/:id
POST   /jobs/:id/publish
POST   /jobs/:id/unpublish
GET    /jobs                 (search + filters)
GET    /jobs/:id
GET    /jobs/:id/matches     (ranked candidates, recruiter only)

POST   /jobs/:id/apply
GET    /applications/me
GET    /applications/:id
PATCH  /applications/:id/status   (recruiter only)

GET    /notifications
PATCH  /notifications/:id/read

GET    /analytics/recruiter
GET    /analytics/admin

GET    /points/packages
POST   /points/checkout            (body: packageId, provider — returns a hosted checkout URL)
GET    /points/me                  (balance, badge tier, transaction history)
GET    /points/transactions/:reference   (poll a single transaction's status post-redirect; triggers active reconciliation with the provider if still PENDING)
POST   /payments/stripe/webhook
POST   /payments/paystack/webhook

GET    /health
```

---

## 7. AI Architecture (no RAG)

**Principle:** the LLM extracts and normalizes structured data and explains results. NestJS owns filtering, scoring, and ranking.

```
Recruiter publishes job
        │
        ▼
Save job (status=PUBLISHED) → Neon
        │
        ▼
Enqueue "analyze-job" (BullMQ)
        │
        ▼
Worker: LLM extracts structured requirements
        │
        ▼
Store JobAIAnalysis → Neon
        │
        ▼
Query + hard-filter candidate pool (SQL)
        │
        ▼
Deterministic scoring (NestJS service, no LLM)
        │
        ▼
Store top-N JobMatch rows → Neon
        │
        ▼
GET /jobs/:id/matches reads from Neon (no LLM call on read)
```

- **v1 has no vector DB dependency.** Skill matching is done via normalized skill names (AI normalizes synonyms like "Postgres" → "PostgreSQL" once, at ingestion time — not at query time).
- **pgvector is an explicit v2/backlog item** — only add it if simple skill-based matching proves insufficient. If added, embeddings are stored directly in Neon/Postgres; do not introduce a separate vector database.
- Never call the LLM once per candidate in a loop. Order of operations: SQL hard filters → (optional, v2) vector search → deterministic scoring on the remaining shortlist → LLM explanation only for the final top N.
- Never run AI processing synchronously inside a request handler. Enqueue a job, return `202`/`status: PROCESSING`, and let a worker persist the result.

### Async processing on Render free tier
- Keep AI work asynchronous and idempotent so it doesn't need a permanently running worker process; a queued job that gets picked up on the next available cycle is fine.
- Persist `aiAnalysisStatus: PROCESSING | COMPLETED | FAILED` on the job/application so the frontend can poll instead of blocking on a request.
- If free-tier constraints make a dedicated worker impractical, process the queue from within the same API process on a schedule/trigger — but keep the job/worker separation in the code so it can be split out later without a rewrite.

---

## 8. Deterministic Scoring Model

```
score =
    requiredSkillsMatch   * 0.40 +
    preferredSkillsMatch  * 0.15 +
    experienceMatch       * 0.20 +
    semanticSimilarity    * 0.20 +   // 0 in v1 if pgvector not yet implemented; redistribute weight to other factors, or omit and re-normalize
    profileCompleteness   * 0.05
```

**v1 without embeddings:** drop `semanticSimilarity` and re-normalize the remaining weights (e.g. required 45%, preferred 20%, experience 25%, completeness 10%) — engineering can tune exact weights, but the score must be reproducible and unit-testable.

### Score → label mapping
| Score | Label |
|---|---|
| 90–100 | Excellent Match |
| 75–89 | Strong Match |
| 60–74 | Potential Match |
| 40–59 | Weak Match |
| 0–39 | Poor Match |

### Example response shape
```json
{
  "candidateId": "usr_123",
  "jobId": "job_456",
  "score": 92,
  "level": "EXCELLENT_MATCH",
  "matchedSkills": ["NestJS", "TypeScript", "PostgreSQL", "Redis"],
  "missingSkills": ["Kubernetes"],
  "experienceMatch": true,
  "explanation": "Strong match with all required skills and four years of backend experience."
}
```

---

## 9. Caching (Redis)

Cache read-heavy, low-volatility endpoints:
- `GET /jobs`, `GET /jobs/:id`, `GET /jobs/recommended`, `GET /companies/:id`

Invalidate on: job created, updated, deleted, published, unpublished.

---

## 10. Non-Functional Requirements

- **Security:** JWT auth, refresh token rotation, bcrypt/argon2 password hashing, RBAC, resource-ownership checks on every mutating endpoint, request validation (class-validator DTOs), rate limiting, CORS, Helmet, input sanitization, file upload type/size validation.
- **Payments:** raw card data never touches our server — both Stripe and Paystack are used via their hosted checkout pages, so we only ever handle provider-generated references. Every webhook endpoint verifies the provider's signature before trusting the payload (Stripe: `stripe-signature` header + webhook secret; Paystack: `x-paystack-signature` header, HMAC SHA512). Points are credited exactly once per transaction (idempotency key = provider's event/transaction ID) to survive webhook retries.
- **Observability:** structured logging, request IDs, centralized error handling, `GET /health` returning DB/Redis/queue status.
- **API docs:** Swagger/OpenAPI exposed at `/api/docs`.
- **Testing:** unit tests for `AuthService`, `JobService`, `ApplicationService`, `MatchingService`; integration tests for create-job / apply-to-job / change-status / AI matching; one E2E test covering register → create profile → post job → search → apply → shortlist → notification.

---

## 11. Suggested Module Structure

```
src/
├── auth/
├── users/
├── profiles/
├── companies/
├── jobs/
├── applications/
├── matching/          ← deterministic scoring lives here, not in ai/
├── ai/
│   ├── ai.module.ts
│   ├── job-analyzer.service.ts
│   └── explanation.service.ts
├── notifications/
├── search/
├── analytics/
├── audit/
├── points/            ← packages, balance, badge-tier computation (business logic, no provider SDKs)
├── payments/          ← Stripe/Paystack SDK wrappers, checkout session creation, webhook handlers
└── common/
```

---

## 12. Build Phases

**Phase 1 — Foundation**
Auth (no email verification) · RBAC · user profiles · company profiles · jobs CRUD · applications · application status workflow.

**Phase 2 — Backend Engineering**
Redis caching · BullMQ workers · notifications · audit logs · rate limiting · full-text search · Swagger · tests.

**Phase 3 — AI (no RAG)**
Deterministic job↔candidate matching · AI candidate ranking · AI job description generator · AI match/application explanations.

**Phase 4 — Backlog / v2**
AI resume parsing (resume → structured profile) · pgvector-based semantic matching · real-time recruiter↔candidate messaging · advanced analytics · full observability/metrics · follow/connect between users and user-blocking (cut from v1 — see §5.2; only worth revisiting alongside a feed or messaging feature).

**Phase 5 — Monetization (Points & Badges)**
Point packages · Stripe integration (non-Nigeria) · Paystack integration (Nigeria) · webhook-based point crediting · badge tier computation. Test/sandbox mode only. Only depends on Auth + Users, so it can be built any time after Phase 1 — doesn't need to wait for Jobs/Applications.

---

## 13. Open Questions for Engineering

1. Which LLM provider/model, and what are the cost/rate-limit constraints on Render free tier?
2. ~~Resume upload: accept PDF only, or also DOCX? What's the max file size?~~ **Resolved:** PDF only, max 5 MB. Profile picture also max 5 MB. Both stored in Cloudinary (see §5.2).
3. Do we need multi-company support per recruiter, or one company per recruiter account for v1?
4. Confirm password-reset delivery channel (email) still needs a transactional email provider even though verification is removed — same provider can likely serve both password reset and status-change notifications.
5. Payment provider selection: v1 assumes the user manually picks "Pay with Stripe" vs "Pay with Paystack" at checkout (no IP/geo auto-detection). Confirm that's acceptable, or whether geo-detection should be added later.
6. Points are modeled as purely cumulative (never decremented/spent) in v1 — confirm there's no near-term plan to make points a spendable currency (e.g. unlocking features), since that would change the data model (ledger would need debit rows, not just credits).
7. Webhook reliability: what's the fallback if a webhook never arrives (payment succeeds provider-side but the webhook is lost/delayed)? v1 minimum: a scheduled job that reconciles `PENDING` transactions older than N minutes against the provider's API directly.
