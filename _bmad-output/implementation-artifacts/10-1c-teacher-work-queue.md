# Story 10.1c: Teacher Work Queue (Grading Backlog in the Inbox)

Status: review

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: 1435fd1
epic: 10
story: 10.1c
fr: FR-56 (teacher inbox work-queue lens; backend substrate 10-1a `done`, FE inbox slice 10-1b `done`)
size: M
audience: full-stack (one net-new derived-read endpoint + teacher-view FE merge)
depends_on: [10-1a inbox+notifications backend (done, f850adc — contract frozen), 10-1b role-scoped inbox frontend (done, 1435fd1 — TeacherInbox/InboxView/mapper/chips shipped), 8-1a dashboard grading-backlog queries (done — reuse shape), 6.1 grade-release + current_grades view (done)]
split_from: 10-1 (party-mode fold 2026-10-06, John/Sally; promoted from a floating FU to a release-committed story)
sibling: 10-1b-role-scoped-inbox-frontend (done — RELEASE-COUPLED: the inbox feature ships only when BOTH 10-1b and 10-1c are done)
wf8_hard_gate: true   # Top risk = cross-teacher / cross-tenant read leak on the net-new derived query (a teacher seeing another teacher's — or another tenant's — ungraded submissions). This is the 7-2a teacher role-scope class (≥6). RED-FIRST ATDD on (a) store cross-TENANT RLS, (b) service cross-TEACHER scope within one tenant, (c) released-submission-excluded correctness — before in-progress.
ducdo_rulings: "Q1 RENDER MODEL = merge into ONE time-sorted list (not stacked sections, not chip-switched) — the teacher inbox is one feed of question_asked notifications + derived grading-queue rows, newest-first. Q2 BADGE = notifications-only (unchanged /api/inbox/count); the queue surfaces its own count in-feed, NOT on the nav badge. Q3 LATE = server-side filter param (late_only) so the Late chip stays paginated honestly. Q4 ACCESS = teacher-scoped only (teacher_id = caller always); owner/admin center-wide backlog stays on the dashboard s06, not the inbox."
---

## Story

As **a teacher**,
I want **my `/inbox` to surface my grading backlog — ungraded and late student submissions — interleaved with my question notifications in one time-sorted feed, each with a one-click "Grade" action**,
so that **the inbox is my actual work queue (the reason to open it), not a question_asked-only shell.**

This is the **teacher-work-queue** half of Story 10.1. 10-1b shipped the teacher inbox as a `question_asked`-only shell by design, explicitly pending this story. 10-1c adds a **net-new derived-read endpoint** `GET /api/inbox/teacher-queue` (over `submissions` + `assignments`, NOT notification rows) and merges its rows into the existing teacher `InboxView` as a single time-sorted list. The 10-1a contract and the 10-1b FE slice are **frozen** and MUST NOT be reopened beyond the additive wiring below.

---

## Why a derived read, NOT notification rows (the keystone constraint — do not relitigate)

A teacher's grading backlog is a **derived state**, not an event. There is **no `submission.submitted` event** on the bus, and a notification-row-per-submission would have to be *inserted* when a submission arrives and *deleted/archived* when the grade is released — and that delete races the grade-release commit + its post-commit fan-out, leaving phantom "grade me" rows after grading (10-1a line 205; sprint-status 2026-10-06 ruling). Instead, `teacher-queue` is a **live read** over `submissions LEFT JOIN current_grades`: the instant a teacher releases a grade, the row disappears on the next read — no write to race, no staleness. **Release oracle** (6.1): a submission is graded ⇔ its latest `current_grades` version has `released_at IS NOT NULL` — NEVER "a grade row exists", NEVER `submission.status = 'graded'`. The queue filter is therefore `status IN ('submitted','ai_processing') AND (cg.id IS NULL OR cg.released_at IS NULL)`.

---

## Context & Reuse Map (READ FIRST — almost everything already exists)

### Backend — REUSE, do not reinvent

| Capability | Where it lives | Note |
|---|---|---|
| **The queue shape (near-exact reuse)** | `classlite-api/internal/store/queries/dashboard.sql:15-49` — `CountGradingBacklog` / `ListGradingBacklog` | Already do *"submitted\|ai_processing submissions with no released grade, scoped to `classes.teacher_id`"*. `ListGradingBacklog` returns `submission_id, student_name (u.full_name), assignment_title (e.title), class_name (c.name), overdue ((COALESCE(hard_deadline_at,deadline_at) < @now)::bool), submitted_at`. **The ONLY gaps vs teacher-queue: it is top-N (`item_limit`, no OFFSET) and omits `is_late` + the ids needed to build the grading `link`.** Clone its body into a new paginated pair (Task 1). |
| **Teacher role-scope axis** | `classes.teacher_id` (1:N; no `class_teachers` table) — narg idiom `AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid)` (`dashboard.sql:26,47`) | **10-1c ALWAYS sets the narg to `tc.UserID` (Ducdo Q4 teacher-scoped-only) — never NULL.** Cross-teacher isolation is this SERVICE-layer predicate (RLS only tenant-scopes; two teachers share a `center_id`), so it needs its own adversarial test (WF-8). |
| **`current_grades` released view** | `migrations/20260818120000_create_grades.up.sql:72-77` — `security_invoker=true` DISTINCT ON latest version | LEFT JOIN it; `cg.released_at IS NULL` ⇒ still in the queue. security_invoker means base-table RLS applies as the caller (no owner-bypass). |
| **`is_late` (the Late facet)** | `submissions.is_late boolean` — snapshotted at submit (`submitted_at > deadline_at`, STRICT; `submissions.sql` `SubmitSubmission`) | Server-side `late_only` filter (Ducdo Q3): `AND (NOT sqlc.arg('late_only')::bool OR sub.is_late)`. `is_late` (snapshot) and `overdue` (live-clock) are DISTINCT — emit both. |
| **Pagination substrate** | `internal/service/student_service.go:41-86` — `DefaultPageSize=20`, `MaxPageSize=100`, `clampPagination`, `pageResult`, `PageResult`; the **exact `ListInbox` mirror** at `notification_service.go:551-611` (parse → clamp → `math.MaxInt32` overflow guards on page/offset → one `inTenantTx` runs List + Count → `pageResult`) | Copy the `ListInbox` method shape verbatim. `OFFSET (page-1)*pageSize LIMIT pageSize` (XL-2). Tiebreak `ORDER BY sub.submitted_at ASC NULLS LAST, sub.id ASC` (deterministic slice membership — the 7-2a `released_at` lesson). |
| **Inbox handler + ungated chain** | `internal/handler/inbox_handler.go` (`InboxHandler{svc, clk}`, methods are `func(w,r) error`; `List` at `:74` is the pattern) + `cmd/api/main.go:808-813` (`questionChain` = extractTenant→requireVerified→requireCenter, **no role gate**) | Add `TeacherQueue(w,r) error` beside `List`; register `GET /api/inbox/teacher-queue` on `questionChain`. Mirror `List`: `requireQuestionTenant(r)` → `parseSnakePageParams(r)` → parse `late_only` → `svc.ListTeacherQueue(...)` → `writePaginatedEnvelope(w, h.clk, items, pageMeta)`. |
| **Envelope / pagination helpers** | `writePaginatedEnvelope` (`enrollment_handler.go:329`), `parseSnakePageParams` (`:351`), `requireQuestionTenant` (`question_handler.go:46`, no role gate) | Emits `{data, meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}`. Query params snake_case (`page`, `page_size`, `late_only`). |
| **Injected clock (overdue)** | `InboxHandler.clk clock.Clock`; dashboard binds `@now` | The handler computes `now := h.clk.Now()` and passes it to the service → the query `@now`. MockClock in tests makes `overdue` deterministic. |

