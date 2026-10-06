# Story 10.1a: Inbox & Notifications — Backend Keystone

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: 5ff63fe
epic: 10
story: 10.1a
fr: FR-56, FR-57, FR-58, FR-59 (backend slice; FE badge/screens -> 10-1b)
size: L
audience: backend
depends_on: [1.2f event bus (done), 1.2d email (done), 4.4a storage ceiling (done), 7.3a enrollment (done), Q&A 7.4a (done), 6.x grade release (done)]
split_from: 10-1
sibling: 10-1b-role-scoped-inbox-frontend (backlog), 10-1c-teacher-work-queue (backlog, party-mode add)
wf8_hard_gate: true   # ACs map to R1=9 (cross-tenant notif leak), R3=9 (worker/subscriber async SET LOCAL), R2=6 (RLS null-guard), R15=6 (owner-only billing role-scope). ATDD red-phase MANDATORY before in-progress (Task 0).
ducdo_rulings: "D1 SPLIT (this=10-1a backend) · D2 ALL 7 triggers incl. net-new storage-threshold · D3 storage row in-app + owner email EN now (VN via FU) · D4 notification_settings STAY disabled, in-app always-on"
---

## Story

As **the ClassLite platform** (serving teacher / admin / owner / student),
I want **a tenant-isolated `notifications` table, event-driven notification creation for the seven ruled domain triggers, and a role-safe `/api/inbox` read/count/read/archive API**,
so that **the frontend (10-1b) can render each role a scoped inbox and an unread badge over a correct, leak-proof backend contract.**

This is the **backend keystone** of Story 10.1. It builds the data + event + API substrate and owns the WF-8 ATDD gate. All UI — the three role-scoped inbox screens (s50/s51/s52), mobile (s75/s84), the badge wiring, polling, empty states — is **10-1b** and is out of scope here (see Out of Scope).

---

## Context & Reuse Map (READ FIRST)

The event bus, email, storage, and all recipient-resolution queries already exist. 10-1a is the **first consumer** of the event bus (it has had zero subscribers until now). Do NOT rebuild substrate.

### Already shipped — REUSE, do not rebuild

| Capability | Where it lives | Note |
|---|---|---|
| **Event bus** (in-process, synchronous) | `internal/event/bus.go` — `NewBus()`, `Subscribe(type, Handler)`, `Publish(ctx, Event)`; `Event{Type,CenterID,UserID,Payload,Timestamp}`; single instance at `cmd/api/main.go:140` | **Publish is synchronous, fire-and-forget; handler errors are logged and SWALLOWED (never propagate to the producer).** Payload is deliberately NOT logged (EDGE-4). **Zero subscribers exist today** — 10-1a registers the first ones on the `main.go:140` instance. |
| Event constants | `internal/event/types.go` — `GradeReleased`, `AssignmentCreated`, `EnrollmentChanged`, `QuestionAsked`, `ScheduleChanged`, `PaymentFailed` | 4 of these are actively published (grade_release.go:105, assignment_service.go:229, enrollment_service.go:702, question_service.go:571). `ScheduleChanged` is a **constant with NO emitter**; `PaymentFailed` is a **constant never published** (real path is off-bus — see "Net-new" DD4b). |
| Event payloads | `EnrollmentChangedPayload` (`enrollment_service.go:688` — `{EnrollmentID,StudentID,Action,FromClassID,ToClassID}`); `QuestionAskedPayload` (`question_service.go:161`). Grade/Assignment carry ids inline. | PII-free by design; carry ids only. Recipient lookup happens in the subscriber. |
| Tenant tx / RLS GUC | `internal/store/db.go` — `store.SetTenantContext(ctx, tx, tc)` (validates UUID → `SET LOCAL app.current_tenant_id`) | **MUST run inside a tx before any RLS query (PERF-1). Each event subscriber opens its OWN tenant tx (SEC-6/R3) from `event.CenterID` — never reuse the producer's tx.** |
| Recipient-resolution queries (all exist) | `GetSubmissionByID` (submissions.sql:17 → student_id), `GetClassByID` (classes.sql:17 → teacher_id), `ListEnrolledStudentsByClass` (enrollments.sql:30), `GetCenterOwnerUserID` (polar.sql:89), `GetCenterMemberByUserAndCenter` / `ListCenterMembersByCenter` (center_members.sql) | No new recipient queries needed except possibly admin+owner-of-center list (derive from `ListCenterMembersByCenter` filtered to owner/admin). |
| Storage usage + limit | `internal/service/file_service.go:325-333` — `SumFileSizeByCenter`, `GetCenterStorageLimit`; hard ceiling reject `StorageFullError` at :338 | The 95% crossing check inserts right here (DD4). `used`/`limit` are already in scope at :333. |
| Resend email + templates | `internal/service/email_resend.go` (`ResendEmailSender.Send`); `internal/service/email.go` (`EmailSender` iface); `internal/service/email_templates.go` (`Render*() (subject, html)`, SEC-11 hardened, hard-coded subjects) | **Emails are English-only** — `users.language_pref` is ignored (known bug `FU-9-4-EMAIL-LOCALE`). D3: storage email ships **EN now**, VN via that FU. Add `RenderStorageThresholdEmail`. |
| `notification_settings` jsonb (users) | migration `20261006130000`; struct `internal/service/user_service.go:52` (`emailOn{Submission,Question,Announcement}` + `schemaVersion`); `DecodeNotificationSettings` | **D4: these are EMAIL-channel gates, NOT in-app gates. 10-1a does NOT read them — the in-app inbox is always-on.** Their consumer is a future email-notifications story. |
| Paginated list + count idiom | `internal/store/queries/questions.sql` (`ListQuestionsForReader`/`CountQuestionsForReader`, identical WHERE); `internal/service/student_service.go` (`DefaultPageSize=20`, `MaxPageSize=100`, `clampPagination`, `PageResult`) | Copy verbatim. `OFFSET (page-1)*pageSize LIMIT pageSize` (XL-2). Tie-break `ORDER BY created_at DESC, id DESC`. |
| Service / handler / routing / envelope | service template `internal/service/question_service.go` (tx-opener + SEC-1 role re-read); handler `internal/handler/question_handler.go`; envelope `internal/handler/response.go` (`WriteEnvelope`, `WriteError`), `writePaginatedEnvelope` + `parseSnakePageParams` (`enrollment_handler.go`); error map `internal/middleware/error_mapper.go`; routes + `questionChain` (`cmd/api/main.go:777`) | `questionChain = extractTenant(requireVerified(requireCenter(ErrorMapper(h))))` — the exact chain for an authenticated tenant resource, role enforced in-service. |
| Test harness | `internal/test/helpers.go` (`SetupDB`, `TenantContext`, `SetupRawPool`), `fixtures.go` (`CreateUser/CreateCenter/CreateCenterWithID/CreateCenterMember`), per-story `story_<N>_helpers.go` server+JWT builders; RLS template `internal/test/_TEMPLATE_rls_test.go` (6 mandatory patterns) | Services are DB-backed in tests (store never mocked — `AuthDB`/`*test.TxDB` seam). `nil` event bus tolerated for non-notification tests. |

