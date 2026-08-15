# Recruitment Platform (Backend)

A NestJS backend for a job marketplace: recruiters post and publish jobs, candidates apply, applications move through a real hiring pipeline with a full audit trail, and both sides get live updates over Server-Sent Events. AI is deliberately *not* used to make hiring decisions — see the [PRD](./prd-ai-recruitment-platform.md) for the reasoning.

Built as a from-scratch learning project — every module was built one deliberate slice at a time, with the reasoning behind each design decision documented as it was made. See [`prd-ai-recruitment-platform.md`](./prd-ai-recruitment-platform.md) for the full product spec (including what was cut and why), [`api-docs.md`](./api-docs.md) for the complete endpoint reference, and [`sse-and-notifications-explained.md`](./sse-and-notifications-explained.md) for a line-by-line walkthrough of the real-time notification system.

## Stack

- **NestJS 11** (Express adapter), TypeScript, real ESM (`"type": "module"`)
- **Prisma 7** + **Neon** (serverless Postgres) — driver-adapter based (`@prisma/adapter-pg`)
- **Redis** (Upstash) — response caching for job search/detail, via a hand-rolled `RedisService`, not Nest's `CacheModule`
- **Cloudinary** — resume/profile-photo storage
- **Stripe** — points-purchase checkout + webhook-verified crediting
- **Arcjet** — attack-shielding + rate limiting
- **JWT** access/refresh tokens with rotation, `bcryptjs` password hashing
- **Server-Sent Events** — live job-published and application-status-changed notifications
- **class-validator** / **class-transformer** — request validation

## Documentation

| Doc | What it's for |
|---|---|
| [`prd-ai-recruitment-platform.md`](./prd-ai-recruitment-platform.md) | The product spec — goals, domain model, what's explicitly out of scope, and every open question/decision made along the way |
| [`api-docs.md`](./api-docs.md) | Every endpoint: method, auth requirements, request body, response shape, error cases — written for frontend integration |
| [`sse-and-notifications-explained.md`](./sse-and-notifications-explained.md) | How the real-time notification system actually works, line by line |

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill in real values. Every variable is required — the app fails fast (`ConfigService.getOrThrow`) rather than silently running with missing config.