### Frontend — REUSE, do not rebuild (10-1b shipped the whole slice)

| Capability | Where it lives | Note |
|---|---|---|
| **The teacher view + shared surface** | `src/features/inbox/TeacherInbox.tsx` (`<InboxView role="teacher" emptyLens="teacher" enableTeacherReply/>`) → `components/InboxView.tsx` (the ONE shared surface; `handlePrimaryAction` at `:118-133` already does `navigate(notification.link)`) | The grading rows mount **through the same `InboxView`** by merging into its `rows` array (Ducdo Q1). Do NOT fork a second surface or a second `InboxListShell`. |
| **The `submission` display lane (already ships!)** | `components/domain/InboxRow.tsx` — `InboxRowType` includes `submission`; `ROW_ICON.submission=BookOpen`, `ROW_TONE.submission=--cl-accent-2`, **`PRIMARY_ACTION_KEY.submission='inboxRow.action.grade'` ("Grade")** | Map queue items to `InboxRowData{type:'submission'}` and the row renders a Grade button + the archive slot for free. (Submission rows suppress archive — see DD3.) |
| **1d-4 submission i18n (already both locales)** | `inboxRow.teacher.submission.main="{{student}} submitted {{exercise}}"`, `inboxRow.action.grade`, `inboxRow.meta.classDate` | Reuse for the main text. Net-new: overdue/late meta + "N to grade" in-feed count (STORY_10_1C_KEYS). |
| **Chip derivation + chip count slot** | `lib/inboxChips.ts` — `ROLE_CHIPS.teacher=['all','unread','questions']`; `InboxListShell` `InboxFilterChip{key,count?}` renders a `count` badge | Extend `ROLE_CHIPS.teacher` → `['all','unread','questions','submissions','late']`; feed the queue `total` into the Submissions/Late chip `count`. |
| **The anti-corruption mapper** | `lib/notificationMapping.ts` — `toInboxRow(n:Notification):InboxRowData`, compile-time-exhaustive `never` switch | Add a SIBLING mapper `toInboxRowFromQueueItem(q:TeacherQueueItem):InboxRowData` (type `'submission'`). Do NOT widen `NotificationType` — queue items are NOT notifications. |
| **Query keys + list hook pattern** | `api/inboxKeys.ts` (`{all,lists,list,count}`, `INBOX_PAGE_SIZE=20`); `api/useInbox.ts` (`apiFetchWithMeta<Notification[],Meta>`) | Add `inboxKeys.teacherQueue(params)` + `api/useTeacherQueue.ts` mirroring `useInbox`. |
| **The grading deep-link** | Route `/classes/:id/grading/:aid/:sid` (`routes.tsx:1233`, gated owner/admin/teacher, full-bleed) = `/classes/{classId}/grading/{assignmentId}/{submissionId}` | **The server builds `link` into each queue item** (ids-authoritative, DD1b link rule) so the FE `navigate(link)` matches exactly. Emit `classId`/`assignmentId`/`submissionId` too. |
| **Test harness** | `components/__tests__/InboxView.test.tsx` — `renderView(role,emptyLens,enableTeacherReply)`, real QueryClient + i18n + MemoryRouter, MSW at the HTTP boundary; `__tests__/InboxRoute.test.tsx` `seedSession(role)` | Extend `renderView('teacher',...)` + register a `http.get('/api/inbox/teacher-queue', …)` MSW handler. `tsc -b` gate (not `--noEmit`); keep `vitest.config.ts` `execArgv:['--no-experimental-webstorage']`. |

### Net-new — THIS story builds

- **BE:** `internal/store/queries/submissions.sql` → `ListTeacherQueue` (Limit+Offset, `is_late`, ids) + `CountTeacherQueue` (both with `late_only`) → `sqlc generate`. `NotificationService.ListTeacherQueue(ctx, tc, lateOnly, now, page, pageSize)`. `InboxHandler.TeacherQueue`. Route `GET /api/inbox/teacher-queue` on `questionChain`. api.yaml: `TeacherQueueItem` + `EnvelopeTeacherQueueList` schemas + the path → `scripts/codegen.sh`. **No migration, no new table, no new RLS policy.**
- **FE:** `api/useTeacherQueue.ts`, `api/inboxKeys.ts` (+`teacherQueue` member), `lib/teacherQueueMapping.ts` (`toInboxRowFromQueueItem`), `lib/inboxChips.ts` (+submissions/late), `components/InboxView.tsx` (teacher-branch merge + client pager over the merged feed), i18n keys + `__tests__/inboxI18nKeys10c.ts` (`STORY_10_1C_KEYS`).

