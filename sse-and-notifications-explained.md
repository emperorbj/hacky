# SSE & Notifications — Full Walkthrough

This document explains, line by line, everything built for real-time notifications: publishing a job broadcasts to every candidate live, and moving an application to `INTERVIEW` pushes the interview details straight to that candidate — both delivered instantly to any client that's currently connected, on top of a normal persisted record either way.

It's written to stand on its own, so it re-explains a few concepts (RxJS, event buses, the SSE wire protocol) that hadn't come up anywhere else in the project before this feature.

---

## 1. The Big Picture — What Problem Are We Solving?

Every single endpoint built before this one follows the same shape: a client sends a request, the server does some work, the server sends back **one** response, and the connection closes. The server never speaks unless spoken to first.

That model has no way to say "hey, something happened, here's an update" to a client that isn't currently mid-request. If a recruiter publishes a job while a candidate is just sitting on the page, there is no request in flight for the server to answer — nothing to attach the news to.

There are three ways to solve this:

1. **Polling** — the client just asks over and over ("anything new? anything new? anything new?") every few seconds. Simple, but wasteful and never truly instant.
2. **WebSockets** — a full two-way channel. Overkill here since the client never needs to send real-time data back, only receive it.
3. **Server-Sent Events (SSE)** — a one-way channel, server → client only, built on plain HTTP. The client opens a connection and just... leaves it open. The server writes new chunks to that same open connection whenever it wants, for as long as the connection stays alive.

We picked SSE, since "notify the client" is inherently one-directional.

---

## 2. New Concepts This Feature Introduces

### RxJS `Observable` and `Subject`

RxJS (Reactive Extensions for JavaScript) is a library for working with streams of values over time, instead of just one value at a time. NestJS uses it internally, and it's the right tool for SSE specifically because `@Sse()` routes are required to return an `Observable`.

- An **`Observable`** is something you can *subscribe* to — you say "call this function every time a new value shows up" — but you cannot manually push a value into it from outside. It only knows how to emit what it's told to emit, from its own internal logic.
- A **`Subject`** is both an `Observable` *and* something you can manually push values into via `.next(value)`. It's the RxJS equivalent of a live broadcast channel: anyone holding a reference to it can shout into it, and everyone subscribed hears it immediately.

We need a `Subject` specifically because two *completely unrelated* pieces of code need to interact with the same stream: the SSE route handler (which needs to *return* something Nest can stream to the client) and the notification listener (which needs to *push a new value in*, from a totally different request, at a totally different time). A plain `Observable` can't be pushed into from outside; a `Subject` can.

### The Event Bus / Pub-Sub Pattern

"Pub-sub" (publish-subscribe) is a pattern where one piece of code announces "this happened" (**publishes** an event) without knowing or caring who — if anyone — is listening, and separate piece(s) of code independently **subscribe** to react to it. This is different from a normal function call, where the caller directly invokes a specific method on a specific object and waits for it.

We use `@nestjs/event-emitter` for this. `JobsService` calls `eventEmitter.emit('job.published', job)` and moves on — it has zero knowledge that `NotificationsListener` exists, or that anything will happen as a result. This is deliberate decoupling: `JobsModule` never imports `NotificationsModule`, and you could add a second, third, or tenth listener for that same event later without ever touching `JobsService` again.

### How SSE Actually Works on the Wire

An SSE response is just a normal HTTP response with a special content type (`text/event-stream`) that the server **never finishes sending**. Instead of one chunk, it's a sequence of small text blocks like:

```
event: job_published
data: {"id":"abc123","title":"Backend Engineer",...}

event: application_status_changed
data: {"id":"xyz789","status":"INTERVIEW",...}

```

Each block is separated by a blank line. The browser's `EventSource` API (or any SSE client) parses these as they arrive and fires a JavaScript event for each one. Nest's `@Sse()` decorator handles all of this formatting for you — your code just deals with plain objects, and Nest turns each one into a properly-formatted chunk.

### In-Memory Server State

Every service built before this one (`AuthService`, `JobsService`, etc.) is **stateless** — it holds no data between requests; everything it needs comes from the database or from the request itself. `SseService` is the first exception: it holds a live, in-memory record of *who is currently connected*, for as long as this server process keeps running. This matters because that state disappears if the process restarts, and — as covered below — doesn't exist on any *other* server process if this app ever runs on more than one instance at once.

