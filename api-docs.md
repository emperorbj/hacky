# API Reference — AI Recruitment Platform

Complete endpoint reference for frontend integration. Every endpoint, request body, and response shape below reflects the actual implementation, not the original PRD's aspirational design — where they diverge, the PRD lost.

## Base URL

Local: `http://localhost:3000`
Deployed: (fill in once deployed — see `render.yaml`)

## Global conventions — read this before anything else

### Every request needs an API key header
```
x-api-key: <API_KEY>
```
Enforced on **every** route except `POST /payments/stripe/webhook` (that one's called by Stripe's servers, not your frontend — you'll never need to call it directly). Missing or wrong key → `401`.

### Protected routes also need a bearer token
```
Authorization: Bearer <accessToken>
```
Each endpoint below is marked **Public** or **Auth required** (and which role, if restricted).

### Every successful response is wrapped the same way
```json
{
  "statusCode": 200,
  "success": true,
  "data": { }
}
```
The `data` field is what's documented as the "response" for each endpoint below — the actual payload is always nested one level in.

### Error responses are NOT wrapped the same way
```json
{
  "statusCode": 400,
  "message": "Validation failed" ,
  "error": "Bad Request"
}
```
`message` is sometimes a string, sometimes an array of strings (validation errors from multiple invalid fields at once). There's no `success` field on errors — check the HTTP status code, not a body field, to distinguish success from failure.

### No pagination exists anywhere yet
`GET /jobs`, `GET /applications/me`, `GET /notifications` all return **full arrays**, unbounded. Don't build pagination UI expecting `page`/`limit` params or a `total` count — none of that exists in this API yet.

### Rate limiting
Global limit of 10 requests per 60 seconds per IP address (Arcjet). Expect occasional `429` responses under rapid testing — not a bug.

### Content-Type
`application/json` for everything **except**:
- `PATCH /users/me/resume` and `PATCH /users/me/photo` — `multipart/form-data`
- `GET /notifications/stream` — Server-Sent Events (see its own section)

---

## Typical end-to-end flow

1. `POST /auth/register` → `POST /auth/login` (candidate)
2. Recruiter side already has a seeded account (`DEFAULT_RECRUITER_EMAIL`/`DEFAULT_RECRUITER_PASSWORD`) — log in directly, no registration needed for the recruiter.
3. Recruiter: `POST /companies` → `POST /jobs` → `POST /jobs/:id/publish`
4. Candidate: `GET /jobs` (browse) → `POST /jobs/:id/apply`
5. Recruiter: `GET /jobs/:id/applications` (see who applied) → `GET /applications/:id` (drill into one, optional) → `PATCH /applications/:id/status` (move through the pipeline)
6. Candidate: receives a live notification the moment status changes (`GET /notifications/stream`), or polls `GET /notifications`
7. Either side: `POST /points/checkout` → pay on Stripe's page → `GET /points/transactions/:reference` to confirm → `GET /points/me` for badge/balance

---

## Enums reference

| Enum | Values |
|---|---|
| `Role` | `USER`, `RECRUITER`, `ADMIN` |
| `JobStatus` | `DRAFT`, `PUBLISHED`, `UNPUBLISHED`, `CLOSED` |
| `EmploymentType` | `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP` |
| `WorkMode` | `REMOTE`, `HYBRID`, `ONSITE` |
| `ExperienceLevel` | `ENTRY`, `MID`, `SENIOR`, `LEAD` |
| `ApplicationStatus` | `APPLIED`, `SCREENING`, `SHORTLISTED`, `INTERVIEW`, `OFFER`, `HIRED`, `REJECTED` |
| `NotificationType` | `JOB_PUBLISHED`, `APPLICATION_STATUS_CHANGED` |
| `PaymentProvider` | `STRIPE` |
| `PaymentStatus` | `PENDING`, `COMPLETED`, `FAILED` |
| `Badge` (computed, never stored) | `BRONZE`, `SILVER`, `GOLD`, `PLATINUM` |

---

## Auth

### `POST /auth/register`
**Public.**

Request body:
```json
{
  "email": "candidate@example.com",
  "password": "Password123"
}
```
`password`: 8–72 characters, must contain at least one letter and one digit.

Response `201`:
```json
{
  "id": "cuid...",
  "email": "candidate@example.com",
  "role": "USER",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z"
}
```
Role always defaults to `USER` — there's no way to register as `RECRUITER`/`ADMIN` via this endpoint.

Errors: `409` — email already registered.

---

### `POST /auth/login`
**Public.**

Request body:
```json
{
  "email": "candidate@example.com",
  "password": "Password123"
}
```

Response `200`:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "a1b2c3...",
  "id": "cuid...",
  "email": "candidate@example.com",
  "role": "USER"
}
```
`accessToken`: JWT, short-lived (`JWT_ACCESS_EXPIRES_IN`, default 15m). `refreshToken`: opaque string, long-lived (`REFRESH_TOKEN_EXPIRES_IN_DAYS`, default 7 days).

Errors: `401` — invalid email or password (same message either way, deliberately — doesn't reveal which one was wrong).

---

### `POST /auth/refresh`
**Public** (the refresh token itself is the credential).

Request body:
```json
{ "refreshToken": "a1b2c3..." }
```

Response `200`:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "d4e5f6..."
}
```
**Rotation**: the refresh token you sent is immediately invalidated — you get a *new* one back. Store the new one, discard the old.