---

## The Frozen Contracts (consume verbatim)

- **10-1a Notification contract** (`src/lib/api/client.ts` @ f850adc): `Notification`, `NotificationType` (7-enum — `question_asked` is the teacher's only notification type in v1), `EnvelopeNotificationList`, `/api/inbox?type&unread_only&page&page_size`, `/api/inbox/count`, `/api/inbox/{id}/read|archive`, `/api/inbox/read-all`. **DO NOT change.** `teacher-queue` is purely additive.
- **10-1b FE slice** (`src/features/inbox/` @ 1435fd1): `InboxRoute`/`InboxView`/`toInboxRow`/`deriveInboxChips`/`useInbox`/`useInboxActions`/`useInboxCount`/`InboxStates`/`InboxReplyComposer`. **Additive-only edits** (merge the queue into the teacher branch; add chips/hook/mapper). The student/admin/owner views are untouched.
- **Grading deep-link:** `/classes/{classId}/grading/{assignmentId}/{submissionId}` (exact — the server-built `link`).

---

## Design Decisions (engineering calls — override at dev pickup only with written reason)

- **DD1 — `teacher-queue` is a submissions-only derived read; the merge is a FE render concern (reconciles the sprint note with Ducdo Q1).** The endpoint stays exactly as the keystone framed it — a paginated derived read over `submissions`+`assignments`, teacher-scoped, NOT notification rows. Ducdo's "one time-sorted list" (Q1) is satisfied by the **frontend** interleaving the queue rows with the existing `question_asked` notification rows in `InboxView`. The backend never joins notifications to submissions (two different RLS tables, two different shapes, two different lifecycles) — keeping the SQL honest and the sprint-note scope intact.
- **DD2 — `ListTeacherQueue` = `ListGradingBacklog` + {paginate, `is_late`, ids, `late_only`}.** Clone `dashboard.sql:28-49` into `submissions.sql`; add `sub.is_late`, `c.id AS class_id`, `a.id AS assignment_id` to the SELECT; replace `LIMIT item_limit` with `LIMIT $lim OFFSET $off`; add `AND (NOT sqlc.arg('late_only')::bool OR sub.is_late)`. `CountTeacherQueue` mirrors the WHERE (incl. `late_only`). Keep the `ORDER BY sub.submitted_at ASC NULLS LAST, sub.id ASC` tiebreak. **`overdue = (COALESCE(a.hard_deadline_at, a.deadline_at) < @now)::bool`** bound to the injected clock. Put the queries in `submissions.sql` (data-domain) with a header comment pointing back here; the service method lives on `NotificationService` (the inbox service that owns the handler).
- **DD3 — The FE merge: one feed, single client-side pager over bounded sets (the coherent way to honor Q1 without a server UNION).** Two independently server-paginated sources cannot share a coherent pager (the exact incoherence the 10-1b code review fixed). So in v1 the teacher branch fetches **both sources at a high page size** (`page_size = MaxPageSize` 100 — the teacher's active `question_asked` set and ungraded backlog are both bounded: the dashboard rail shows "~19", bounded by the teacher's class sizes), maps each to `InboxRowData`, **merges + sorts by `occurredAt` DESC**, and paginates the merged array **client-side** by `INBOX_PAGE_SIZE`. The merged `total` = the merged array length ⇒ **coherent** (not two server totals summed blindly). Submission rows (`type:'submission'`) get the **Grade** primary action (→ `navigate(link)` via the existing `handlePrimaryAction`) and **suppress the archive/read-on-view affordance** — they are not notifications, carry no `readAt`/`archivedAt`, and leave the feed only when graded+released. The unread badge stays notifications-only (Ducdo Q2). **Document the v1 ceiling** (`FU-10-1C-MERGE-PAGINATION`): if either source's server `pagination.total > MaxPageSize`, the feed shows only the first page of that source — surface an honest in-feed seam ("Showing your most recent — open the grading queue for all") rather than silently truncating (CQ: no silent caps). Do NOT client-recompute counts to paper over this.
- **DD4 — Chips (Ducdo Q1 + Q3).** `ROLE_CHIPS.teacher = ['all','unread','questions','submissions','late']`. **`all`** = merged feed (notifications + queue, time-sorted). **`unread`** = `question_asked` notifications with `readAt==null` only (submissions have no unread state — excluded). **`questions`** = notifications only. **`submissions`** = the full ungraded queue (`late_only=false`). **`late`** = the queue filtered `late_only=true` (SERVER-side param, Ducdo Q3 — keeps that slice paginated honestly). Mentions/System chips stay absent (no events → `FU-10-1-MENTIONS`/`FU-10-1-STAFF-HEALTH`). The Submissions/Late chips carry the queue `total` in the `InboxListShell` chip `count` slot ("Submissions 12").
- **DD5 — Teacher-scoped-only authz (Ducdo Q4), enforced in the service.** `ListTeacherQueue` ALWAYS binds `teacher_id = tc.UserID` (never the NULL center-wide narg). No `RequireRole` gate on the route (it rides the open `questionChain` like the rest of the inbox); a non-teacher caller simply gets their own-taught-classes queue, which for an owner/admin who teaches nothing is **empty** (no leak, no 403 needed — non-disclosure by construction). Owner/admin center-wide grading backlog remains the dashboard's job (s06), not the inbox (s52 is operational signals). The FE only mounts `useTeacherQueue` inside `TeacherInbox`.
- **DD6 — `overdue` (live clock) vs `is_late` (snapshot) are distinct — emit and render both.** `is_late` is frozen at submit (`submitted_at > deadline_at`). `overdue` is computed live against `@now` (a submission can be ungraded-and-not-yet-overdue, or late-at-submit, or both). The row meta shows the stronger signal (overdue if `overdue`, else late if `is_late`, else the submitted time). The **Late chip filters on `is_late`** (the stable, indexable snapshot), not the live `overdue` (which would make slice membership shift under the clock mid-pagination).
- **DD7 — Immutable snapshot semantics match the inbox.** Like notification rows, the queue row's `assignment_title`/`class_name`/`student_name` are read live from the current join (not frozen) — correct here because the queue is a *live* derived read, not a historical snapshot. No staleness concern (the opposite of the notification-row immutability note).

---

## Acceptance Criteria (BDD)

**AC1 — `GET /api/inbox/teacher-queue` returns the teacher's paginated ungraded backlog (derived read)**
**Given** a teacher with ungraded (`submitted`/`ai_processing`, no released grade) submissions across the classes they teach,
**When** `GET /api/inbox/teacher-queue?page=1&page_size=20` is called,
**Then** it returns `{data:[TeacherQueueItem], meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}`, each item carrying `submissionId, studentName, assignmentTitle, className, isLate, overdue, submittedAt, classId, assignmentId, link`,
**And** `link` is exactly `/classes/{classId}/grading/{assignmentId}/{submissionId}`,
**And** rows are ordered oldest-submitted-first with the `id` tiebreak (deterministic pagination), paginated via `OFFSET (page-1)*pageSize LIMIT pageSize`, and a crafted huge `page`/`page_size` is clamped (no 500, the `math.MaxInt32` overflow guard — the ListInbox class).

**AC2 — released / graded submissions are excluded (the grade-release correctness, no race)**
**Given** a submission that has just been graded and released (`current_grades` latest version `released_at IS NOT NULL`),
**When** the teacher-queue is read,
**Then** that submission is ABSENT (filter `cg.id IS NULL OR cg.released_at IS NULL`), a `submitted`/`ai_processing` submission with NO grade row is PRESENT, and a submission with an **unreleased** draft grade (`released_at IS NULL`) is still PRESENT,
**And** `in_progress` submissions never appear.

**AC3 — teacher role-scope: own classes only (cross-TEACHER isolation, WF-8)**
**Given** two teachers A and B in the SAME center, each teaching a different class with ungraded submissions,
**When** teacher A calls `teacher-queue`,
**Then** only A's own classes' submissions return — B's are absent (the service-layer `c.teacher_id = tc.UserID` predicate, NOT RLS, since both share a `center_id`),
**And** a non-teacher caller (owner/admin teaching no class) gets an empty queue, never another teacher's rows (DD5 non-disclosure by construction).

**AC4 — cross-TENANT isolation (WF-8, RLS)**
**Given** tenant A's teacher and tenant B's ungraded submissions,
**When** tenant A's teacher calls `teacher-queue` (and in the store-level adversarial test, a tenant-A context reads with a crafted assignment/class id from tenant B),
**Then** zero tenant-B rows are returned (RLS `SET LOCAL app.current_tenant_id` on `submissions`/`assignments`/`classes`/`current_grades`); the `security_invoker` view does not bypass tenant isolation.

**AC5 — the `late_only` server-side filter (Ducdo Q3)**
**Given** a mix of on-time-but-ungraded and late (`is_late=true`) submissions,
**When** `GET /api/inbox/teacher-queue?late_only=true` is called,
**Then** only `is_late=true` rows return, `total`/`totalPages` reflect the filtered set (pagination stays honest — not a client slice of a full page), and `late_only=false`/absent returns the full ungraded set.

**AC6 — teacher inbox renders ONE merged time-sorted feed (Ducdo Q1; FE)**
**Given** the teacher inbox with both `question_asked` notifications (`GET /api/inbox?type=question_asked`, MSW) and grading-queue rows (`GET /api/inbox/teacher-queue`, MSW),
**When** the `all` chip is active,
**Then** `InboxView` renders a SINGLE list interleaving both kinds newest-first via `InboxRow`, submission rows show the **Grade** action and question rows the **Reply** action, the client-side pager treats the merged array as one coherent list (`total` = merged length), and clicking Grade `navigate`s to the submission's `link` (the exact grading deep-link),
**And** a submission row exposes **no** archive/read affordance (DD3) while question rows retain archive + read-on-view,
**And** the empty feed (no questions AND no queue) shows the role-toned teacher empty (`inbox.empty.teacher.*`, reused from 10-1b).

**AC7 — teacher chips incl. server-filtered Late (DD4; FE)**
**Given** `deriveInboxChips('teacher')`,
**When** evaluated,
**Then** it yields `all, unread, questions, submissions, late` (and NO mentions/system chip), the `submissions`/`late` chips carry the queue `total` as their `count`, selecting `submissions` shows the full queue, `late` refetches with `late_only=true`, `questions`/`unread` show notifications only, and `all` shows the merged feed,
**And** a cross-role guard asserts the student/admin/owner chip configs are unchanged (no `submissions`/`late` leak into other roles).

**AC8 — queue→row mapping (sibling mapper, not a widened NotificationType; FE)**
**Given** a `TeacherQueueItem`,
**When** `toInboxRowFromQueueItem` maps it,
**Then** it yields `InboxRowData{type:'submission'}` with `mainTextKey='inboxRow.teacher.submission.main'` + vars `{student, exercise}`, a meta that renders the stronger of overdue/late/submitted-time (DD6), `occurredAt=submittedAt`, and `unread` unset,
**And** `NotificationType` is NOT widened to include submissions (queue items are a separate shape — the `toInboxRow` `never`-exhaustive switch stays intact), and both `en` and `vi` resolve for the overdue/late/neutral meta variants with NO empty/`undefined` interpolation (value-scan, TEST-FE-4).

**AC9 — badge stays notifications-only (Ducdo Q2; FE)**
**Given** the teacher has K unread questions and N ungraded submissions,
**When** the sidebar/mobile Inbox badge renders,
**Then** it shows K (from the unchanged `/api/inbox/count`), NOT K+N — the ungraded count is surfaced only in-feed (the Submissions/Late chip `count` + the "N to grade" header affordance), and the badge wiring in `AppLayout` is untouched (negative assertion: no new count query feeds the badge).

**AC10 — i18n parity + a11y**
**Given** all net-new keys (overdue/late/neutral submission meta, "N to grade" / chip counts, the merge-ceiling seam copy, any new chip labels beyond the reused `inboxList.filter.submissions`),
**When** the parity ratchet runs,
**Then** every new key exists in BOTH `en.json` and `vi.json`, enumerated in a new `STORY_10_1C_KEYS` array wired into `i18n-parity-coverage.test.ts` (RED-FIRST per the ATDD convention), and the teacher inbox passes `axe` with the merged feed rendered (no violations; the Grade action reachable by its i18n-resolved label).

---

## Tasks / Subtasks

**Task 1 — `ListTeacherQueue` + `CountTeacherQueue` sqlc queries (BE; AC1/AC2/AC5; WF-1/WF-3 — do FIRST so sqlc regenerates before the service)**
- [x] 1.1 In `internal/store/queries/submissions.sql`, add `CountTeacherQueue :one` and `ListTeacherQueue :many` — clone `dashboard.sql:15-49`'s body; ALWAYS take `teacher_id` as a required arg (not narg) bound to the caller; add `sub.is_late`, `c.id AS class_id`, `a.id AS assignment_id` to the SELECT; `LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off')`; `AND (NOT sqlc.arg('late_only')::bool OR sub.is_late)` in BOTH; keep `ORDER BY sub.submitted_at ASC NULLS LAST, sub.id ASC`; keep `overdue = (COALESCE(a.hard_deadline_at, a.deadline_at) < sqlc.arg('now'))::boolean`. Header comment points back to this story + notes "reuses the 8-1a grading-backlog shape; teacher_id REQUIRED (Ducdo Q4)".
- [x] 1.2 Run `scripts/codegen.sh` (sqlc) → verify `ListTeacherQueueParams{CenterID, TeacherID, Now, LateOnly, Lim, Off}` + `ListTeacherQueueRow` land in `internal/store/generated/`. No migration (WF-2/WF-3: no schema change). No generated hand-edit (XL-1).

**Task 2 — `NotificationService.ListTeacherQueue` (BE; AC1-AC5; mirror `ListInbox`)**
- [x] 2.1 Add `ListTeacherQueue(ctx, tc model.TenantContext, lateOnly bool, now time.Time, page, pageSize int) ([]TeacherQueueItem, PageResult, error)` on `NotificationService` — mirror `ListInbox` (`notification_service.go:551-611`): `clampPagination` + the `math.MaxInt32` page/offset overflow guards; ONE `inTenantTx` (`store.SetTenantContext`) running `ListTeacherQueue` + `CountTeacherQueue`; `teacherID := tc.UserID` bound to BOTH; build `link` server-side (`/classes/{classId}/grading/{assignmentId}/{submissionId}`); return `items, pageResult(page,pageSize,total), nil`.
- [x] 2.2 Define `TeacherQueueItem` DTO (`{SubmissionID, StudentName, AssignmentTitle, ClassName, IsLate, Overdue bool, SubmittedAt, ClassID, AssignmentID, Link}`) — explicit `json` tags, NO `omitempty` (GO-5).

**Task 3 — `InboxHandler.TeacherQueue` + route (BE; AC1/AC5; mirror `List`)**
- [x] 3.1 `TeacherQueue(w,r) error` → `requireQuestionTenant(r)` → `parseSnakePageParams(r)` → parse `late_only` bool query param → `now := h.clk.Now()` → `h.svc.ListTeacherQueue(ctx, tc, lateOnly, now, page, pageSize)` → `writePaginatedEnvelope(w, h.clk, items, pageMeta)`. Error → `middleware.ErrorMapper` envelope.
- [x] 3.2 Register `mux.Handle("GET /api/inbox/teacher-queue", questionChain(inboxHandler.TeacherQueue))` in `cmd/api/main.go` beside the other inbox routes (`:808-813`).

**Task 4 — api.yaml + codegen (BE; AC1; WF-1/WF-4)**
- [x] 4.1 Add schemas `TeacherQueueItem` (the DTO above — `submissionId/studentName/assignmentTitle/className/isLate/overdue/submittedAt/classId/assignmentId/link`, all required/non-null) and `EnvelopeTeacherQueueList` (`{data:[TeacherQueueItem], meta: EnvelopeMetaPagination}`), reusing `EnvelopeMetaPagination`/`PaginationMeta`.
- [x] 4.2 Add the `GET /api/inbox/teacher-queue` path (params `page`, `page_size`, `late_only`; `bearerAuth`; → `EnvelopeTeacherQueueList`). Run `scripts/codegen.sh` (openapi-typescript) → `client.ts` gains `TeacherQueueItem`/`EnvelopeTeacherQueueList` + the path. **api.yaml + client.ts ship in ONE commit with the FE (WF-4).** No sqlc drift beyond Task 1.

**Task 5 — FE data hook + keys + mapper (AC6/AC8)**
- [x] 5.1 `api/inboxKeys.ts` — add `teacherQueue: (params) => [...all, 'teacher-queue', params]` (TS-3). Add a `TeacherQueueParams{page, pageSize, lateOnly}` type.
- [x] 5.2 `api/useTeacherQueue.ts` — `useQuery` via `apiFetchWithMeta<TeacherQueueItem[], PaginationMeta>('/api/inbox/teacher-queue?…')` (snake_case `page`/`page_size`/`late_only`), explicit `staleTime` (FW-3), `placeholderData: keepPreviousData`, **`enabled: role==='teacher'`** (only the teacher branch fetches). Returns `{items, pagination}`.
- [x] 5.3 `lib/teacherQueueMapping.ts` — `toInboxRowFromQueueItem(q): InboxRowData` (`type:'submission'`, DD6 meta selection, null-safe). Do NOT touch `NotificationType`/`toInboxRow`.

**Task 6 — FE merge into InboxView teacher branch + chips (AC6/AC7/AC9)**
- [x] 6.1 `lib/inboxChips.ts` — `ROLE_CHIPS.teacher = ['all','unread','questions','submissions','late']`; `chipFilter` maps `submissions`→queue(lateOnly=false), `late`→queue(lateOnly=true), `questions`/`unread`→notifications, `all`→merged. Feed the queue `total` into the `submissions`/`late` chip `count`.
- [x] 6.2 `components/InboxView.tsx` — teacher-branch ONLY (guard on `role==='teacher'`): call `useTeacherQueue`, map its items via `toInboxRowFromQueueItem`, **merge with the mapped notification rows, sort by `occurredAt` DESC**, client-paginate the merged array by `INBOX_PAGE_SIZE` (DD3). Submission rows: Grade → existing `navigate(link)` path; **suppress archive + exclude from read-on-view** (they have no id-in-notifications semantics). Header "N unread · M total" → M = merged length; add the "N to grade" affordance. Other roles' code path is unchanged (no regression). Surface the DD3 ceiling seam when a source `total > MaxPageSize`.
- [x] 6.3 Confirm `AppLayout` badge wiring is UNTOUCHED (AC9 negative) — no new count query; the badge keeps reading `/api/inbox/count`.

**Task 7 — i18n + tests + verify (AC6-AC10; WF-8 red-first)**
- [x] 7.1 Add net-new keys to `en.json` + `vi.json` (overdue/late/neutral submission meta e.g. `inboxRow.teacher.submission.metaOverdue`/`.metaLate`/`.metaSubmitted`, "N to grade" `inbox.teacher.toGrade`, chip-count aria, the merge-ceiling seam copy). Reuse existing `inboxRow.teacher.submission.main`, `inboxRow.action.grade`, `inboxList.filter.submissions`. Create `src/features/inbox/__tests__/inboxI18nKeys10c.ts` (`STORY_10_1C_KEYS`, net-new only — do NOT re-list 1d-4/10-1b keys) + wire into `i18n-parity-coverage.test.ts` **RED-FIRST**.
- [x] 7.2 **WF-8 RED-FIRST ATDD (BE)** — `//go:build atdd_red_phase` specimens, de-tagged at green: (AC3) cross-TEACHER scope — two teachers one center, A sees only A's; (AC4) cross-TENANT store RLS — tenant-A ctx returns 0 tenant-B rows (store-level, `test.SetupDB` + two deterministic tenant ids, never DISABLE RLS; TEST-BE-1/2); (AC2) released-excluded / unreleased-present / in_progress-absent correctness; (AC5) `late_only` filtered total. Handler integration test (TEST-BE-3) through `questionChain` asserts the `{data,meta.pagination}` envelope + MockClock-deterministic `overdue`.
- [x] 7.3 FE tests (extend `InboxView.test.tsx` `renderView('teacher',…)` + a `http.get('/api/inbox/teacher-queue',…)` MSW handler): (AC6) merged feed interleaves + Grade navigates to the exact link + submission row has no archive; (AC7) chip derivation incl. Late server-filter + cross-role guard; (AC8) queue mapper golden (overdue/late/neutral × en/vi value-scan); (AC9) badge-unchanged negative; (AC10) axe + parity.
- [x] 7.4 **Verify (DoD):** BE `gofmt`/`go vet`/`go test -p 1 ./...` green (incl. the de-tagged reds); `scripts/codegen.sh` clean (sqlc = +2 queries, openapi = +1 path/2 schemas, no unexpected drift); FE `tsc -b` green; full web vitest green (0 regressions); ESLint clean (no raw fetch, no cross-feature deep import, no useEffect fetch); api.yaml + client.ts + FE in ONE commit (WF-4).