### Prisma `Json` Columns

Up to now, every database column has had a specific fixed type (`String`, `Int`, `DateTime`, an enum...). A `Json` column can hold **any** JSON-shaped value — an object, array, whatever — with no fixed structure enforced by the schema. We use this for `Notification.metadata` because different notification types carry different extra data, and adding a dedicated nullable column for every possible type-specific field would be wasteful.

---

## 3. The Database Layer — `prisma/schema.prisma`

```prisma
enum NotificationType {
  JOB_PUBLISHED
  APPLICATION_STATUS_CHANGED
}
```
A normal Prisma enum (same mechanism as `Role`, `JobStatus`, etc. elsewhere in the schema) — the database itself will reject any value that isn't one of these two.

```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  title     String
  message   String
  metadata  Json?
  readAt    DateTime?
  createdAt DateTime         @default(now())

  @@map("notifications")
}
```
- `userId` / `user` — a normal foreign key: which user this notification belongs to.
- `type` — which of the two `NotificationType` values this is, so a frontend can decide how to render it (e.g. a different icon for a new job vs. an application update).
- `title` / `message` — plain human-readable text, precomputed by the backend so the frontend doesn't need its own copy of "how do I phrase this."
- `metadata Json?` — the flexible extra-data field described above. For a `JOB_PUBLISHED` notification it holds `{ jobId: "..." }`; for `APPLICATION_STATUS_CHANGED` it holds `{ applicationId, status, meetingLink }`.
- `readAt DateTime?` — nullable timestamp. `null` means unread; a real timestamp means read, and tells you exactly when. This is the same pattern used elsewhere in the schema for `RefreshToken.revokedAt` and `PasswordResetToken.usedAt` — "null = hasn't happened yet, timestamp = happened, and here's when."

On `User`, one line was added to link back to this new table:
```prisma
notifications Notification[]
```
A user can have many notifications — a plain one-to-many, same shape as `refreshTokens`/`applications`/etc. already on that model.

---

## 4. The Connection Registry — `src/module/notifications/sse.service.ts`

```ts
import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class SseService {
  private readonly connections = new Map<string, Set<Subject<MessageEvent>>>();
```
- `MessageEvent` is a type Nest itself exports from `@nestjs/common`, specifically shaped for SSE: `{ data: any, type?: string, id?: string, retry?: number }`. It's what an SSE handler is expected to emit.
- `connections` is a `Map` where the key is a `userId` (a string) and the value is a `Set` of `Subject`s. Using a `Set` (not just a single `Subject`) means one user can have **multiple simultaneous connections** — the same account open in two browser tabs, or a laptop and a phone at once — without one connection silently kicking out the other.

```ts
  connect(userId: string): Subject<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const userConnections = this.connections.get(userId) ?? new Set();
    userConnections.add(subject);
    this.connections.set(userId, userConnections);
    return subject;
  }
```
Called once per new SSE connection. Creates a fresh `Subject` for this specific connection, adds it to that user's set (creating the set if this is their first connection, via `?? new Set()`), and hands the `Subject` back to the caller (the controller, which returns it as the stream).

```ts
  disconnect(userId: string, subject: Subject<MessageEvent>): void {
    this.connections.get(userId)?.delete(subject);
  }
```
The cleanup half. Removes exactly one `Subject` from that user's set — the `?.` (optional chaining) means "if this user has no entry at all, just do nothing, don't throw." Called when the underlying HTTP connection actually closes (see the controller section).

```ts
  sendToUser(userId: string, event: MessageEvent): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return;
    }
    for (const subject of userConnections) {
      subject.next(event);
    }
  }
}
```
The "push a live update" half. If the target user has no open connections at all, this quietly does nothing — the notification still gets persisted to the database elsewhere, it just isn't delivered live (the user will see it next time they poll `GET /notifications`). If they do have open connections, `.next(event)` is called on *every* one — pushing the same event to every tab/device they have open.