### Net-new — THIS story builds

- **Migration** `20261006140000_create_notifications` (next free slug): the `notifications` table + `notification_type` enum + RLS 4-policy grid + unread index. (DD1)
- **sqlc** `internal/store/queries/notifications.sql`: `InsertNotification`, `ListInboxForUser` (paginated, active-queue), `CountUnreadForUser`, `MarkNotificationRead`, `ArchiveNotification`, `MarkAllReadForUser`. (DD5)
- **`NotificationService`** (`internal/service/notification_service.go`): the write side. Registers one bus `Handler` per event type; each handler opens its own tenant tx (SEC-6), resolves recipient(s), inserts row(s). Plus the read side: `ListInbox`, `CountUnread`, `MarkRead`, `Archive`, `MarkAllRead`. (DD2/DD3)
- **`InboxHandler`** (`internal/handler/inbox_handler.go`) + routes: `GET /api/inbox`, `GET /api/inbox/count`, `POST /api/inbox/{id}/read`, `POST /api/inbox/{id}/archive`. (DD5)
- **`event.StorageThresholdCrossed`** constant + a publish from `file_service.go` at the 95%-crossing point (DD4) + subscriber → owner row + `RenderStorageThresholdEmail` (EN).
- **`event.ScheduleChanged` emitter**: wire the event bus into the session service and publish on schedule-affecting session mutations (DD4b).
- **`event.PaymentFailed` bridge**: publish `event.PaymentFailed` from the Polar past-due path (`billing_polar.go:202`) so the owner billing notification is created on-bus (DD4b).
- **api.yaml**: the 4 inbox paths + `Notification`, `EnvelopeNotificationList`, `EnvelopeUnreadCount` schemas (reuse `PaginationMeta`/`EnvelopeMetaPagination`). Run `scripts/codegen.sh` (sqlc + openapi-typescript) — WF-1/WF-3.

### Design decisions pinned (engineering calls — override at dev pickup only with written reason)