---

## Dev Notes

- **Consume the frozen contracts; additive-only.** 10-1a's notification contract and 10-1b's inbox slice are `done`. This story adds one endpoint + merges its rows into the teacher branch of `InboxView`. Do NOT reopen the notification schema, the mapper's `never`-switch, or the other role views.
- **The merge is the delicate part (DD3).** Two server-paginated sources can't share a coherent pager — the exact bug the 10-1b review fixed. v1 fetches both bounded sets at `page_size=100` and paginates the MERGED array client-side so `total` is coherent. This trades strict server-pagination for a coherent merged feed, bounded by realistic teacher volumes (dashboard "~19"). The ceiling + `FU-10-1C-MERGE-PAGINATION` (a server-unified cursor) are documented — flag the seam, never silently truncate.
- **`is_late` (snapshot) ≠ `overdue` (live clock) — DD6.** The Late chip filters the stable `is_late` snapshot (deterministic slice under pagination); the row meta shows the live `overdue` when true. Don't filter the chip on the live clock.
- **Teacher-scoped-only is a SERVICE invariant, not RLS (DD5/AC3).** Two teachers share a `center_id`, so RLS does NOT isolate them — the `c.teacher_id = tc.UserID` predicate does. That is why AC3 (cross-teacher) is a first-class WF-8 test alongside AC4 (cross-tenant), mirroring the 7-2a teacher role-scope lesson.
- **GO-1/GO-3/GO-4:** `TenantContext` on the store call; authz (teacher scope) in the service, never the handler/store; propagate the request `ctx` (no `context.Background()`). **GO-5:** no `omitempty` on `TeacherQueueItem`. **GFW-5:** envelope via `writePaginatedEnvelope`.
- **TS-3/TS-4/TS-6:** structured query keys; `apiFetchWithMeta` unwraps `{data,meta}`; `submittedAt` stays ISO until the formatter. **FW-4:** `useTeacherQueue` is a Query, no `useEffect`. **TS-7:** no deep cross-feature imports.
- **Release-coupled:** the inbox feature is launch-ready only when 10-1b (done) AND this story are both `done` (Ducdo OD4, carried from 10-1b).