**A limitation worth knowing**: this `Map` lives entirely in this one Node process's memory. If this app ever runs as more than one server instance at once, a connection open on instance A is completely invisible to instance B — an event handled by B would never reach a user connected to A. Fixing that (if it's ever needed) means adding a shared layer like Redis pub/sub so all instances can see all connections. Not a concern for a single instance today, just a ceiling worth knowing about.

---

## 5. Authenticating the Stream — `src/common/guards/sse-auth.guard.ts`

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface.js';

@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.query.token;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return true;
  }
}
```

Every other protected route in this project uses `JwtAuthGuard`, which reads the token from an `Authorization: Bearer <token>` header. This guard exists because **browsers' `EventSource` API — the standard way to consume SSE — cannot set custom headers at all.** There's no way to attach `Authorization` to an `EventSource` connection. The token has to travel some other way, and the standard workaround is a query parameter on the URL itself: `?token=...`.

- `request.query.token` — reads it from the URL's query string instead of a header.
- `typeof token !== 'string'` — query params can technically come through as an array if the same key appears twice in the URL (`?token=a&token=b`); this guards against that edge case, only accepting a single plain string.
- Everything else — verifying the JWT via `jwtService.verifyAsync`, catching failures as a generic `401`, attaching the decoded payload to `request.user` — is identical to `JwtAuthGuard`.

**Why this is a separate class instead of just adding this fallback to `JwtAuthGuard` itself**: doing that would mean *every* protected endpoint in the whole app would suddenly also accept a token via URL query string — and URLs get logged by proxies, browsers' history, and server access logs far more readily than header values do. Keeping this in its own small class means that trade-off stays scoped to the one route that genuinely needs it, instead of quietly weakening the auth model everywhere else.

---

## 6. Wiring Up the Event Bus — `src/app.module.ts`

```ts
import { EventEmitterModule } from '@nestjs/event-emitter';
...
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ...
```
`EventEmitterModule.forRoot()` registers `EventEmitter2` (the actual pub-sub engine) as a **global** provider — meaning any service anywhere in the app can inject it via its constructor without that service's own module needing to explicitly import `EventEmitterModule`. This is the same "register once, usable everywhere" pattern already used for `ConfigModule` (`isGlobal: true`) and the custom `PrismaModule`/`CloudinaryModule` (marked `@Global()`).

---

## 7. Describing an Event's Shape — `src/module/notifications/events/application-status-changed.event.ts`

```ts
import { ApplicationStatus } from '../../../../generated/prisma/enums.js';

export interface ApplicationStatusChangedEvent {
  applicationId: string;
  candidateId: string;
  jobTitle: string;
  status: ApplicationStatus;
  meetingLink?: string | null;
}
```
A plain TypeScript `interface` — no decorators, no runtime behavior, purely a type. `EventEmitter2.emit()` can technically be called with any payload shape, since events aren't type-checked by the library itself the way, say, a DTO's fields are checked by `ValidationPipe`. This interface exists purely so that the code emitting `'application.status_changed'` (in `ApplicationsService`) and the code listening for it (in `NotificationsListener`) are both leaning on the *same* TypeScript type, so a mismatch between what one side sends and the other expects becomes a compile error instead of a silent runtime bug. (`job.published`'s payload didn't get its own named interface — it's simply the `JobModel` type Prisma already generates, since that event just carries the whole job.)

---

## 8. Reacting to Events — `src/module/notifications/notifications.listener.ts`

```ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JobModel } from '../../../generated/prisma/models.js';
import { NotificationType, Role } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { ApplicationStatusChangedEvent } from './events/application-status-changed.event.js';
import { SseService } from './sse.service.js';

@Injectable()
export class NotificationsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sseService: SseService,
  ) {}