- **DD1 — Table shape & the i18n model.** `notifications(id uuid pk, center_id uuid NOT NULL → centers ON DELETE CASCADE, user_id uuid NOT NULL → users ON DELETE CASCADE, type notification_type NOT NULL, title text NOT NULL, body text NOT NULL, link text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', read_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`. **No `deleted_at`** — "archive" is `archived_at` (SEC-9's soft-delete filter here = `archived_at IS NULL` on the active-queue read). Index `idx_notifications_user_active ON notifications (center_id, user_id, read_at, created_at DESC)` (RLS-prefixed per PERF-2; serves both the unread count and the active list). **Active-queue predicate is `archived_at IS NULL` in v1**; a future Snooze FU extends it to `archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= now())` — this index may need revisiting then (do NOT pre-add a `snoozed_until` column now; a nullable `ADD COLUMN` later is a cheap non-blocking migration — Sally). **i18n:** display text is rendered **on the FE** via i18n keyed on `type` + `metadata` (architecture.md:257). The `title`/`body` columns hold a **server-rendered English snapshot** generated from the **EN locale of the same i18n catalog the FE consumes** (so the two render paths cannot structurally diverge — Winston) — load-bearing only for the email channel + a degraded fallback, never the primary UI source.
- **DD1b — Typed metadata contract (per-type) — THE un-fixable-later gap (Sally).** The subscriber runs at WRITE time with all join data in hand — the **only** cheap moment to denormalize a human-readable row. If metadata is thin, 10-1b eats a browser N+1 (the read API returns NO joined names) or silently falls back to the EN snapshot (violating the i18n model). Therefore `metadata` is a **typed struct per `notification_type`** (Go struct + `schemaVersion` per GO-7; a typed/discriminated shape in the `Notification` api.yaml schema, NOT free `object`). It is an **immutable event snapshot** — a later rename of the resource does NOT update the row (correct for a historical inbox; documented so a reviewer doesn't flag staleness). Every type carries `actorName`/`actorId` (the "from" column) + the authoritative **resource ids** (`assignmentId`/`questionId`/`submissionId`/`sessionId`/`enrollmentId`) so the FE has structured access without string-parsing `link`. Per-type required fields:
  | type | metadata (beyond actor + ids) |
  |---|---|
  | `grade_released` | `assignmentTitle`, `bandPreview`, `className` |
  | `assignment_created` | `assignmentTitle`, `className`, `dueAt` |
  | `question_asked` | `studentName`, `className`, `questionPreview` (truncated) |
  | `schedule_changed` | `className`, `oldTime`/`newTime`, `changeKind` (reschedule/cancel) |
  | `enrollment_changed` | `studentName`, `action`, `fromClassName`/`toClassName` |
  | `payment_failed` | `amount`, `currency`, `graceEndsAt` |
  | `storage_threshold` | `usedBytes`, `limitBytes` |
  **`link` rule:** `link` is the stored relative **default-navigation path** (e.g. `/grading/{assignmentId}`); the resource ids in metadata are **authoritative** for any secondary action (Reply composer, Add-to-calendar .ics from `dueAt`/`newTime`). One `link` string serves v1 nav; a structured `links[]` array is over-engineering for v1 (Sally/Winston agree) — but only because the ids live in metadata.
- **DD2 — Synchronous-bus semantics (errors AND latency).** Handlers run in the **producer's goroutine** after `Publish` (post-commit at every site — DD4b). Each handler opens its own tx, `store.SetTenantContext(tx, {CenterID: ev.CenterID})`, resolves recipients, inserts, commits. Handler **errors** are swallowed by the bus (`bus.go:62-68`) → notification creation is **best-effort**: a failed insert never blocks grading/enrolling. BUT the bus is synchronous, so handler **latency** DOES add to the producer request regardless of error-swallowing (Winston). For the request paths (assignment-create, schedule-change, upload-confirm) a single batched round-trip is a few ms → leave synchronous for MVP. **The one carve-out: the Polar webhook** (`ProcessPolarEvent` replies to Polar under a timeout-with-retries) — a slow/contended notification insert there risks a timeout→retry storm against a path doing real billing writes. For that ONE site, dispatch `Publish` in a goroutine with a fresh (non-request) `context.WithoutCancel`-style context. Durable/retry path is `FU-10-1-DURABLE` (do NOT move subscribers onto the jobs queue in 10-1a).
- **DD3 — Recipient resolution & fan-out** (the role-scope is enforced HERE at WRITE time, not at read — R15):
  - `grade.released` {submissionId,assignmentId} → `GetSubmissionByID` → **the student** (1 row, type `grade_released`).
  - `assignment.created` {assignmentId} → class → `ListEnrolledStudentsByClass` → **each ACTIVE enrolled student** (N rows, type `assignment_created`). Verify the query filters to active enrollments only — a row for a withdrawn/transferred student (7.3a lifecycle) is a wrong-audience bug (Murat AC10).
  - `question.asked` (QuestionAskedPayload) → class → `GetClassByID`.teacher_id → **the teacher** (1 row, type `question_asked`).
  - `schedule.changed` {sessionId,classId} → `ListEnrolledStudentsByClass` → **each ACTIVE enrolled student** (N rows, type `schedule_changed`; active-only, same guard as above). Fan-out uses ONE `INSERT … SELECT` off the enrollment rows (server-side join) **unconditionally** — never a Go-materialized multi-row insert (65535-param cliff) and never per-student N+1 (Winston/PERF-2).
  - `enrollment.changed` (EnrollmentChangedPayload) → **admin + owner** of the center (type `enrollment_changed`).
  - `payment.failed` → `GetCenterOwnerUserID` → **owner only** (type `payment_failed`). **Admin must NEVER receive this** (R15 red test).
  - `storage.threshold.crossed` → `GetCenterOwnerUserID` → **owner only** (type `storage_threshold`), NOT the uploader.
- **DD4 — Storage-threshold 95% crossing** (D2). The ceiling check already runs INSIDE `mutateInTenantTx` under a `pg_advisory_xact_lock(center)` held to commit (`file_service.go:248-252`), with `used` the pre-insert total. **Capture `crossed bool` INSIDE the locked closure** — `threshold = limit*StorageNotifyThresholdPercent/100` (named const = 95, integer math); `crossed = used < threshold && used+meta.Size >= threshold`. **Publish `event.StorageThresholdCrossed{CenterID}` AFTER the closure returns nil (post-commit), NOT at `:332` — `:332` is pre-commit and would roll back on a later insert/audit failure** (Winston). Because the predicate is evaluated under the serialized advisory lock, the concurrent-double-fire window **largely evaporates** (upload2 can't read `used` until upload1 commits + releases the lock, by which point `used >= threshold`) — the residual true-concurrency case stays `FU-10-1-STORAGE-RACE` with a documented `t.Skip`. The crossing predicate IS the dedup: exactly one row per crossing; **delete-then-re-cross correctly re-fires** (a new crossing is a new signal — decided on purpose, tested in 0.4). The subscriber inserts the owner `storage_threshold` row (link `/settings/storage`, metadata `{usedBytes: used+meta.Size, limitBytes}` — compute, do NOT re-read post-commit) **and** sends the owner the EN `RenderStorageThresholdEmail` with the "Upgrade to Studio" CTA.
- **DD4b — The two missing emitters (bus injection + exact post-commit seams — Winston).** Three services currently have NO `*event.Bus` field (`FileService{db,storage,audit,clk}`, `SessionService{db,audit,clk}`, `BillingService{...}`). Each needs a bus field + constructor param + `main.go` wiring — unstated net-new work, make it explicit in the tasks.
  - **`ScheduleChanged`:** session service is not on the bus. Publish `event.ScheduleChanged{sessionId,classId}` on schedule-affecting mutations. **There is NO post-commit region today** in `UpdateSessions`/`CancelSessions`/`DeleteSessions` — all wrap everything in `mutateInTenantTx`. The publish is net-new code AFTER each closure returns, guarded `err == nil`, at **three** sites (not one).
  - **`PaymentFailed`:** keep the off-bus grace clock untouched. The Polar handler's commit is at `billing_polar.go:222`; **`:202` is the `enterGraceTx` dispatch INSIDE the webhook tx** — publishing there is pre-commit. Publish in the existing post-commit, off-tx region (~`:226-236`, beside the best-effort `CancelDowngrade`), and per DD2 dispatch THIS publish async (webhook-timeout carve-out).
- **DD5 — Read model & role-safety.** `GET /api/inbox` returns **only the caller's own rows** (`center_id` via RLS + `user_id = caller` predicate), `archived_at IS NULL`, optional `type` filter + `unread_only` bool, paginated (page/pageSize). `GET /api/inbox/count` = `COUNT(*) WHERE user_id=caller AND read_at IS NULL AND archived_at IS NULL`. `read`/`archive` set the timestamp for a row **owned by the caller** (cross-user → `NotFoundError` 404 non-disclosure, never 403). Role is NOT a read-time filter — role-scoping is already baked at write (DD3), so owner-only billing holds because admin never has such a row. The read endpoints use the **open `questionChain`** (no `RequireRole`) since every role has an inbox.

---

## Acceptance Criteria (BDD)

**AC1 — notifications table + RLS**
**Given** the migration `20261006140000_create_notifications` is applied,
**When** the schema is inspected,
**Then** `notifications` exists with the DD1 columns, the `notification_type` enum (`grade_released, assignment_created, enrollment_changed, question_asked, schedule_changed, payment_failed, storage_threshold`), the `idx_notifications_user_active` index, and RLS is `ENABLE`+`FORCE` with the 4-policy center_id grid (`NULLIF(current_setting('app.current_tenant_id', true),'')::uuid`),
**And** `down.sql` drops the table and the enum.

**AC2 — RLS isolation (R1/R2 — adversarial, 6 patterns)**
**Given** tenants A and B with notification rows,
**When** the `_TEMPLATE_rls_test.go` 6-pattern grid runs against `notifications` (CrossTenantRead, CrossTenantInsert WITH CHECK reject, CrossTenantWrite UPDATE 0-row, CrossTenantDelete 0-row, NullTenant zero-rows, UnsetTenant zero-rows),
**Then** every cross-tenant and null/unset-tenant attempt returns zero rows / is rejected — no leak.

**AC3 — GET /api/inbox (role-scoped, paginated, active-queue only)**
**Given** a caller with notification rows (some read, some archived),
**When** `GET /api/inbox?page=1&page_size=20` is called (optional `type`, `unread_only`),
**Then** the response is `{data:[…], meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}`, each item has `{id,type,title,body,link,metadata,readAt,archivedAt,createdAt}` where `metadata` is the **typed per-`type` struct of DD1b** (actor + resource ids + per-type fields — enough to render a human row with NO per-row re-fetch) and is a typed shape in the api.yaml `Notification` schema (GO-5: nullable fields serialize as explicit `null`), rows are the **caller's own only**, `archived_at IS NULL`, ordered `created_at DESC, id DESC`,
**And** a caller with no rows gets `data:[]` + `total:0` (not an error).

**AC4 — GET /api/inbox/count (lightweight unread)**
**Given** a caller with K unread, non-archived rows,
**When** `GET /api/inbox/count` is called,
**Then** it returns `{data:{unread:K}}` and runs a single indexed `COUNT` (no row payload) — this is the badge-polling endpoint (interval owned by 10-1b).

**AC5 — mark read / archive (caller-scoped, non-disclosure)**
**Given** a notification row owned by the caller,
**When** `POST /api/inbox/{id}/read` then `POST /api/inbox/{id}/archive` are called,
**Then** `read_at` / `archived_at` are set, the archived row leaves the active queue and the unread count,
**And** both are **idempotent** — a second `POST …/read` on an already-read row returns **200 (no-op)**, NOT 404: the mark-read SQL is `UPDATE … WHERE id=$ AND user_id=$ RETURNING` (ownership-gated) and MUST NOT be gated on `read_at IS NULL` (that returns 0 rows on the 2nd call → wrongly 404s — the idempotency-vs-404 trap, Murat),
**And given** an `{id}` owned by a different user (same or other tenant), **then** BOTH `…/read` AND `…/archive` return `404 NOT_FOUND` (non-disclosure — never 403, never a cross-user mutation; 0-row `RETURNING` → `NotFoundError`, asserted for each endpoint separately).

**AC6 — event-driven creation, all 7 triggers (R3 — subscriber tenant context)**
**Given** the `NotificationService` subscribers are registered on the `main.go:140` bus,
**When** each of the seven events is published — `grade.released`, `assignment.created`, `question.asked`, `schedule.changed`, `enrollment.changed`, `payment.failed`, `storage.threshold.crossed`,
**Then** the handler opens its OWN tenant tx (`SET LOCAL` from `event.CenterID` — SEC-6), resolves recipients per DD3, and inserts the correct typed row(s) under the correct tenant,
**And** a handler publishing failure is swallowed (producer action unaffected — DD2),
**And** the subscriber writes rows for tenant A's event ONLY under tenant A (a worker-context cross-tenant write test — R3 J15-NULL pattern).

**AC7 — owner-only billing (R15 — role-scope at write)**
**Given** a `payment.failed` event for a center with an owner AND an admin,
**When** the subscriber runs,
**Then** exactly ONE `payment_failed` row is created for the **owner's** `user_id`, and the **admin has zero** `payment_failed` rows (asserted via the admin's `GET /api/inbox`),
**And** `enrollment.changed` creates rows for admin AND owner (operational signal is shared; billing is not).

**AC8 — storage-threshold crossing = exactly one owner notification + email (D2/D3)**
**Given** a center seeded to 94% of its storage limit,
**When** one upload is confirmed that pushes cumulative usage past 95%,
**Then** exactly ONE `storage_threshold` notification row is created for the **owner** (NOT the uploader if different), with `link=/settings/storage` and metadata `{usedBytes,limitBytes}`,
**And** the owner is sent exactly one EN `RenderStorageThresholdEmail` (via the `EmailSender` seam — assert the mock captured one send with the Upgrade CTA; VN localization deferred to `FU-9-4-EMAIL-LOCALE`),
**And** a second upload while already ≥95% creates **no** additional row (crossing predicate dedup — DD4).

**AC9 — envelope + error shapes + codegen**
**Given** the api.yaml paths + schemas are added and `scripts/codegen.sh` is run,
**When** the handlers are exercised through the real middleware chain,
**Then** success paths emit the `{data,meta}` envelope and error paths emit `{error:{code,message,requestId}}` with the correct status (404 `NOT_FOUND`, 422 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`), `src/lib/api/client.ts` regenerates with the `Notification` types, and no generated file is hand-edited (XL-1).

**AC10 — fan-out cardinality (Murat — new; the write-time cardinality invariant)**
**Given** a class with exactly 3 ACTIVE enrollments and 1 withdrawn/transferred enrollment,
**When** `assignment.created` (and separately `schedule.changed`) is published for that class,
**Then** **exactly 3** notification rows are created — one per active student, **none for the withdrawn student**, no duplicates,
**And** a class with 0 active enrollments produces 0 rows and no error (the `INSERT … SELECT` fan-out must not mis-join or double-count).

---

## Tasks / Subtasks

**Task 0 — WF-8 ATDD red-phase (MANDATORY before in-progress; `//go:build atdd_red_phase`)**
- [x] 0.1 `notifications_rls_atdd_test.go` from `_TEMPLATE_rls_test.go` — the 6-pattern grid (AC2 / R1 / R2).
- [x] 0.2 **Subscriber tenant-context red — MUST use `SetupRawPool`, not `SetupDB`** (Winston/Murat). Under `SetupDB`/`TxDB` the subscriber's own-tx is a SAVEPOINT on the shared connection and its `SET LOCAL` reverts on release (`audit.go:28-30`) — so a `SetupDB` test can **green without exercising production's connection-per-subscriber semantics** (false green). On the raw pool: publish a tenant-A event, assert the row lands under A; open an **independent** tenant-B tx and assert it sees zero; and publish an event with **empty/invalid `CenterID`** → assert `SetTenantContext` rejects it (no blank-GUC fall-through). (AC6 / R3).
- [x] 0.3 Owner-only billing red: `payment.failed` → owner has 1, admin has 0 `payment_failed` rows (AC7 / R15).
- [x] 0.4 Storage crossing red: seed 94% → cross 95% → exactly ONE owner row (published **post-commit**) + one email; second upload while ≥95% → no new row; **delete-then-re-cross → one NEW row** (decided-on-purpose); + a `t.Skip("FU-10-1-STORAGE-RACE")` stub so the concurrent-race gap is greppable (AC8).
- [x] 0.5 Inbox read red: caller sees only own active rows; `read` AND `archive` of another user's id → **both** 404; **mark-read idempotency** — 2nd `…/read` on an already-read row → 200 no-op (SQL ownership-gated, NOT `read_at IS NULL`-gated) (AC3/AC5).
- [x] 0.6 **Idempotency characterization (NOT red — pins accepted v1 dup):** double-publish `grade.released` → assert **2** rows (documents the known dup; flips to 1 when `FU-10-1-DURABLE` adds an idempotency key — the R11 lesson, don't ship a deferred idempotency gap with zero coverage) (Murat).
- [x] 0.7 **Best-effort swallow red:** register a failing/panicking handler, publish → assert `Publish` returns nil + the producer's own row still commits + **zero** notification rows (pins DD2's load-bearing "errors don't block, notification silently dropped"; AC6) (Murat).
- [x] 0.8 **Fan-out cardinality red:** 3 active + 1 withdrawn enrollment → `assignment.created` (and `schedule.changed`) → exactly 3 rows, withdrawn excluded, no dupes; empty class → 0 (AC10) (Murat).
- [x] Hand off `/bmad-tea AT 10-1a` may author these; de-tag on green.

**Task 1 — Migration + sqlc** (AC1)
- [x] 1.1 Write `migrations/20261006140000_create_notifications.{up,down}.sql` (DD1 table + enum + RLS grid + index). Run `scripts/migrate.sh` up→down→up clean.
- [x] 1.2 `internal/store/queries/notifications.sql`: `InsertNotification`, `ListInboxForUser`, `CountUnreadForUser`, `MarkNotificationRead`, `ArchiveNotification`, `MarkAllReadForUser` (identical WHERE on List/Count; `read`/`archive` as `UPDATE … WHERE id=$ AND user_id=$ RETURNING` for 0-row→404). Run `sqlc generate`.

**Task 2 — NotificationService: write side (subscribers)** (AC6/AC7, R3)
- [x] 2.1 `internal/service/notification_service.go` — `NotificationService{db AuthDB; clk clock.Clock; email EmailSender}` + `Register(bus *event.Bus)`.
- [x] 2.2 One handler per event type; each opens its own tenant tx (SEC-6), resolves recipients (DD3), inserts typed row(s) with the **typed per-type metadata struct (DD1b)** + EN `title`/`body` snapshot (from the EN i18n catalog) + relative `link`. Fan-out types use one `INSERT … SELECT` (DD3).
- [x] 2.3 Wire `Register(eventBus)` in `cmd/api/main.go` after `eventBus := event.NewBus()` (line 140).

**Task 3 — Storage-threshold trigger** (AC8, D2/D3)
- [x] 3.1 Add `event.StorageThresholdCrossed` constant + payload `{CenterID}`. **Inject `*event.Bus` into `FileService`** (new field + constructor param + `main.go` wiring — it has none today).
- [x] 3.2 In `ConfirmUpload`, capture `crossed bool` INSIDE the locked `mutateInTenantTx` closure (`threshold = limit*StorageNotifyThresholdPercent/100`; `crossed = used < threshold && used+meta.Size >= threshold`); **publish AFTER the closure returns nil (post-commit), never at `:332`** (DD4).
- [x] 3.3 Subscriber → owner `storage_threshold` row (metadata `{usedBytes: used+size, limitBytes}`) + `RenderStorageThresholdEmail` (EN) via `EmailSender`. Add the template to `email_templates.go` (SEC-11: hard-coded subject).

**Task 4 — Missing emitters** (AC6, DD4b)
- [x] 4.1 Inject `*event.Bus` into `SessionService` (new field + ctor + `main.go`). Publish `event.ScheduleChanged{sessionId,classId}` AFTER each `mutateInTenantTx` closure returns nil, guarded `err == nil`, at **three** sites — `UpdateSessions`/`CancelSessions`/`DeleteSessions` (no post-commit region exists today — net-new). Guard nil bus.
- [x] 4.2 Inject `*event.Bus` into `BillingService`. Publish `event.PaymentFailed{CenterID}` in the Polar handler's **post-commit off-tx region (~`billing_polar.go:226-236`, beside `CancelDowngrade`), NOT at `:202`** (which is inside the webhook tx). Dispatch THIS publish **async** (goroutine + fresh context) per the DD2 webhook-timeout carve-out. Grace clock untouched.

**Task 5 — Inbox read API** (AC3/AC4/AC5/AC9)
- [x] 5.1 Read-side service methods: `ListInbox(ctx,tc,filters,page,pageSize) ([]Notification, PageResult, error)`, `CountUnread`, `MarkRead`, `Archive`, `MarkAllRead` — all caller-scoped, 0-row→`NotFoundError`.
- [x] 5.2 `internal/handler/inbox_handler.go` — `GET /api/inbox` (`parseSnakePageParams`, optional `type`/`unread_only`, `writePaginatedEnvelope`), `GET /api/inbox/count` (`WriteEnvelope` `{unread}`), `POST /api/inbox/{id}/read`, `POST /api/inbox/{id}/archive`.
- [x] 5.3 Register routes on `questionChain` (open chain — all roles) in `cmd/api/main.go`.

**Task 6 — api.yaml + codegen** (AC9, WF-1/WF-3)
- [x] 6.1 Add the 4 paths + `Notification`, `EnvelopeNotificationList`, `EnvelopeUnreadCount` schemas (reuse `PaginationMeta`/`EnvelopeMetaPagination`/`ErrorEnvelope`).
- [x] 6.2 Run `scripts/codegen.sh` (sqlc + openapi-typescript). Verify `client.ts` gains `Notification` + the inbox paths; no hand-edits (XL-1).

**Task 7 — Verify** (DoD)
- [x] `gofmt`/`go vet`/`go build`; `go test -p 1 ./...` (16+ pkgs) green with red-phase de-tagged; `migrate.sh` up→down→up clean; `codegen.sh` clean (no sqlc drift); `tsc -b` in classlite-web green against regenerated `client.ts`.

---

## Dev Notes

- **The 7 ruled triggers = the entire `notification_type` enum.** Several items the epic lists under the role inboxes have **no source event among the 7** and are therefore explicitly DEFERRED (not silently implied):
  - Teacher **ungraded / late submissions** work-queue → no `submission.submitted` event exists → stays OUT of 10-1a (it's a derived *state*, not an event — a notification-row-per-submission would race grade-release on reconcile). **BUT promoted from a floating FU to story `10-1c-teacher-work-queue`, release-committed alongside 10-1b** (John/Sally: a teacher inbox of only `question_asked` is a hollow shell; the grading queue IS the teacher's reason to open the inbox). 10-1c = a derived `GET /api/inbox/teacher-queue` over `submissions`+`assignments` (RLS, role-read, same pagination substrate) — NOT new notification rows. Without it, the epic deliverable is "Notifications backend + student/owner inbox," not a teacher inbox.
  - Teacher / student **@mentions** → no mention feature or emitter exists → `FU-10-1-MENTIONS`.
  - Student **teacher replies to questions** → no `question.answered` event → `FU-10-1-QA-REPLY`.
  - Admin/owner **new staff joined** / **integration health alerts** → no emitter → `FU-10-1-STAFF-HEALTH`.
  10-1b's role screens render whatever the enum provides; empty categories show the empty-state copy (10-3).
- **Role-scope is a WRITE-time invariant (DD3), not a read filter.** This is the crux of R15 — the read API is "give me my rows"; correctness depends entirely on the subscriber addressing the right `user_id`. The AC7 red test is the guard.
- **SEC-1 at write:** subscribers resolve recipient role from the DB (center_members), never from a JWT (there is no request JWT in a bus handler anyway). The read endpoints still run `extractTenant`→DB-role per the standard chain.
- **PERF-2:** `assignment.created` / `schedule.changed` fan out to N enrolled students via a single `ListEnrolledStudentsByClass` + a batched insert — never a per-student N+1 of lookups. Prefer one multi-row `INSERT … SELECT` if the enrolled set is large.
- **GO-5:** `readAt`/`archivedAt` are nullable pointers with NO `omitempty` — explicit `null` on the wire.
- **BC-2/clock:** inject `clock.Clock`; the AC8 storage test + read/archive timestamps must be deterministic under `MockClock`.
- **Aggregation** ("5 essays graded", architecture.md:247) is NOT built — individual rows in v1 → `FU-10-1-AGGREGATION`.
- **Enum reversibility (Winston):** `down.sql` drops the enum (AC1). Deferred triggers that revive later will need `ALTER TYPE notification_type ADD VALUE` — which can't run inside a transaction on older PG and whose values can't be removed. One-line heads-up so a future migration doesn't wedge.
- **Do NOT** read `notification_settings` (D4), move subscribers onto the jobs queue (DD2), add a `deleted_at` (archive = `archived_at`), pre-add a `snoozed_until` column (DD1 — defer to the Snooze FU), or build any FE.

### Risk / WF-8

| Risk | Score | Covered by |
|---|---|---|
| R1 — missing TenantContext → cross-tenant notif leak | 9 | AC2 + every store call threads `tc`; Task 0.1 |
| R3 — subscriber/worker forgets SET LOCAL → async leak | 9 | DD2 own-tx rule; AC6; Task 0.2 |
| R2 — RLS null-guard regression | 6 | AC2 NullTenant/UnsetTenant patterns |
| R15 — role-scope leak (owner-only billing) | 6 | DD3 write-time scoping; AC7; Task 0.3 |
| R33 — polling thundering herd | 4–5 (monitor) | `/count` is a single indexed COUNT; interval config in 10-1b. No gate. |

---

## Definition of Done

- All 9 ACs met; Task 0 red tests de-tagged and green.
- `go test -p 1 ./...` green; migration reversible; `codegen.sh` clean; `tsc -b` green on the regenerated client.
- RLS 6-pattern grid on `notifications` passes; R3 subscriber-tenant + R15 owner-only-billing + AC8 exactly-one-owner tests pass.
- No `notification_settings` read; no FE; no generated-file hand-edits; file ≤600 lines (conventions).
- Completion notes created per `docs/bmad-story-conventions.md` (sibling `-completion-notes.md`) at dev pickup.

---

## Out of Scope (→ 10-1b or follow-ups)

- **ALL frontend** — `features/inbox/`, `InboxRoute` + s50/s51/s52 role components, mobile s75/s84, row-swipe gestures, the `/inbox` route, badge-count wiring into the pre-built `SidebarNavItem.badgeCount` / `MobileTab.unread` slots, polling interval, empty states (10-3), `NotificationsSection` toggle re-enable (stays disabled — D4). → **10-1b**.
- UX-spec enrichments beyond the epic AC — Snooze, inline reply composer, ✦AI-suggest-reply, mark-all-read UI, notification "rules". → 10-1b scoping / FUs.
- Teacher grading work-queue (ungraded/late) → **story `10-1c-teacher-work-queue`** (release-committed with 10-1b, NOT a floating FU) — a derived read, not notification rows.
- Deferred triggers with no source event: `FU-10-1-MENTIONS`, `FU-10-1-QA-REPLY`, `FU-10-1-STAFF-HEALTH`.
- `FU-10-1-AGGREGATION` (batchy arrivals), `FU-10-1-DURABLE` (retry/durable subscriber path), `FU-10-1-STORAGE-RACE` (concurrent-crossing double-fire), `FU-9-4-EMAIL-LOCALE` (VN email localization — storage email ships EN).

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-06 | Created via `/bmad-create-story 10-1` (Amelia). 4-agent parallel recon. Ducdo rulings D1 SPLIT (this=10-1a backend keystone) · D2 all-7-triggers incl. net-new storage-threshold · D3 storage row + owner email EN now (VN→FU) · D4 notification_settings stay disabled / in-app always-on. Epic→in-progress; split into 10-1a + 10-1b. backlog → ready-for-dev. WF-8 HARD gate (R1/R3=9, R2/R15=6) → Task 0 red-phase first. |
| 2026-10-06 | **Implemented (`/bmad-dev-story 10-1a`, Amelia).** All 8 Task-0 reds de-tagged + GREEN; Tasks 1–7 complete. Net-new: migration `20261006140000` (notifications table + `notification_type` enum + 4-policy FORCE-RLS grid + `idx_notifications_user_active`), `notifications.sql` sqlc queries, `NotificationService` (7 write subscribers each own-tenant-tx + ListInbox/CountUnread/MarkRead/Archive/MarkAllRead read side), `InboxHandler` + 4 routes on the open `questionChain`, `event.StorageThresholdCrossed` + `RenderStorageThresholdEmail`. Emitters: `FileService` post-commit 95%-crossing publish; `SessionService` ScheduleChanged (3 sites); `BillingService` PaymentFailed bridge (async, webhook carve-out) — all via `SetEventBus` setters (consistent with the ATDD-blessed FileService deviation; no ctor churn). api.yaml + `codegen.sh` clean (no sqlc drift; web `tsc -b` green). `go test -p 1 ./...` green; migration up→down→up clean. No-guard control confirmed the 0.8 fan-out active-only invariant bites. 3 documented red-fixes: (a) storage red file sizes rescaled to respect the real 50 MB per-file .pdf cap (crossing scenario preserved), (b) two inbox HTTP reds mark seeded callers email_verified (fixture gap vs. the RequireVerifiedEmail chain), (c) `story_10_1a_helpers.go` → `_test.go` (it references `_test.go`-only `qaSeed*` helpers, so must not compile into the regular `internal/test` package). Deferred: `FU-10-1-METADATA-ENRICH` (DD1b fields not carried by the ruled event payloads — bandPreview, schedule old/new time + changeKind, question preview). Status in-progress → review. See `10-1a-inbox-and-notifications-backend-completion-notes.md`. |
| 2026-10-06 | **Party-mode pre-dev review folded** (Winston/Murat/John/Sally independent subagents; "go with rec"). **Winston (backend):** 3 publish sites re-cited to real post-commit seams (storage=after locked closure not `:332`; billing=post-commit `:226-236` not `:202`; session=3 net-new sites after each closure); `FileService`/`SessionService`/`BillingService` all need net-new `*event.Bus` injection; **R3 hazard text was backwards** (SET-LOCAL-in-savepoint reverts, doesn't leak) → 0.2 pinned to `SetupRawPool`; DD2 now names **latency≠errors** + Polar-webhook async carve-out; `INSERT…SELECT` unconditional. **Murat (tests):** 0.2/0.5 amended, +0.6 idempotency characterization (R11 lesson), +0.7 swallow-path, +0.8 fan-out cardinality (+ new AC10); mark-read idempotency-vs-404 SQL trap pinned in AC5. **Sally (contract):** DD1b typed per-type metadata struct added (actor+ids+per-type fields, immutable snapshot, typed api.yaml shape) — the un-fixable-later N+1 gap; `link`=default-nav / ids-in-metadata-authoritative; Snooze predicate-evolution seam noted (no premature column). **John (scope):** teacher ungraded/late queue promoted from floating FU to release-committed story **10-1c-teacher-work-queue** (stays out of 10-1a — derived read). Stays ready-for-dev. |
| 2026-10-06 | **Code review** (`/bmad-code-review 10-1a`, Amelia; 3 adversarial Opus-4.8 layers — Blind Hunter / Edge Case Hunter / Acceptance Auditor). PASS on the WF-8 core (R1 cross-tenant, R3 async SET LOCAL, R2 null-guard, R15 owner-only-billing all verified SOLID; all 10 ACs met, 7 triggers wired). 1 decision-needed + 6 patch + 4 defer + 7 dismissed. Headline: storage-threshold publish uses the cancellable request ctx + synchronous email → a client disconnect loses the exactly-once 95% crossing PERMANENTLY (Edge HIGH) and a slow Resend hangs upload-confirm (Blind/Edge MED). See Review Findings. |

## Review Findings

_From `/bmad-code-review 10-1a` (2026-10-06, Amelia; Blind Hunter / Edge Case Hunter / Acceptance Auditor at Opus 4.8). WF-8 gate core (R1/R3/R2/R15) verified SOLID — no cross-tenant leak, no auth bypass, idempotency + storage-crossing dedup + fan-out cardinality all correct._

**Decision-needed (RESOLVED):**

- [x] [Review][Decision→Patch] `payment_failed` inbox cardinality per dunning cycle — **Ducdo chose option (b): exactly one open `payment_failed` per billing period.** Same-`eventID` webhook retries ARE deduped upstream (`polar_webhook_events` PK returns before the publish — verified), so the residual was *distinct* dunning webhooks (Polar day 1/3/5/7) each firing a fresh `PaymentFailed`. Reclassified as the patch below.

**Patch:**

- [x] [Review][Patch] **(MED)** `payment_failed` fires on every distinct dunning webhook (resolved decision, option b) — gate the on-bus publish on an actual grace *transition* (e.g. `enterGraceTx` returns a `transitioned bool`; publish only when it flips into `past_due`), or dedup on an open `payment_failed` row per billing period, so a dunning cycle yields exactly one owner row. `billing_polar.go:245-259`. Source: blind+edge (decision→patch).

- [x] [Review][Patch] **(HIGH)** Storage-threshold publish is synchronous + uses the cancellable request ctx — merges Edge#1 (data-loss) + Blind#2/Edge#3 (latency). `ConfirmUpload` publishes `StorageThresholdCrossed` with the live request `ctx` (not `context.WithoutCancel`), and `handleStorageThreshold` calls `email.Send` synchronously inside that publish. A client disconnect between the file-row commit and the subscriber's `Begin(ctx)` fails the handler (error swallowed); because usage is now ≥ threshold the `used < threshold` crossing predicate NEVER re-fires → the owner is never warned (exactly-once → zero-times). Separately a slow Resend stalls upload-confirm. Fix: dispatch the storage publish async in a `go func(){ defer func(){ _=recover() }(); ... }()` with `context.WithoutCancel(ctx)`, mirroring `billing_polar.go:245-259`. `file_service.go:596-603`, `notification_service.go:470-474`. Source: blind+edge.
- [x] [Review][Patch] **(MED)** Storage-threshold EMAIL CTA uses a relative href — `RenderStorageThresholdEmail` renders `<a href="/settings/storage">` which does not resolve in a mail client (the in-app row `link` is correctly client-routed; the email is not). AC8's test only asserts "upgrade" appears, so it green-passes while the CTA is dead. Fix: inject an absolute app base URL and render an absolute href, mirroring Story 9.3's `SetBillingSettingsURL` injection. `email_templates.go` `RenderStorageThresholdEmail`. Source: auditor (F1).
- [x] [Review][Patch] **(LOW)** Owner-less center logs ERROR instead of a benign skip — `handlePaymentFailed` + `handleStorageThreshold` wrap any `GetCenterOwnerContact` error (incl. `pgx.ErrNoRows`) and return it (bus logs at ERROR every event), contradicting their own "best-effort miss" comment and diverging from grade/assignment/question (which `return nil` on `ErrNoRows`). Fix: `if errors.Is(oerr, pgx.ErrNoRows) { return nil }` before wrapping. `notification_service.go:415-418, 445-447`. Source: blind+edge.
- [x] [Review][Patch] **(LOW)** `type` query param not validated against the enum — `List` passes `r.URL.Query().Get("type")` straight to the SQL `narg('type')`; a bogus `?type=garbage` returns `200 {data:[],total:0}` instead of `422 VALIDATION_ERROR`, diverging from the typed `NotificationType` contract (and from `unread_only`, validated right beside it). Fix: validate against the known types → `ValidationError`. `inbox_handler.go:80`. Source: blind+auditor (BH5/F2).
- [x] [Review][Patch] **(LOW)** `ListInbox` `int32(offset)` overflow on an unbounded `page` — `clampPagination` clamps `pageSize` but not `page`, and `parseSnakePageParams` `Atoi`s `page` unbounded; a crafted `?page=<huge>` makes `(page-1)*pageSize` wrap when cast to `int32`, yielding a negative OFFSET → Postgres rejects → 500. Same class as the Story 5-2a fix (clamp page before multiply). Fix: clamp `page` to a sane max (or guard the offset before the int32 cast). `notification_service.go:522,537`. Source: reviewer (verified; no layer raised it).
- [x] [Review][Patch] **(LOW)** `MarkAllReadForUser` omits `archived_at IS NULL` — stamps `read_at` on archived unread rows too; harmless to the badge/active-queue (both filter `archived_at IS NULL`) but inconsistent with every other verb's active-queue semantics. Fix: add `AND archived_at IS NULL`. `notifications.sql` `MarkAllReadForUser`. Source: blind (BH7).

_**Applied 2026-10-06** (all 7 patches). Gates GREEN: `gofmt`/`go build`/`go vet` clean · `go test -p 1 ./...` all packages ok · `tsc -b`=0 · `codegen.sh` re-run for the `MarkAllReadForUser` query change, no unexpected drift (no migration touched). New/strengthened coverage: storage ATDD now asserts the email CTA is an ABSOLUTE href. **Residual (merged into the HIGH patch, consciously NOT changed):** the storage-threshold **Upgrade email send stays synchronous on the upload-confirm path** — the synchronous bus + the ATDD crossing-dedup assertions (0→1→1→2) require synchronous completion, so a producer-side goroutine would weaken the gate. The `context.WithoutCancel` + `recover()` fix fully resolves the HIGH data-loss and panic risk; the residual email-latency optimization (fully async storage publish + eventual-consistency test) is folded into the panic-recover defer below as a named follow-up._

**Deferred (pre-existing / by-design / follow-up):**

- [x] [Review][Defer] Schedule cancel/delete mislabeled "was changed" + `scheduleChangedMeta` lacks an `action` field — all three session mutations share the one `schedule_changed` type with generic "A session … was changed." body and no `action` in metadata (unlike `enrollmentChangedMeta` which carries `Action`), so the FE cannot distinguish change/cancel/delete. Also `enrollmentChangedMeta` carries class *ids* but not class *names* (Auditor F3) → 10-1b class-name N+1. Deferred → **FU-10-1-METADATA-ENRICH** (already open). `notification_service.go` schedule/enrollment meta. Source: blind+edge+auditor.
- [x] [Review][Defer] `idx_notifications_user_active` does not serve the active-list sort — index is `(center_id, user_id, read_at, created_at DESC)`; the list query filters `archived_at IS NULL` (absent from the index) and leaves `read_at` unconstrained between the equality cols and the sort col, so Postgres sorts rather than index-orders. The count-unread query DOES benefit. Migration is immutable (WF-2); deferred — add a targeted `(center_id, user_id, archived_at, created_at DESC)` index migration if inbox-list latency shows at scale. `20261006140000_create_notifications.up.sql:53-54`. Source: blind (BH6).
- [x] [Review][Defer] Synchronous event bus has no panic recovery — the in-process bus (1.2f) does not recover; `session`/`file` synchronous publishes lack the `defer recover()` that `billing_polar` added. NOT reachable today (the only panic source, `uuid.MustParse(ev.CenterID)`, is guarded by `SetTenantContext` rejecting an invalid CenterID first). Deferred: pre-existing bus design; cheap hardening = add `recover()` to the publish sites / bus for consistency with billing. `session.go` `publishScheduleChanged`, `file_service.go:596`. Source: blind+edge.
- [x] [Review][Defer] Billing/storage notify only the oldest owner (`LIMIT 1`) while enrollment notifies all owners+admins — `GetCenterOwnerContact` is `ORDER BY created_at LIMIT 1`. No DB constraint enforces one owner per center (`center_members` is UNIQUE on `user_id` only), but there is no multi-owner product flow today, so this is latent. Not an R15 leak (stays owner-only). Deferred — revisit if multi-owner ships. `notifications.sql` `GetCenterOwnerContact`. Source: blind+edge.

**Dismissed (7):** Blind#3 same-`eventID` webhook retry dup (false — deduped upstream by `polar_webhook_events` PK before the publish); Edge#5 `<95%→>100%` single upload gets no 95% warning (by design — the `StorageFullError`/413 surfaces fullness directly); Edge#8 non-storage producers drop a notification on request-ctx cancel (by DD2 design — best-effort, swallowed; only the exactly-once storage path matters → patched); Blind#10 `UpdateSessions` publishes on any edit (sessions are schedule entities — every edit is schedule-relevant); Blind#8 empty-className fan-out (the class was just mutated — `ErrNoRows` not reachable in practice); Auditor F4 `NotificationMetadata` superset vs per-type `oneOf` (documented deliberate v1 call — Go uses typed structs w/ schemaVersion, DD1b hard constraint met); Auditor F5 metadata `""` vs `null` (cosmetic — FE renders from `type`+ids).