| Variable(s) | Where to get it |
|---|---|
| `DATABASE_URL` | [Neon](https://neon.tech) — create a project, copy the pooled connection string |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | [Cloudinary](https://cloudinary.com) dashboard home page |
| `STRIPE_SECRET_KEY` | Stripe Dashboard (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Stripe CLI for local dev: `stripe listen --forward-to localhost:3000/payments/stripe/webhook` prints it directly |
| `REDIS_URL` | [Upstash](https://upstash.com) Redis — free tier, gives a single connection string |
| `ARCJET_KEY` | [Arcjet](https://arcjet.com) dashboard |
| `JWT_SECRET`, `API_KEY` | Any long random string — these are app-internal secrets, not third-party credentials |
| `DEFAULT_RECRUITER_EMAIL` / `DEFAULT_RECRUITER_PASSWORD` | Your choice — credentials for the seeded recruiter account (see step 4) |
| `FRONTEND_URL` | Any valid URL for now — no real frontend exists yet, but Stripe Checkout requires a real redirect target |

### 3. Run migrations
```bash
npx prisma migrate dev
```
> **Windows note:** if a migration hangs or times out, it's usually Neon's free-tier database waking from suspend — just retry.

### 4. Seed a recruiter account
There's no self-service way to become a `RECRUITER` (registration always defaults to `USER`, and there's no admin role-management endpoint) — this seeds one from `DEFAULT_RECRUITER_EMAIL`/`DEFAULT_RECRUITER_PASSWORD`. Safe to re-run.
```bash
npm run seed
```

### 5. Run the dev server
```bash
npm run start:dev
```

## Every request needs two headers

- `x-api-key: <API_KEY>` — required on **every** route (enforced globally, one deliberate exception: the Stripe webhook, since Stripe's servers don't know about this header).
- `Authorization: Bearer <accessToken>` — required on routes marked auth-required in `api-docs.md`.

Missing either → `401`. This trips up first-time testers more than anything else in the API.

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Dev server, watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build (`node dist/src/main`) |
| `npm run seed` | Ensure the default recruiter account exists (idempotent) |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier |
| `npm test` / `test:watch` / `test:cov` | Jest unit tests |
| `npm run test:e2e` | End-to-end tests |

`prisma generate` runs automatically after every `npm install` via a `postinstall` hook — the generated Prisma client (`generated/prisma/`) is gitignored, so this is required for the app to start at all on a fresh clone.

## Testing the API

No frontend exists yet. Test with Postman (or any HTTP client) against `api-docs.md`'s endpoint reference — it documents exact request/response shapes for every route, including the SSE stream and the Stripe checkout/reconciliation flow.

Quick path to a working end-to-end test:
1. `POST /auth/register` a candidate, `POST /auth/login` both the candidate and the seeded recruiter.
2. Recruiter: `POST /companies` → `POST /jobs` → `POST /jobs/:id/publish`.
3. Candidate: `GET /jobs` → `POST /jobs/:id/apply`.
4. Recruiter: `GET /jobs/:id/applications` → `PATCH /applications/:id/status`.
5. Candidate: `GET /notifications` (or connect to `GET /notifications/stream` beforehand for live push).

## Deployment

`render.yaml` defines a Render Blueprint — connect the repo, apply the blueprint, fill in the `sync: false` secrets in Render's dashboard (same variables as `.env`). The build runs `prisma generate` automatically (`postinstall`), migrations and seeding run via `preDeployCommand` (`prisma migrate deploy && npm run seed`) before each deploy goes live.

After the first deploy, register a **separate** Stripe webhook endpoint pointing at the real deployed URL (`https://your-app.onrender.com/payments/stripe/webhook`) — the local `stripe listen` secret only works for local testing.

## Project structure

```
src/
├── module/              ← feature modules (one per domain concept)
│   ├── auth/             register, login, refresh, logout, password reset
│   ├── users/             profile CRUD, resume/photo upload, public profile, report
│   ├── companies/        recruiter's company profile (one per recruiter)
│   ├── jobs/               CRUD, publish/unpublish, search+filters, list applicants
│   ├── applications/    apply, status pipeline, status history
│   ├── notifications/  SSE stream + persisted notifications + event listeners
│   ├── points/             point packages, badge computation
│   └── payments/       Stripe checkout session + webhook + reconciliation
├── lib/                  ← global infrastructure singletons (one per external service)
│   ├── database/        PrismaService
│   ├── cloudinary/      CloudinaryService
│   ├── stripe/            StripeService
│   └── redis/             RedisService (cache-aside helper)
├── common/             ← shared, cross-cutting building blocks
│   ├── guards/            JwtAuthGuard, RolesGuard, SseAuthGuard
│   ├── decorators/     @CurrentUser(), @Roles()
│   ├── interfaces/      JwtPayload
│   └── types/              Express Request augmentation
└── app.module.ts        root module — wiring, global middleware/guards
```

`src/user/`, `src/guards/`, `src/middleware/` are earlier scaffold code that predates the `src/module/`/`src/common/` convention above — left in place, not wired into the app.

## Known limitations

Documented honestly rather than silently — these were deliberate scope cuts, not oversights:

- **No AI features.** The PRD's AI job analysis, candidate matching/scoring, and `GET /jobs/:id/matches` were all cut. Applications carry no score.
- **No admin endpoints.** `ADMIN` exists as an authorization bypass throughout (can edit any company/job/application), but there's no user management, moderation actions on reports, or account suspension.
- **`GET /jobs` search is substring matching (`ILIKE`), not true Postgres full-text search** — functional, but no ranking/stemming.
- **Password reset delivery is a dev-only stub** — no email provider wired up; the reset token comes back directly in the API response.
- **No application withdrawal, job bookmarking, or job/company-level reporting** (only user-to-user reporting exists).
- **`GET /jobs/:id` has no status filter** — unlike search, it'll return a `DRAFT` job to anyone who has (or guesses) its ID.
- **No BullMQ/background job queue** — everything (including Stripe webhook handling) runs synchronously in the request/response cycle.
- **No `GET /health`, no analytics endpoints, no audit log** — all named in the PRD, none built yet.