```
A normal injectable service — nothing new about the constructor. It needs `PrismaService` (to persist notification rows) and `SseService` (to push live updates to connected clients).

### Handling `job.published`

```ts
  @OnEvent('job.published')
  async handleJobPublished(job: JobModel): Promise<void> {
```
`@OnEvent('job.published')` is the decorator that actually wires this method up as a listener. It means: "whenever anything in the app calls `eventEmitter.emit('job.published', <something>)`, run this method with that `<something>` as the argument." Nothing calls this method directly anywhere in the code — the connection between the emit and this handler exists entirely through the event name string matching.

```ts
    const candidates = await this.prisma.user.findMany({
      where: { role: Role.USER },
      select: { id: true },
    });

    if (candidates.length === 0) {
      return;
    }
```
Since the decision was "broadcast every new published job to every candidate," this looks up every user whose role is `USER` (candidates, as opposed to `RECRUITER`/`ADMIN`). If there are none, there's nothing further to do.

```ts
    await this.prisma.notification.createMany({
      data: candidates.map((candidate) => ({
        userId: candidate.id,
        type: NotificationType.JOB_PUBLISHED,
        title: 'New job posted',
        message: `A new job was posted: "${job.title}"`,
        metadata: { jobId: job.id },
      })),
    });
```
`createMany` inserts many rows in a single database round-trip — one `Notification` row per candidate, all built from the same `job` in one `.map()`. Note `metadata` here is deliberately lean — just `{ jobId: job.id }`, a pointer, not the whole job. This is the **persisted** copy, meant for someone who reconnects later and calls `GET /notifications`; a pointer is enough, since they can look the job up separately if they want details.

```ts
    for (const candidate of candidates) {
      this.sseService.sendToUser(candidate.id, {
        type: 'job_published',
        data: job,
      });
    }
  }
```
This is the **live** push, and it's deliberately richer than the persisted copy: `data: job` sends the *entire* job object — exactly the same shape `GET /jobs/:id` would return. The idea: a frontend client that's actively connected right now can take this payload and immediately render the new job in a list, with zero follow-up network request. A client that reconnects later only gets the lean pointer via the database and would need to fetch the job separately — a deliberate difference between "you were here live" and "you're catching up after the fact."

`type: 'job_published'` becomes the SSE **named event** on the wire — this is what lets a frontend do `eventSource.addEventListener('job_published', ...)` and separately `addEventListener('application_status_changed', ...)` on the exact same connection, distinguishing between the two without needing two different streams.

### Handling `application.status_changed`

```ts
  @OnEvent('application.status_changed')
  async handleApplicationStatusChanged(
    payload: ApplicationStatusChangedEvent,
  ): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: payload.candidateId,
        type: NotificationType.APPLICATION_STATUS_CHANGED,
        title: 'Application update',
        message: `Your application for "${payload.jobTitle}" is now ${payload.status}`,
        metadata: {
          applicationId: payload.applicationId,
          status: payload.status,
          meetingLink: payload.meetingLink ?? null,
        },
      },
    });
```
Same idea as above but simpler, because there's only ever exactly **one** recipient here (the specific candidate whose application changed) — so a single `create` instead of `createMany`. `metadata` includes `meetingLink` this time, since that's genuinely important extra context for this specific notification type (unlike the job case, there's no separate "go look it up yourself" expectation — the whole point of this notification is the meeting link).

```ts
    this.sseService.sendToUser(payload.candidateId, {
      type: 'application_status_changed',
      data: notification,
    });
  }
}
```
Pushes the just-created `Notification` row (the return value of `.create()`, which includes its generated `id`, `createdAt`, etc.) live to that one candidate, if they're currently connected.

---

## 9. The Polling Fallback — `src/module/notifications/notifications.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
```
Nothing new mechanically — a straightforward list scoped to the current user, newest first. This is what backs `GET /notifications`, and it's what a client relies on if it wasn't connected via SSE when something happened (or hasn't implemented SSE at all — this endpoint works regardless).

```ts
  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
```
An ownership check with a deliberate detail: if the notification doesn't exist *or* belongs to someone else, this throws the exact same `404` either way — never a `403`. This is the same anti-information-leak pattern used elsewhere in the project (e.g. login's identical error for "wrong password" vs "no such account") — it never confirms to a client "this notification exists, you just don't own it," which would let someone probe for the existence of other users' notification IDs.

---

## 10. Tying It Together — `src/module/notifications/notifications.controller.ts`

```ts
import {
  Controller, Get, MessageEvent, Param, Patch, Req, Sse, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { SseAuthGuard } from '../../common/guards/sse-auth.guard.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { NotificationsService } from './notifications.service.js';
import { SseService } from './sse.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly sseService: SseService,
  ) {}