### Project Structure Notes

- BE touches: `submissions.sql` (+2 queries), `store/generated/` (regenerated), `notification_service.go` (+1 method +DTO), `inbox_handler.go` (+1 method), `cmd/api/main.go` (+1 route), `api.yaml` (+1 path/2 schemas). No migration, no new RLS policy, no new table.
- FE touches: `features/inbox/api/{inboxKeys,useTeacherQueue}.ts`, `features/inbox/lib/{teacherQueueMapping,inboxChips}.ts`, `features/inbox/components/InboxView.tsx` (teacher branch), `features/inbox/__tests__/inboxI18nKeys10c.ts`, `locales/{en,vi}.json`, `lib/test/__tests__/i18n-parity-coverage.test.ts`. Student/admin/owner views, `toInboxRow`, `useInbox`, `useInboxActions`, `AppLayout` badge = UNTOUCHED.

### References

- Backend reuse: [Source: classlite-api/internal/store/queries/dashboard.sql:15-49 (`List/CountGradingBacklog`)] · [internal/service/notification_service.go:551-611 (`ListInbox` mirror)] · [internal/service/student_service.go:41-86 (clamp/pageResult)] · [internal/handler/inbox_handler.go:74 (`List`)] · [cmd/api/main.go:808-813 (`questionChain`)] · [migrations/20260818120000_create_grades.up.sql:72-77 (`current_grades` view)] · [migrations/20260801130000_create_submissions.up.sql:18-34] · [migrations/20260703120200_create_classes.up.sql:24 (`teacher_id`)].
- Frontend reuse: [Source: classlite-web/src/features/inbox/TeacherInbox.tsx + components/InboxView.tsx:118-133] · [components/domain/InboxRow.tsx (`submission` lane + `PRIMARY_ACTION_KEY`)] · [lib/inboxChips.ts:63-81] · [lib/notificationMapping.ts] · [api/inboxKeys.ts, api/useInbox.ts] · [routes.tsx:1233 (grading deep-link)] · [components/__tests__/InboxView.test.tsx (`renderView`)].
- Contract: [Source: _bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend.md (DD1/DD1b/DD5, line 205)] · [10-1b-role-scoped-inbox-frontend.md (DD2/DD8/AC8)] · [classlite-web/src/lib/api/client.ts].
- Epic / UX: [Source: epics/epic-10.md#Story 10.1 (teacher s50 central queue: ungraded + late + overdue flag + Grade action)] · [ux-design-specification.md:502-506 §8.5 (teacher chips All/Unread/Questions/Submissions/Late/Mentions/System), :476 s06 "Needs grading" rail, :552-554 §9.4 grading queue deep-link].
- Rules: GO-1/3/4/5, GFW-5, TS-3/4/6/7, FW-3/4, UX-2/3, TEST-BE-1/2/3, TEST-FE-1/4/6, XL-1/2, WF-1/2/3/4. [Source: docs/project-context.md]

### Risk / WF-8

| Risk | Score | Covered by |
|---|---|---|
| **Cross-TEACHER read leak** (teacher A sees teacher B's ungraded submissions — same tenant, RLS does NOT isolate; relies on the service `teacher_id=caller` predicate) | **≥6** (the 7-2a teacher role-scope class — a new derived query over a new join is exactly where this regresses) | AC3 RED-FIRST (two-teacher-one-center) + DD5 service invariant |
| **Cross-TENANT read leak** (new query over submissions/assignments/classes/current_grades) | **≥6** (R1 class) | AC4 RED-FIRST store RLS (two tenants, `test.SetupDB`, never DISABLE RLS) + the `security_invoker` view proof |
| **Grade-release race → phantom "grade me" row** (the keystone reason this is a derived read) | resolved-by-design | AC2 (released-excluded / unreleased-present / in_progress-absent correctness) — no notification write to race |
| Merged-feed pagination incoherence (the 10-1b review bug class) | 4 (bounded v1) | DD3 single client pager over bounded sets + `FU-10-1C-MERGE-PAGINATION` + the honest ceiling seam |

**WF-8 — HARD GATE (true).** Unlike 10-1b (which only *mapped to* backend risks owned in 10-1a), 10-1c introduces a **net-new derived query with its own cross-teacher AND cross-tenant isolation surface** — the ≥6 risk is genuinely owned here. Full red-first ATDD ceremony applies: AC3 (cross-teacher), AC4 (cross-tenant store RLS), AC2 (release-exclusion correctness), AC5 (late filter) ship as `//go:build atdd_red_phase` specimens, verified red (tagged compile/assert fails only on the documented green seams; untagged `go build`/`go vet` clean), then de-tagged green. Confirm at `/bmad-tea AT 10-1c`.

---

## Definition of Done

- All 10 ACs met.
- `GET /api/inbox/teacher-queue` returns a teacher-scoped, paginated, release-aware derived read with a `late_only` filter; `overdue` clock-injected; `link` = the exact grading deep-link; cross-teacher AND cross-tenant isolation proven by adversarial tests.
- The teacher `/inbox` renders ONE merged time-sorted feed of question notifications + grading-queue rows (Ducdo Q1), Grade navigates to the grading surface, submission rows carry no archive/read; the unread badge stays notifications-only (Ducdo Q2); the Late chip filters server-side (Ducdo Q3); access is teacher-scoped-only (Ducdo Q4).
- NO migration, NO new table, NO new RLS policy; `go test -p 1 ./...` green; `codegen.sh` clean (sqlc +2 queries, openapi +1 path/2 schemas); `tsc -b` green; full web vitest green (0 regressions) incl. the WF-8 reds, the queue mapper golden, chip derivation + cross-role guard, merged-feed render, badge-unchanged negative, parity, and axe; ESLint clean.
- All new strings in `en.json` + `vi.json` + `STORY_10_1C_KEYS` ratchet (no hardcoded English); api.yaml + client.ts + FE in ONE commit (WF-4); no generated-file hand-edit.
- File ≤600 lines; completion notes sibling (`10-1c-teacher-work-queue-completion-notes.md`) created at dev pickup per `docs/bmad-story-conventions.md`.
- **Release note:** this story is release-coupled with `10-1b` — the inbox feature is launch-ready only when BOTH are `done`.

---

## Out of Scope (→ follow-ups)

- **Server-unified merged cursor** (one coherent server-paginated feed UNION-ing notifications + queue, replacing the v1 bounded client merge) → `FU-10-1C-MERGE-PAGINATION` (only needed when a teacher's combined feed exceeds `MaxPageSize`).
- **Owner/admin center-wide grading backlog in the inbox** → stays on the dashboard s06 (Ducdo Q4); not an inbox surface.
- **Grade·apply-penalty / Waive / ✦AI-suggest-reply inline actions** (UX s50) → the Grade action navigates to the full grading surface where these live; inline queue actions → `FU-10-1-AI-REPLY` / future.
- **@mentions + System/health chips** for the teacher → `FU-10-1-MENTIONS` / `FU-10-1-STAFF-HEALTH` (no source events).
- **Including the ungraded count in the nav badge** → explicitly NOT done (Ducdo Q2); a future "work-to-do badge" story if ever wanted.
- **Swipe-to-act on queue rows (mobile s84)** → `FU-10-1-SWIPE` (shared with 10-1b).
- **Index tuning for the teacher-queue join** at scale (the join rides existing `idx_submissions_center_assignment` / `idx_assignments_center_class` / `idx_classes_teacher_id`) → monitor; add a targeted index migration only if EXPLAIN shows a problem at volume.

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-07 | **DEV-STORY complete → review** (`/bmad-dev-story 10-1c`, Amelia). All 10 ACs / 7 tasks / 18 subtasks done. **BE:** additive `GET /api/inbox/teacher-queue` derived read — `List/CountTeacherQueue` sqlc (clone of 8-1a `ListGradingBacklog` + `is_late`/ids/`LIMIT·OFFSET`/`late_only`, `teacher_id` REQUIRED = caller per Q4) → `NotificationService.ListTeacherQueue` (mirrors `ListInbox` clamp + int32 guards, server-built grading `link`) → `InboxHandler.TeacherQueue` on the ungated `questionChain`; api.yaml `TeacherQueueItem`/`EnvelopeTeacherQueueList` + path → codegen. NO migration/table/RLS-policy. 4 ATDD reds de-tagged → green; **both no-guard controls confirmed the predicates bite** (neutralized `teacher_id=caller` → AC3 cross-teacher leak; dropped `cg.released_at IS NULL` → AC2 unreleased-draft wrongly excluded), then reverted. **FE:** teacher-branch merged feed in the shared `InboxView` (DD3 — both sources fetched @100, merged + sorted `occurredAt` DESC, client-paginated; Grade→`navigate(link)`; submission rows suppress archive via new `InboxRow.suppressArchive`); chips → `all·unread·questions·submissions·late` (`late`=server `late_only`, Q3); in-feed "N to grade" (NOT the badge, Q2); DD3 ceiling seam; sibling `toInboxRowFromQueueItem` mapper (NotificationType enum untouched); 6 net-new i18n keys (en+vi) + `STORY_10_1C_KEYS` ratchet. **GATES GREEN:** BE gofmt/vet/`go test -p 1 ./...` ok (incl. the 4 de-tagged reds; cleared a stale committed `idx_users_email` fixture from a prior aborted run — not a code defect); `codegen.sh` additive (sqlc +2 queries, openapi +1 path/2 schemas); `tsc -b`=0; web vitest inbox+parity 1094 pass + InboxView teacher merged-feed 14 pass; ESLint clean. AC9 badge: `AppLayout` untouched. Dev Agent Record + File List in the completion-notes sibling. RELEASE-COUPLED w/ 10-1b. Next: `/bmad-code-review 10-1c` (prefer a different LLM). |
| 2026-10-07 | **ATDD red-phase generated + verified** (`/bmad-tea AT 10-1c`, Murat). Stack=fullstack, AI-generation mode. 8 files in `classlite-api/internal/test/` (1 helper `story_10_1c_helpers_test.go` + 3 specimens) and `classlite-web/src/features/inbox/` (mapper golden + chips runtime-red + `inboxI18nKeys10c.ts` + parity red). **BE reds** (`//go:build atdd_red_phase`): AC3 cross-TEACHER scope (two teachers one center, positive+negative paired, non-teacher→empty) · AC4 cross-TENANT RLS (both directions, same outer tx) · AC1/AC2/AC5 contract (release-exclusion matrix incl. the ai_processing+unreleased-draft release-oracle branch, exact grading `link`, live `overdue` via MockClock, `late_only` filtered-total, huge-page clamp). **FE reds:** `teacherQueueMapping.golden.test.ts` compile-seam (`../teacherQueueMapping`) · `inboxChips.teacher10c.test.ts` runtime-red (teacher gains submissions/late + cross-role guard) · `inboxI18nParity10c.test.ts` parity-red (`STORY_10_1C_KEYS`). **RED VERIFIED:** BE untagged `go build`/`go vet ./...` exit 0 (reds excluded); tagged `go test -c` compile-fails on EXACTLY ONE line (`story_10_1c_helpers_test.go:66 h.TeacherQueue undefined`), zero incidental; gofmt clean. FE `tsc -b` = 1 error total (the mapper seam; the LSP billing/profile flood confirmed stale-cache — CLI tree clean); the two runnable reds fail for the right reason (teacher-submissions chip absent; `STORY_10_1C_KEYS` missing from locales). Seam contract + green guidance: `_bmad-output/test-artifacts/atdd-checklist-10-1c-teacher-work-queue.md`. **WF-8 HARD GATE SATISFIED for backlog→in-progress.** Stays ready-for-dev. Next: `/bmad-dev-story 10-1c` (implement seam substrate-first, de-tag each BE red at green, run no-guard controls on the teacher_id predicate + the cg.released_at disjunction). |
| 2026-10-07 | Created via `/bmad-create-story 10-1c` (Amelia). 2-agent parallel recon (backend submissions/grading/authz + frontend inbox teacher-view) + reads of the frozen 10-1a contract, 10-1b slice, epic-10 s50, UX §8.5/§9.4, and deferred-work. **Key finding:** the teacher-queue is a near-exact paginated reuse of the 8-1a dashboard `List/CountGradingBacklog` (teacher-scoped via `classes.teacher_id`, release-aware via `current_grades`), and the `submission` display lane + `inboxRow.action.grade` already ship in 1d-4 chrome → modest M story. **4 Ducdo rulings:** Q1 RENDER = merge into ONE time-sorted list (engineered as a FE merge over bounded sets with a single client pager; the endpoint stays submissions-only per the sprint note) · Q2 BADGE = notifications-only (queue count in-feed) · Q3 LATE = server-side `late_only` param · Q4 ACCESS = teacher-scoped-only (owner/admin backlog stays on the dashboard). **WF-8 HARD GATE** (net-new derived query owns both cross-TEACHER service-scope and cross-TENANT RLS ≥6 risks → red-first ATDD). No migration (derived read). 10 ACs / 7 tasks. New FU: `FU-10-1C-MERGE-PAGINATION`. backlog → ready-for-dev. baseline 1435fd1. Next: (optional `/bmad-tea AT 10-1c`) → `/bmad-dev-story 10-1c`. |