Errors: `401` — token invalid, expired, or already used.

---

### `POST /auth/logout`
**Public** (same reasoning as refresh).

Request body:
```json
{ "refreshToken": "a1b2c3..." }
```

Response `200`:
```json
{ "message": "Logged out" }
```
Always `200`, even if the token was already invalid/expired/nonexistent — idempotent by design.

---

### `POST /auth/password-reset/request`
**Public.**

Request body:
```json
{ "email": "candidate@example.com" }
```

Response `200`:
```json
{
  "message": "If an account with that email exists, a reset token has been issued.",
  "resetToken": "abc123..."
}
```
⚠️ **`resetToken` is a dev-only stub** — no email provider is wired up yet, so the reset token is returned directly in the response instead of being emailed. `resetToken` is **absent** if the email doesn't correspond to a real account (message is identical either way, but the field's presence differs — a known, documented gap, not a bug).

---

### `POST /auth/password-reset/confirm`
**Public.**

Request body:
```json
{
  "token": "abc123...",
  "newPassword": "NewPassword456"
}
```
`newPassword`: same rules as registration (8–72 chars, letter + digit).

Response `200`:
```json
{ "message": "Password has been reset. Please log in again." }
```
Side effect: **all existing refresh tokens for this user are revoked** — every other logged-in session is force-logged-out.

Errors: `400` — token invalid, expired, or already used.

---

### `GET /auth/me`
**Auth required.** Demo/debug endpoint — returns the raw decoded JWT payload, not fresh profile data.

Response `200`:
```json
{
  "sub": "cuid...",
  "email": "candidate@example.com",
  "role": "USER",
  "iat": 1723722000,
  "exp": 1723722900
}
```
For real profile data, use `GET /users/me` instead.

---

## Users

### `GET /users/me`
**Auth required.**

Response `200`:
```json
{
  "id": "cuid...",
  "userId": "cuid...",
  "bio": null,
  "location": null,
  "skills": [],
  "yearsOfExperience": null,
  "education": null,
  "portfolioLinks": [],
  "resumeUrl": null,
  "resumePublicId": null,
  "photoUrl": null,
  "photoPublicId": null,
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z",
  "completionPercentage": 0
}
```
`completionPercentage`: 0–100, computed from 8 fields (bio, location, skills, yearsOfExperience, education, portfolioLinks, resumeUrl, photoUrl), each worth 12.5%.

---

### `PATCH /users/me`
**Auth required.**