```
The controller needs both services: `SseService` directly, for the stream endpoint itself, and `NotificationsService` for the two ordinary REST endpoints.

```ts
  @Sse('stream')
  @UseGuards(SseAuthGuard)
  stream(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    const subject = this.sseService.connect(user.sub);
    request.on('close', () => this.sseService.disconnect(user.sub, subject));
    return subject.asObservable();
  }
```
This is the actual `GET /notifications/stream` endpoint, and it behaves fundamentally differently from every other route in this project:

- `@Sse('stream')` tells Nest this route doesn't return a normal single response — it returns an `Observable`, and Nest should keep the connection open, writing a new SSE-formatted chunk to the response every time that `Observable` emits a value. The "response" isn't one payload anymore; it's an open-ended stream.
- `@UseGuards(SseAuthGuard)` — the query-param-based auth guard from section 5, not the normal header-based one.
- `this.sseService.connect(user.sub)` creates a fresh `Subject` for this specific connection and registers it.
- `request.on('close', () => this.sseService.disconnect(user.sub, subject))` — **this line matters a lot.** `request` here is the raw underlying Node HTTP request object, which emits a `'close'` event the moment the connection actually terminates, from either side (the client closes the tab, loses network, or the server itself shuts the connection down). Without this line, every disconnected client would leave its `Subject` sitting forever in `SseService`'s internal `Map` — nothing would ever remove it, since nothing else has any reason to. Over the life of a long-running server, that's a genuine, slowly-growing memory leak. This one line is what makes cleanup actually happen.
- `return subject.asObservable()` — rather than returning the `Subject` itself, `.asObservable()` returns a read-only view of it, exposing only the "listen" half of its interface (not `.next()`/`.error()`/`.complete()`). Whoever ends up holding this return value (here, Nest's own SSE machinery) has no way to accidentally push a value into someone else's connection. A defensive habit worth having even when, as here, the immediate consumer is trusted framework code.

```ts
  @Get()
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.findMine(user.sub);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  markAsRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.sub);
  }
}
```
Both of these are completely ordinary REST endpoints — same shape as everything built earlier in the project, normal `JwtAuthGuard`, normal single-response behavior. They exist as the "poll" side of this feature, always available regardless of whether a client ever uses SSE at all.

---

## 11. Registering the Module — `src/module/notifications/notifications.module.ts`

```ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';
import { SseService } from './sse.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, SseService, NotificationsListener],
})
export class NotificationsModule {}
```
All four pieces built above get registered together. Notice `NotificationsListener` is listed as a `provider` even though nothing in this module (or any other module) ever injects it into a constructor — it's never directly used anywhere. It still needs to be listed here, because that's what makes Nest actually **instantiate** it at startup — and instantiating it is what makes its `@OnEvent(...)`-decorated methods actually register themselves with the event emitter. A provider that's never constructed can't have its decorators take effect.

Also notice there's no `exports: [...]` here, unlike `ApplicationsModule` from the previous feature — nothing outside this module needs to directly inject `SseService` or `NotificationsService`. `JobsService` and `ApplicationsService` only ever need `EventEmitter2` (available globally, from section 6) to emit events; they never need to know `NotificationsModule` exists at all.

---

## 12. Where the Events Actually Get Fired

### `src/module/jobs/jobs.service.ts`

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
...
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
  ...
  async publish(id: string, requester: JwtPayload) {
    await this.findJobWithOwnerCheck(id, requester);

    const job = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.PUBLISHED },
    });

    this.eventEmitter.emit('job.published', job);

    return job;
  }
```
`EventEmitter2` gets injected exactly like any other dependency — no special syntax, because `EventEmitterModule.forRoot()` made it globally available. After the job's status is actually updated in the database, `this.eventEmitter.emit('job.published', job)` fires the event, passing the freshly-updated job row as the payload. This call is **fire-and-forget** — `emit()` doesn't wait for `NotificationsListener` to finish its work (or even care whether it succeeds or fails); `publish()` returns its response to the HTTP client immediately regardless.

### `src/module/applications/applications.service.ts`

```ts
    this.eventEmitter.emit('application.status_changed', {
      applicationId: updated.id,
      candidateId: application.candidateId,
      jobTitle: application.job.title,
      status: updated.status,
      meetingLink: updated.interviewMeetingLink,
    });

    return updated;
  }
```
Same idea, at the end of `updateStatus()`, right after the transaction (updating the application + writing its history row) commits. The payload object here is built to match the `ApplicationStatusChangedEvent` interface from section 7 exactly.

---

## 13. End-to-End Trace

### Scenario A: A recruiter publishes a job

1. A candidate's frontend opened `GET /notifications/stream?token=...` earlier. `SseAuthGuard` verified the token, `NotificationsController.stream()` ran, `SseService.connect()` created a `Subject` for that candidate and stored it in the `Map`. The HTTP connection is still open, doing nothing, just waiting.
2. A recruiter calls `POST /jobs/{id}/publish`.
3. `JobsController.publish()` → `JobsService.publish()` runs, updates the job's `status` to `PUBLISHED` in Postgres, then calls `eventEmitter.emit('job.published', job)`.
4. `JobsService.publish()` immediately returns its HTTP response to the recruiter — it does not wait for anything below.
5. Separately (but essentially instantly), `EventEmitter2` sees the emit and calls every method decorated `@OnEvent('job.published')` — here, `NotificationsListener.handleJobPublished(job)`.
6. That method looks up every `USER`-role candidate, bulk-inserts one `Notification` row per candidate (lean `metadata`), then loops over those same candidates calling `sseService.sendToUser(candidateId, { type: 'job_published', data: job })`.
7. For our specific candidate (the one connected since step 1), `sendToUser` finds their `Subject` in the `Map` and calls `.next(...)` on it.
8. Because the controller's `stream()` method returned that exact `Subject` (as an `Observable`) back in step 1, and that connection has been open and subscribed this whole time, Nest immediately writes a new `event: job_published\ndata: {...}\n\n` chunk to that still-open HTTP response.
9. The candidate's frontend, listening via `EventSource`, receives it the moment it's written — no polling involved.

### Scenario B: A recruiter moves an application to INTERVIEW

1. Same starting point — the candidate has an open SSE connection from earlier.
2. Recruiter calls `PATCH /applications/{id}/status` with `{ status: "INTERVIEW", meetingLink: "https://meet.google.com/..." }`.
3. `ApplicationsService.updateStatus()` checks the recruiter actually owns the job this application is for, then runs the `$transaction` (updates the application, writes an `ApplicationStatusHistory` row), then emits `'application.status_changed'` with the candidate's ID, job title, new status, and the meeting link.
4. `NotificationsListener.handleApplicationStatusChanged()` creates one `Notification` row (this time metadata *does* include the meeting link), then calls `sseService.sendToUser(candidateId, {...})` for that one specific candidate.
5. If that candidate is connected, they receive the `application_status_changed` event — including the Google Meet link — within moments of the recruiter's request completing.
6. If that candidate is *not* currently connected, none of the SSE-specific code has anyone to deliver to — `sendToUser` just finds nothing in the `Map` and does nothing further. The `Notification` row from step 4 still exists, though, so the next time they open the app and call `GET /notifications`, it's right there waiting.

---

## 14. Testing It Yourself

1. `npm run start:dev`.
2. Open the stream as a candidate (token via query param, since `EventSource`-style clients can't send headers):
   ```
   GET http://localhost:3000/notifications/stream?token=<candidate accessToken>
   Header: x-api-key: <your API_KEY>
   ```
   (Or via curl: `curl -N "http://localhost:3000/notifications/stream?token=...&..." -H "x-api-key: ..."`.) Leave it open.
3. In a second request, as the owning recruiter: `POST /jobs/{id}/publish`.
4. Watch the first (still-open) connection — a `job_published` event should arrive within moments.
5. `GET /notifications` (candidate, normal header auth) — confirm a persisted `JOB_PUBLISHED` row exists.
6. With the stream still open, have the candidate `POST /jobs/{id}/apply`, then have the recruiter `PATCH /applications/{id}/status` with `{ "status": "INTERVIEW", "meetingLink": "https://meet.google.com/abc-defg-hij" }`.
7. The open stream should immediately receive an `application_status_changed` event carrying the meeting link.
8. `PATCH /notifications/{id}/read` — confirm `readAt` gets set.
9. Close the streaming connection and confirm the server doesn't error out — that's the `request.on('close', ...)` cleanup doing its job.