Request body (all fields optional — send only what's changing):
```json
{
  "bio": "Backend developer",
  "location": "Lagos, Nigeria",
  "skills": ["NestJS", "TypeScript", "PostgreSQL"],
  "yearsOfExperience": 3,
  "education": "B.Sc. Computer Science",
  "portfolioLinks": ["https://github.com/you"]
}
```
Constraints: `bio` max 1000 chars, `location` max 120, `education` max 500, `yearsOfExperience` integer 0–60, `portfolioLinks` must each be valid URLs.

Response `200`: same shape as `GET /users/me`, updated.

---

### `PATCH /users/me/resume`
**Auth required. `multipart/form-data`, not JSON.**

Form field: `file` — a single PDF, max 5MB. Validated by real content inspection (magic bytes), not just the filename/claimed type.

Response `200`: same shape as `GET /users/me`, with `resumeUrl`/`resumePublicId` now populated (a real Cloudinary URL).

Errors: `400` — not a PDF, or over 5MB.

---

### `PATCH /users/me/photo`
**Auth required. `multipart/form-data`, not JSON.**

Form field: `file` — a single image (JPEG/PNG/WebP), max 5MB.

Response `200`: same shape as `GET /users/me`, with `photoUrl`/`photoPublicId` populated.

---

### `GET /users/:id`
**Public.** Returns a subset of another user's profile — never their own private fields.

Response `200`:
```json
{
  "bio": "Backend developer",
  "location": "Lagos, Nigeria",
  "skills": ["NestJS", "TypeScript"],
  "yearsOfExperience": 3,
  "education": "B.Sc. Computer Science",
  "portfolioLinks": ["https://github.com/you"],
  "photoUrl": "https://res.cloudinary.com/...",
  "user": {
    "id": "cuid...",
    "role": "USER",
    "createdAt": "2026-08-15T12:00:00.000Z"
  }
}
```
Notice: no `email`, no `resumeUrl` — deliberately excluded from the public view.

Errors: `404` — no such user.

---

### `POST /users/:id/report`
**Auth required.**

Request body:
```json
{ "reason": "Posted a fake job listing asking for payment upfront" }
```
`reason`: 10–500 characters.

Response `200`:
```json
{ "message": "Report submitted" }
```

Errors: `400` — reporting yourself. `404` — target user doesn't exist.

---

## Companies

### `POST /companies`
**Auth required, `RECRUITER` role only.** One company per recruiter — enforced.

Request body:
```json
{
  "name": "Acme Corp",
  "description": "We build things",
  "website": "https://acme.example",
  "industry": "Software",
  "size": "11-50",
  "location": "Lagos, Nigeria"
}
```
Only `name` is required (2–150 chars). Everything else optional.

Response `201`:
```json
{
  "id": "cuid...",
  "name": "Acme Corp",
  "description": "We build things",
  "website": "https://acme.example",
  "industry": "Software",
  "size": "11-50",
  "location": "Lagos, Nigeria",
  "logoUrl": null,
  "logoPublicId": null,
  "recruiterId": "cuid...",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z"
}
```
Note: `logoUrl`/`logoPublicId` exist in the schema but there's **no upload endpoint for them yet** — always `null` for now.

Errors: `403` — not a recruiter. `409` — this recruiter already has a company.

---

### `PATCH /companies/:id`
**Auth required. Owning recruiter or `ADMIN` only.**

Request body: same fields as create, all optional.

Response `200`: updated company object (same shape as above).

Errors: `403` — authenticated, but not this company's owner (and not admin).

---

### `GET /companies/:id`
**Public.**

Response `200`: full company object (same shape as create's response).

Errors: `404`.

---

## Jobs

### `POST /jobs`
**Auth required, `RECRUITER` role only.** Uses the caller's own company automatically — no `companyId` in the request body.

Request body:
```json
{
  "title": "Backend Engineer",
  "description": "We're looking for a NestJS developer with 2+ years experience...",
  "location": "Remote",
  "employmentType": "FULL_TIME",
  "workMode": "REMOTE",
  "salaryRangeMin": 50000,
  "salaryRangeMax": 80000,
  "experienceLevel": "MID",
  "skills": ["NestJS", "PostgreSQL", "TypeScript"],
  "applicationDeadline": "2026-12-31T23:59:59.000Z"
}
```
Required: `title` (≥3 chars), `description` (≥20 chars), `employmentType`, `workMode`, `experienceLevel`, `skills` (array). Everything else optional.

Response `201`:
```json
{
  "id": "cuid...",
  "title": "Backend Engineer",
  "description": "...",
  "companyId": "cuid...",
  "location": "Remote",
  "employmentType": "FULL_TIME",
  "workMode": "REMOTE",
  "salaryRangeMin": 50000,
  "salaryRangeMax": 80000,
  "experienceLevel": "MID",
  "skills": ["NestJS", "PostgreSQL", "TypeScript"],
  "applicationDeadline": "2026-12-31T23:59:59.000Z",
  "status": "DRAFT",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z"
}
```
Every job starts as `DRAFT` — invisible to `GET /jobs` search until published.

Errors: `403` — not a recruiter. `404` — recruiter has no company yet (must `POST /companies` first).

---

### `GET /jobs`
**Public.** Search + filter. Only ever returns `PUBLISHED` jobs.

Query params (all optional):
| Param | Type | Notes |
|---|---|---|
| `keyword` | string | Matches against title OR description (substring, case-insensitive — not true full-text search) |
| `skills` | string[] | Repeat the param for multiple values: `?skills=NestJS&skills=TypeScript`. Matches jobs sharing **any** of the given skills |
| `location` | string | Substring match |
| `salaryMin` | number | Matches jobs whose range *overlaps* this minimum |
| `salaryMax` | number | Matches jobs whose range *overlaps* this maximum |
| `experienceLevel` | enum | Exact match |
| `employmentType` | enum | Exact match |
| `workMode` | enum | Exact match |

Response `200`: array of job objects (same shape as create's response).

Cached for 60 seconds server-side (Redis) — a change may take up to a minute to reflect, though publishing/editing/unpublishing a job actively clears the cache immediately.

---

### `GET /jobs/:id`
**Public.** Works for any job status (unlike the search list, which only shows `PUBLISHED`).

Response `200`: single job object.

Errors: `404`.

---

### `PATCH /jobs/:id`
**Auth required. Owning recruiter or `ADMIN` only.**

Request body: same fields as create, all optional. **Cannot change `status`** via this endpoint — use publish/unpublish instead.

Response `200`: updated job object.

---

### `DELETE /jobs/:id`
**Auth required. Owning recruiter or `ADMIN` only.**

Response `200`:
```json
{ "message": "Job deleted" }
```

---

### `POST /jobs/:id/publish`
**Auth required. Owning recruiter or `ADMIN` only.** No request body.

Response `200`: updated job object with `status: "PUBLISHED"`.

Side effect: broadcasts a live notification to every `USER`-role account (see Notifications section).

---

### `POST /jobs/:id/unpublish`
**Auth required. Owning recruiter or `ADMIN` only.** No request body.

Response `200`: updated job object with `status: "UNPUBLISHED"`.

---

### `POST /jobs/:id/apply`
**Auth required, `USER` role only.** No request body.

Response `201`:
```json
{
  "id": "cuid...",
  "candidateId": "cuid...",
  "jobId": "cuid...",
  "status": "APPLIED",
  "interviewMeetingLink": null,
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z",
  "job": {
    "id": "cuid...",
    "title": "Backend Engineer",
    "...": "...full job fields...",
    "company": { "id": "cuid...", "name": "Acme Corp", "...": "...full company fields..." }
  },
  "statusHistory": [
    {
      "id": "cuid...",
      "applicationId": "cuid...",
      "actorId": "cuid...",
      "fromStatus": null,
      "toStatus": "APPLIED",
      "createdAt": "2026-08-15T12:00:00.000Z"
    }
  ]
}
```
Note: **no score/match data** — the deterministic scoring feature described in the original PRD was cut from this build. Applications are created without any score field at all.

Errors: `403` — not a `USER` (recruiters/admins can't apply). `404` — job doesn't exist or isn't published. `409` — already applied to this job.

---

### `GET /jobs/:id/applications`
**Auth required. Owning recruiter or `ADMIN` only.** Lists every application submitted to this specific job — this is how a recruiter actually discovers who's applied (nothing else in the API surfaces that).

Response `200`: array of application objects, each with the candidate's identity and profile **inlined** (deliberately richer than the public profile view — see note below):
```json
[
  {
    "id": "cuid...",
    "candidateId": "cuid...",
    "jobId": "cuid...",
    "status": "APPLIED",
    "interviewMeetingLink": null,
    "createdAt": "2026-08-15T12:00:00.000Z",
    "updatedAt": "2026-08-15T12:00:00.000Z",
    "candidate": {
      "id": "cuid...",
      "email": "candidate@example.com",
      "role": "USER",
      "createdAt": "2026-08-15T11:00:00.000Z",
      "profile": {
        "bio": "Backend developer",
        "location": "Lagos, Nigeria",
        "skills": ["NestJS", "TypeScript"],
        "yearsOfExperience": 3,
        "education": "B.Sc. Computer Science",
        "portfolioLinks": ["https://github.com/you"],
        "resumeUrl": "https://res.cloudinary.com/.../resume.pdf",
        "photoUrl": "https://res.cloudinary.com/.../photo.jpg"
      }
    }
  }
]
```
⚠️ Notice `candidate.email` and `candidate.profile.resumeUrl` are both present here, even though `GET /users/:id` (the public profile endpoint) deliberately **hides** both. That's intentional, not a bug: a recruiter reviewing someone who applied to their own job has a legitimate reason to see contact info and a resume; a random visitor to a public profile doesn't. Same underlying data, different exposure rules depending on context.

No `job`/`statusHistory` nested here (unlike `GET /applications/:id`) — the recruiter already knows which job this is from the URL. Drill into `GET /applications/:id` for full detail on one specific applicant, including their status history.

Errors: `403` — authenticated, but not this job's owning recruiter (and not admin). `404` — job doesn't exist.

---

## Applications

### `GET /applications/me`
**Auth required.** Returns the caller's own applications (as candidate).

Response `200`: array of application objects (same nested shape as the apply response above), newest first.

---

### `GET /applications/:id`
**Auth required.** Viewable by: the candidate who applied, the recruiter who owns the job, or an admin.

Response `200`: single application object (same nested shape as above).

Errors: `403` — authenticated, but none of the above. `404`.

---

### `PATCH /applications/:id/status`
**Auth required. Owning recruiter or `ADMIN` only.**

Request body:
```json
{
  "status": "INTERVIEW",
  "meetingLink": "https://meet.google.com/abc-defg-hij"
}
```
`status`: one of the `ApplicationStatus` enum values. `meetingLink`: optional in general, **required** specifically when `status` is `"INTERVIEW"` (validated — omitting it in that case returns `400`). Must be a valid URL.

Response `200`:
```json
{
  "id": "cuid...",
  "candidateId": "cuid...",
  "jobId": "cuid...",
  "status": "INTERVIEW",
  "interviewMeetingLink": "https://meet.google.com/abc-defg-hij",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:05:00.000Z"
}
```
⚠️ **This response is flat — no nested `job`/`statusHistory`**, unlike `GET /applications/:id` and the apply response. If the frontend needs the full nested shape after a status update, follow up with `GET /applications/:id`.

Side effect: writes a new `ApplicationStatusHistory` row, and pushes a live notification to the candidate (see below) — including the meeting link when moving to `INTERVIEW`.

---

## Notifications

### `GET /notifications/stream`
**Auth required — but differently from every other endpoint.** Browsers' `EventSource` API can't set custom headers, so the token travels as a **query parameter**, not the `Authorization` header:

```
GET /notifications/stream?token=<accessToken>
```
(`x-api-key` still applies as a normal header if your SSE client supports it — Postman and browser `EventSource` both do.)

This is a **Server-Sent Events** stream, not a normal request/response — the connection stays open indefinitely, and the server pushes events down it as they happen. Two named event types arrive on this one connection:

**`job_published`** — fired when any job is published. `data` is the **full job object** (same shape as `GET /jobs/:id`):
```
event: job_published
data: {"id":"cuid...","title":"Backend Engineer","status":"PUBLISHED", ...}
```

**`application_status_changed`** — fired when one of the current user's applications changes status. `data` is the full `Notification` record (see `GET /notifications` below), including the meeting link in `metadata` when relevant:
```
event: application_status_changed
data: {"id":"cuid...","type":"APPLICATION_STATUS_CHANGED","message":"Your application for \"Backend Engineer\" is now INTERVIEW", "metadata":{"applicationId":"cuid...","status":"INTERVIEW","meetingLink":"https://meet.google.com/..."}, ...}
```

Frontend integration note: use this for live updates, but don't rely on it exclusively — always back it with the polling endpoints below (`GET /notifications`, `GET /points/transactions/:reference`) for anyone who wasn't connected when an event fired, or whose connection dropped.

---

### `GET /notifications`
**Auth required.** The polling/catch-up fallback for everything the stream might have missed.

Response `200`: array of notification objects, newest first:
```json
[
  {
    "id": "cuid...",
    "userId": "cuid...",
    "type": "APPLICATION_STATUS_CHANGED",
    "title": "Application update",
    "message": "Your application for \"Backend Engineer\" is now INTERVIEW",
    "metadata": {
      "applicationId": "cuid...",
      "status": "INTERVIEW",
      "meetingLink": "https://meet.google.com/abc-defg-hij"
    },
    "readAt": null,
    "createdAt": "2026-08-15T12:05:00.000Z"
  }
]
```
`metadata` shape varies by `type`:
- `JOB_PUBLISHED` → `{ "jobId": "cuid..." }` (lean — fetch `GET /jobs/:id` for details)
- `APPLICATION_STATUS_CHANGED` → `{ "applicationId": "...", "status": "...", "meetingLink": "..." | null }`

`readAt`: `null` until marked read.

---

### `PATCH /notifications/:id/read`
**Auth required.**

Response `200`: the notification object, with `readAt` now set to the current timestamp.

Errors: `404` — doesn't exist, or belongs to someone else (same response either way).

---

## Points & Payments

### `GET /points/packages`
**Public.**

Response `200`:
```json
[
  { "id": "starter", "name": "Starter Pack", "points": 100, "amountCents": 500 },
  { "id": "growth", "name": "Growth Pack", "points": 500, "amountCents": 2000 },
  { "id": "pro", "name": "Pro Pack", "points": 1500, "amountCents": 5000 },
  { "id": "elite", "name": "Elite Pack", "points": 5000, "amountCents": 15000 }
]
```
`amountCents`: USD cents (`500` = $5.00).

---

### `GET /points/me`
**Auth required.**

Response `200`:
```json
{
  "totalPoints": 600,
  "badge": "SILVER",
  "transactions": [
    {
      "id": "cuid...",
      "userId": "cuid...",
      "provider": "STRIPE",
      "providerReference": "cs_test_...",
      "packageId": "growth",
      "points": 500,
      "amount": 2000,
      "currency": "usd",
      "status": "COMPLETED",
      "createdAt": "2026-08-15T12:00:00.000Z",
      "updatedAt": "2026-08-15T12:01:00.000Z"
    }
  ]
}
```
`badge` thresholds (cumulative, `COMPLETED` transactions only): Bronze 0 / Silver 500 / Gold 2,000 / Platinum 5,000. `transactions` includes **all** statuses (`PENDING`/`FAILED` too), not just completed ones — filter client-side if you only want successful purchases.

---

### `POST /points/checkout`
**Auth required.**

Request body:
```json
{ "packageId": "growth" }
```
`packageId`: must match one of the IDs from `GET /points/packages`.

Response `201`:
```json
{ "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_..." }
```
Redirect the browser to `checkoutUrl` — this is a page on Stripe's own domain; the frontend never handles card details directly.

After payment, Stripe redirects back to `{FRONTEND_URL}/checkout/success?session_id=...` (or `/checkout/cancel`). **That redirect proves nothing on its own** — see the next endpoint.

Errors: `404` — unknown `packageId`.

---

### `GET /points/transactions/:reference`
**Auth required.** `:reference` is the `session_id` query param Stripe appended to your success-page redirect URL.

**This is the endpoint that makes the success page trustworthy.** Poll it after landing on the success page — every 1–2 seconds is reasonable — until it reports `COMPLETED`, and only then show a success UI. Don't trust the redirect itself.

Response `200`:
```json
{
  "id": "cuid...",
  "userId": "cuid...",
  "provider": "STRIPE",
  "providerReference": "cs_test_...",
  "packageId": "growth",
  "points": 500,
  "amount": 2000,
  "currency": "usd",
  "status": "PENDING",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z"
}
```
`status` is the field to watch: `PENDING` → still processing (keep polling), `COMPLETED` → done, show success UI, `FAILED` → show a failure state.

This endpoint actively checks with Stripe directly if still `PENDING` (not just passively waiting for a webhook), so it typically resolves faster than you'd expect even immediately after payment.

Errors: `404` — reference doesn't exist, or belongs to a different user.

---

## Suggested frontend polling pattern (checkout success page)

```
1. Read `session_id` from the URL query string.
2. Show a "Confirming your payment..." loading state.
3. GET /points/transactions/{session_id}
4. If status === "PENDING": wait ~1.5s, go to 3 (cap total wait at ~30-60s).
5. If status === "COMPLETED": fetch GET /points/me, show success + new badge/total.
6. If status === "FAILED": show a failure state with a retry option.
```
