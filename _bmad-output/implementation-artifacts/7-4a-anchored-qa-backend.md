# Story 7.4a: Anchored Q&A — Backend Keystone

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

---
story_key: 7-4a-anchored-qa-backend
epic: 7
story: "7.4a"
size: M
audience: Backend
baseline_commit: 6d49509e1b824882d477291b14e46ed466856b8e
branch: api/feat/anchored-qa-backend
depends_on: [4.2, 5.2a, 3.4.5]
frs: [FR-38, FR-39, FR-40]
nfrs: [NFR-6]
risk: 7
wf8_hard_atdd_gate: true   # R26 (role-scope leak, score 6) — red-first before in-progress
split_of: "7.4 → 7-4a (backend keystone, this) + 7-4b (frontend, backlog)"
---

## Story

As the ClassLite API,
I want a role-scoped, class-anchored Q&A model (`questions` + `question_replies`) with ask / list / reply / resolve / batch-reply endpoints, `personal`|`shared` reply-visibility scoping, hard Owner/Admin zero-visibility elision, and a post-commit `question.asked` event seam,
so that Story 7-4b can wire the student in-attempt Q&A sidebar (s36) and the teacher Q&A console (s18) against a stable, adversarially-verified contract without any further backend work.

**Context:** Story 7.4 (Size L, full-stack) is split — this is the backend keystone; **7-4b** (frontend rail/console) consumes it and is backlog. Q&A is **greenfield**: no `questions`/`question_replies` table, query, store type, or `/api/questions` path exists today. `event.QuestionAsked = "question.asked"` is **already declared** (`classlite-api/internal/event/types.go:8`) with zero publishers and zero subscribers — 7-4a is the first publisher; the Inbox subscriber lands in Epic 10.

## Acceptance Criteria

### Schema & RLS

**AC1** — **Given** migrations run, **Then** a `questions` table exists: `id, center_id, exercise_id (FK exercises RESTRICT), class_id (FK classes RESTRICT), student_id (FK users RESTRICT), anchor_type text CHECK (item|exercise), anchor_ref jsonb NULL, anchor_excerpt text NULL, content text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (open|resolved), created_at, updated_at`. Standard 4-policy **FORCE ROW LEVEL SECURITY** grid keyed on `center_id = current_setting('app.current_tenant_id')::uuid` (mirror `enrollments` `migrations/20260722120000`). `anchor_ref IS NULL` when `anchor_type='exercise'`; non-null positional path when `='item'` — a `CHECK` couples them (D2).
**And** the migration is a paired `.up.sql`/`.down.sql`; the down is `DROP TABLE IF EXISTS questions`. Next free timestamp: `20260910120000_create_questions` (latest applied is `20260908120200`).

**AC2** — **Given** migrations run, **Then** a `question_replies` table exists: `id, center_id, question_id (FK questions RESTRICT), author_id (FK users RESTRICT), content text NOT NULL, visibility text NOT NULL CHECK (personal|shared), created_at`. Same FORCE-RLS tenant grid. `center_id` denormalized onto the reply row (do NOT rely on the FK join for the RLS predicate). **No UPDATE/DELETE endpoint ships** — replies are effectively append-only from the API surface in v1 (edit/delete deferred, FU-7-4-C), but this is enforced by *absence of an endpoint*, NOT the audit-log REVOKE lock (Q&A is a mutable domain — `questions.status` transitions).

**AC3 (D3 — class context)** — **Given** a question is created, **Then** `class_id` is **derived server-side** from the asking student's attempt (the request carries `assignmentId`; the service reads `assignment.class_id` and `assignment.exercise_id`) — **never** trusted from the request body (SEC-7). The client MUST NOT be able to set `class_id`, `exercise_id`, `student_id`, or `center_id`.

### Ask (student)

**AC4** — **Given** a Student POSTs `/api/enrollments`-style `POST /api/questions` with `{assignmentId, anchorType (item|exercise), anchorRef?, anchorExcerpt?, content}`, **When** the student is the owner of an active attempt on that assignment AND is **actively enrolled** in the assignment's class, **Then** a `questions` row is inserted (`student_id = caller`, `exercise_id`+`class_id` derived from the assignment, `status='open'`) and `event.QuestionAsked` is published post-commit. `anchorType='item'` requires `anchorRef` (positional path `{sectionIndex, questionGroupIndex, questionIndex}` and/or `{sectionIndex, charStart, charEnd}` for passage spans) — the server stores the JSONB verbatim + `anchorExcerpt` snapshot; `anchorType='exercise'` requires `anchorRef` be null.

**AC5** — **Given** a caller who is NOT the attempt owner, or is not actively enrolled in the class, or is not a Student, **When** POST `/api/questions` runs, **Then** the request is rejected: non-owner/not-enrolled → 404 `QUESTION_TARGET_NOT_FOUND` (non-disclosure — never confirm the assignment exists), non-student → 403 `INSUFFICIENT_ROLE`. Missing `content`/`anchorType`, or `anchorRef` present when `anchorType='exercise'` (or absent when `='item'`) → 422 `VALIDATION_ERROR`.

### Read (role-scoped) — R25/R26 HARD ATDD GATE

**AC6** — **Given** `GET /api/questions?exercise_id=&class_id=&status=&unanswered=&page=&page_size=` and `GET /api/questions/{id}` (thread with its replies), **Then** the response is role-scoped in the **service layer** against the **DB-fetched role** (SEC-1, `center_members.role`, not the JWT claim): **Student** → only questions they authored; **Teacher** → only questions whose `class_id` is a class they teach (`classes.teacher_id = me`); **Owner / Admin** → **empty list / empty thread — NEVER null, NEVER 403, NEVER error** (R25/R26 elision).

**AC7 (R25/R26 adversarial — WF-8 red)** — **Given** the same fixtures, **Then** an adversarial integration test asserts: Owner query → **0** Q&A rows; Admin query → **0** Q&A rows; Teacher query → only questions for classes they teach (0 for another teacher's class); Student query → only own questions (0 for another student's). Elision is achieved by a **nullable/absent scope predicate that matches nothing** for Owner/Admin (mirror the 7-2a `teacher_id` narg elision idiom, `student_service.go:222-236`) — Owner/Admin **reach the handler** (not gated out by `RequireRole`) and receive a valid empty envelope.

### Reply, visibility & resolve (teacher)

**AC8** — **Given** a Teacher POSTs `POST /api/questions/{id}/replies` with `{content, visibility (personal|shared), resolve?}`, **When** the teacher **teaches the question's class** (`classes.teacher_id = me`, re-validated from DB — SEC-1), **Then** a `question_replies` row is inserted (`author_id = caller`) and, if `resolve=true`, `questions.status` is flipped `open→resolved` **in the same transaction** ("Send & resolve"). A non-teaching teacher, a Student, or Owner/Admin → 404 `QUESTION_NOT_FOUND` (non-disclosure; Owner/Admin never learn the thread exists). `visibility` maps UX label → DB value: **"Private" → `personal`**, **"Shared with your class" → `shared`** (D5).

**AC9 (`shared` scope — WF-8 red)** — **Given** a Teacher replies with `visibility='shared'`, **Then** the thread + that reply are visible to **all students CURRENTLY (`status='active'`) enrolled in the question's `class_id`** at read time (a student who transfers in later gains access; one who transfers out loses it — scoped by *current* enrollment, not enrollment-at-post-time). Students enrolled in **other** classes (even same center) → **0 rows**. Adversarial test proves both directions.

**AC10 (`personal` scope — WF-8 red)** — **Given** a Teacher replies with `visibility='personal'`, **Then** only the **asking student** AND the **replying teacher** (author) see that reply. Other teachers — even one who also teaches the same class — → **0 rows** for that reply (per-thread teacher binding = the reply `author_id` + the question `student_id`). Adversarial test proves a second same-class teacher cannot read a `personal` reply.

**AC11 (resolve)** — **Given** `PATCH /api/questions/{id}` with `{status: 'resolved'}` (or the `resolve=true` reply combo of AC8), **When** the teaching teacher calls it, **Then** `status` → `resolved`; a resolved question is **excluded from `?unanswered=true`** and from the open count. Resolve is one-way in v1 (reopen deferred, FU-7-4-D). Student/Owner/Admin/non-teaching-teacher → 404 `QUESTION_NOT_FOUND`.

**AC12 (batch reply)** — **Given** `POST /api/questions/batch-reply` with `{questionIds: [...], content, visibility, resolve?}`, **When** the teacher teaches the class of **every** listed question, **Then** one `question_replies` row is inserted per question **and** (if `resolve=true`) each question is resolved, **all in one transaction** — partial success is impossible (any single question the teacher does not teach → whole request 404 `QUESTION_NOT_FOUND`, zero writes). Max batch size = a named const (e.g. `maxBatchReply = 50`) → 422 `VALIDATION_ERROR` above it.

### Cross-cutting

**AC13 (SEC-1 role re-validation)** — Every privilege decision (read scope, reply authz, resolve authz) keys off the **DB-fetched `center_members.role`** re-read inside the write/read transaction (`GetCenterMemberByUserAndCenter`), NOT `tc.Role` from the JWT — a demoted teacher with a stale 15-min token cannot reply/resolve. Adversarial test: demoted user rejected despite a valid JWT (mirror `role_revalidation_atdd_test.go`).

**AC14 (event seam)** — `event.QuestionAsked` is published post-commit, nil-tolerant, fanning out to **zero handlers** today (mirror `EnrollmentService.publish`, `enrollment_service.go:673-687`). Payload `QuestionAskedPayload{QuestionID, StudentID, ClassID, ExerciseID}` — **no email is sent** (D4; Q&A notifications are Inbox-native per FR-40, unlike enrollment's transactional email). The bus logs type/center/user only (never payload — EDGE-4).

**AC15 (RLS adversarial grid)** — Both tables carry the standard cross-tenant adversarial suite (`internal/test/questions_rls_test.go`, `question_replies_rls_test.go`): CrossTenantRead → 0 rows; CrossTenantWrite/Delete → 0 RowsAffected; CrossTenantInsert → `AssertRLSViolation` (SQLSTATE 42501); NullTenant/UnsetTenant → 0 rows. Never `DISABLE ROW LEVEL SECURITY`.

**AC16 (contract + codegen)** — `api.yaml` gains the `/api/questions*` paths + schemas; **read shapes are PROVISIONAL** (co-finalized by 7-4b, mirror 7-2a D14 / 7-3a); mutation bodies are stable. `scripts/codegen.sh` re-run (sqlc + openapi-typescript + zod). Envelope `{data, meta}`; pagination is `page`+`page_size` query (snake) → `meta.pagination{page,pageSize,total,totalPages}` (camel); GO-5 explicit nulls (no `omitempty`). New error codes registered in `internal/middleware/error_mapper.go`: `QUESTION_NOT_FOUND`, `QUESTION_TARGET_NOT_FOUND`.

## Tasks / Subtasks

- [x] **Task 1 — Migrations** (AC1, AC2, AC15)
  - [x] `20260910120000_create_questions.{up,down}.sql` — table + CHECKs (anchor_type/anchor_ref coupling, status) + FORCE-RLS 4-policy grid + `idx_questions_center_class`, `idx_questions_center_student`, `idx_questions_class_status` (RLS-filtered composite, PERF-2).
  - [x] `20260910120100_create_question_replies.{up,down}.sql` — table + visibility CHECK + FORCE-RLS grid + `idx_question_replies_question`.
  - [x] `scripts/migrate.sh` up; verify against schema.
- [x] **Task 2 — WF-8 ATDD reds (BEFORE in-progress)** (AC7, AC9, AC10, AC13, AC15) — `//go:build atdd_red_phase`
  - [x] `questions_role_scope_atdd_test.go` — Owner→0, Admin→0, Teacher-own-only, Student-own-only.
  - [x] `question_visibility_atdd_test.go` — `shared` current-enrollment (transfer in/out) + other-class 0; `personal` asker+author only + second-same-class-teacher 0.
  - [x] `question_role_revalidation_atdd_test.go` — demoted teacher reply/resolve rejected on stale JWT.
  - [x] `questions_rls_test.go` + `question_replies_rls_test.go` — cross-tenant grid.
  - [x] Checklist → `_bmad-output/test-artifacts/atdd-checklist-7-4a-*.md`.
- [x] **Task 3 — sqlc queries** (AC3–AC12) — `internal/store/queries/questions.sql`
  - [x] `CreateQuestion` (derived exercise_id/class_id args); `GetAssignmentForQuestion` (assignment→class_id+exercise_id + attempt-owner + active-enrollment checks, or reuse `GetActiveEnrollment` + assignment read).
  - [x] `ListQuestions` role-scoped: nullable `teacher_id` narg (Teacher pin / Owner-Admin elide-to-empty) + nullable `student_id` narg + `exercise_id`/`class_id`/`status`/`unanswered` filters + pagination (`ListQuestionsPaged` + `CountQuestions`).
  - [x] `GetQuestionThread` + `ListRepliesForReader` (visibility predicate: `shared` ⋈ active enrollment in class_id; `personal` → reader is question.student_id OR reply.author_id).
  - [x] `CreateReply`, `ResolveQuestion`, teach-check helper (`ClassTaughtBy`).
- [x] **Task 4 — codegen** (AC16) — extend `api.yaml` (paths + PROVISIONAL read schemas + stable mutation bodies + error codes); run `scripts/codegen.sh`; commit generated diff.
- [x] **Task 5 — QuestionService** (AC3–AC14) — `internal/service/question_service.go`
  - [x] Constructor `NewQuestionService(db, audit?, clk, events)` — nil-tolerant `events` seam (no `emailQueue` — D4).
  - [x] `Ask` (derive class/exercise, ownership+enrollment gate, anchor validation, one-tx insert, post-commit `publish`).
  - [x] `List`/`GetThread` — DB-role re-fetch → scope map (student/teacher/elide); 404 non-disclosure.
  - [x] `Reply` (teach-check via DB role, one-tx insert + optional resolve), `Resolve`, `BatchReply` (all-or-nothing tx).
  - [x] `publish` + `QuestionAskedPayload`.
  - [x] New typed errors in `internal/service/errors.go` + arms in `error_mapper.go`.
- [x] **Task 6 — Handler + routes** (AC4–AC12, AC16) — `internal/handler/question_handler.go`
  - [x] `POST /api/questions`, `GET /api/questions`, `GET /api/questions/{id}`, `POST /api/questions/{id}/replies`, `PATCH /api/questions/{id}`, `POST /api/questions/batch-reply`.
  - [x] **Route chains: teacher- AND student-reachable, Owner/Admin NOT gated out** (they must reach the handler for the empty-list contract — do NOT `RequireRole(teacher)`). Register in `cmd/api/main.go` alongside the enrollment chains.
  - [x] Envelope + pagination helpers (`writePaginatedEnvelope` precedent).
- [x] **Task 7 — Green the reds + service/handler tests** (AC5–AC13)
  - [x] De-tag the Task-2 atdd files; add `// GREEN SEAMS (…)` header block.
  - [x] Service unit tests (mock store) for role-scope map, anchor validation, batch all-or-nothing.
  - [x] Handler integration tests (real middleware/DB) asserting full envelope + error shapes.
- [x] **Task 8 — Deferrals + docs** (AC14) — file `FU-7-4-A` (inbox→Epic 10), `FU-7-4-B` (dashboard "Unanswered" rail→Epic 8), `FU-7-4-C` (reply edit/delete), `FU-7-4-D` (reopen resolved); note the epic-07 line-206 `private`→`personal` enum correction; capture the **7-4b handoff** (below) in the story. Dev Agent Record + File List → sibling `7-4a-anchored-qa-backend-completion-notes.md`.

### Review Findings

_Code review 2026-09-10 (Amelia) — 3-layer adversarial (Blind Hunter · Edge Case Hunter · Acceptance Auditor). 3 decision-needed (all resolved by Ducdo), 8 patch, 1 defer, 4 dismissed._

- [x] [Review][Patch] **Student → 404 (not 403) on resolve/batch-reply** — Ducdo D1→opt1: narrow student→403 to the **reply** verb only (FIND-1 literal); Resolve + BatchReply return 404 QUESTION_NOT_FOUND for students, matching AC11/AC12 + api.yaml. Split the student branch out of the shared `authorizeTeacherOfQuestion` for the resolve/batch paths [`question_service.go:515`] `blind+auditor`
- [x] [Review][Defer] **AC9 `shared` reply not reachable by non-asker classmates end-to-end** — `GetQuestionForReader` (`questions.sql:68`) scopes students to own questions (AC6), so a classmate 404s in `GetThread` and never reaches the `shared`/active-enrollment branch in `ListRepliesForReader` (`questions.sql:150`). Ducdo D2→opt1: intended store-layer readiness; endpoint delivery → 7-4b. Follow-up `FU-7-4-E`. **Deferred reason:** Classmate-visible shared-thread read is frontend-adjacent (s36 student rail); store query is correct + adversarially proven, endpoint delivery belongs with 7-4b. `auditor`
- [x] [Review][Patch] **Drop dead `assignment.status` select in the ask path** — Ducdo D3→opt1: attempt-ownership + active-enrollment is a sufficient v1 gate; asking stays open on any assignment. Remove `status` from `GetAssignmentForQuestion` [`questions.sql:26`] (codegen re-run). `blind+edge+auditor`
- [x] [Review][Patch] Batch-reply does not de-duplicate `questionIds` — a repeated id creates multiple replies on one thread (AC12 "one reply per question") [`question_service.go:478`]
- [x] [Review][Patch] Item-anchor positional indices stored with no sanity guard — no non-negativity, no `charStart <= charEnd` [`question_service.go:554` `validateAskInput`/`anchorHasTarget`] (deep cross-validation vs exercise structure stays deferred per D2)
- [x] [Review][Patch] `status` list filter + `unanswered` param not validated against the enum/bool — `?status=garbage` → silent empty 200 instead of 422; `unanswered` strict `== "true"` silently drops `1`/`TRUE` [`question_handler.go:825-829`]
- [x] [Review][Patch] `unmarshalAnchor` silently swallows JSON errors → returns nil — corrupt item `anchor_ref` renders as `anchorRef:null` (looks exercise-anchored) with no log [`question_service.go:623`]
- [x] [Review][Patch] api.yaml `QuestionAnchor` marks `schemaVersion` required on the request anchor, but the handler ignores it and stamps `1` — request contract misdescribed (server-owned field) [`api.yaml` `QuestionAnchor`]
- [x] [Review][Patch] No per-field `maxLength` on `content`/`anchorExcerpt` (only a 16KB whole-body cap) — add a field limit in api.yaml + service validation [`question_service.go:554`/`587`]

## Dev Notes

### Ducdo rulings (2026-09-10)
- **D1 — Split.** 7.4 → 7-4a (backend keystone, this) + 7-4b (frontend, backlog). Re-keys `7-4` → `7-4a`/`7-4b` in sprint-status.
- **D2 — Anchor model = positional path + excerpt snapshot.** Exercise items have **no stable IDs** — content is positional JSONB (`internal/store/exercise_content.go:100-160`: `Sections[]→QuestionGroups[]→Questions[]`, no `id` anywhere), and the attempt UI addresses items by an index handle `si:gi:qi` (`attemptContent.ts:8` — "questions carry no id — 5.2a"). So `anchor_ref` is a **positional path** (`{sectionIndex, questionGroupIndex, questionIndex}`, or `{sectionIndex, charStart, charEnd}` for passage spans) **plus** a denormalized `anchor_excerpt` text snapshot captured at ask-time (like `AnchoredQuestionCard.anchoredExcerpt`). The question survives an exercise edit by displaying its original excerpt even if the index drifts. **Accepts R28** (wrong-section-after-edit, risk 4) as low with the excerpt mitigation. **No Story 4.2 change.** Store `anchor_ref` verbatim as typed JSONB (GO-7: a versioned struct, not `map[string]interface{}`).
- **D3 — Add `class_id` to `questions`.** The epic's exercise_id-only schema + "teacher binding via exercise_id ownership" is **broken**: exercises are center-**library** items (`created_by`, skill-tagged, NOT class-owned — `migrations/20260727120000`). A question always originates from a student **attempt on an assignment**, and `assignments(exercise_id, class_id)` (`migrations/20260801120000`) is the bridge. So the question carries `class_id` (+ keep `exercise_id`), both **derived server-side from `assignmentId`**. This makes teacher-binding = `classes.teacher_id`, `shared`-scope = active enrollments in `class_id`, and teacher "own questions" = classes they teach — all well-defined. **Amend epic-07 line 206** note accordingly.
- **D4 — Notify = event-only.** Publish `event.QuestionAsked` post-commit (zero subscribers today); **no email**. FR-40 frames Q&A notifications as **Inbox** items (Epic 10), not transactional email — divergent from 7-3a enrollment (which Ducdo ruled email-now). Inbox row → Epic 10 / Story 10.1 (subscribes to the seam); dashboard "Unanswered" rail → Epic 8 / Story 8.1.
- **D5 — Visibility enum = `personal` | `shared`** (DB values). UX labels map: **"Private" → `personal`**, **"Shared with your class" → `shared`**. Resolves the epic-07 self-contradiction (line 206 says `private/shared`; lines 218-220 behavioral ACs + test wording + user-memory say `personal`). Amend line 206.

### Reuse map — cite, do not reinvent
- **RLS FORCE-grid + adversarial harness:** clone `enrollments` migration grid (`migrations/20260722120000`); tests via `test.SetupDB(t)` (sets `SET LOCAL ROLE classlite_app`, `internal/test/helpers.go:86-108`), `test.TenantContext(t, db, centerID)` (`helpers.go:117-130`), `AssertRLSViolation` (`story_2_2_helpers.go:422-442`); grid template `internal/test/adversarial_test.go:20-457`. **Q&A tables are the standard mutable 4-policy grid — NOT the append-only audit_logs REVOKE lock** (Q&A `status` mutates).
- **Role→scope elision (the R25/R26 mechanism):** 7-2a's nullable narg — `AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))` + `student_service.go:222-236` maps Owner/Admin → `pgtype.UUID{Valid:false}` (center-wide) / Teacher → pinned. **For Q&A the elision is inverted**: Owner/Admin must map to a predicate that matches **nothing** (not center-wide) — the closest idiom, but the role→visibility table is new. Do NOT gate Owner/Admin out with `RequireRole`; they reach the handler and get an empty envelope.
- **SEC-1 DB role re-fetch:** `GetCenterMemberByUserAndCenter` (`internal/store/queries/center_members.sql:1-4`); write-tx opener precedent `beginEnrollmentWrite` (`enrollment_service.go:489-527`: `Begin → SetTenantContext → generated.New(tx) → GetCenterMemberByUserAndCenter → defer Rollback`). ATDD proof precedent `internal/service/role_revalidation_atdd_test.go`.
- **Active-enrollment scoping (`shared` + ask-gate):** `GetActiveEnrollment` (`enrollments.sql:66-69`, `WHERE class_id=$1 AND student_id=$2 AND status='active'`); service wrapper `assertActiveEnrollment` (`submission_service.go:247-260` → `NotEnrolledError`). The `shared` reply read predicate is a query-time join `enrollments e ON e.class_id = q.class_id AND e.student_id = <reader> AND e.status='active'` (RLS gives tenant isolation; "currently enrolled" is an explicit `status='active'` predicate the query adds — precedent `assignments.sql:82`).
- **Attempt/assignment chain (derive class+exercise + ownership gate):** `submissions(assignment_id, student_id)` UNIQUE (`migrations/20260801130000`); the student attempt-read path (`getSubmissionAttempt`, 5.2a) already re-checks active enrollment on read — reuse the same gate for the ask path. `assignments` gives `class_id`+`exercise_id`.
- **Event publish + nil-tolerant seam:** `EnrollmentService.publish` (`enrollment_service.go:673-687`); constructor injects `events *event.Bus` (`enrollment_service.go:79`). `event.QuestionAsked` const already at `event/types.go:8`.
- **Layering / envelope / errors:** trio `enrollment_handler.go` + `enrollment_service.go` + `queries/enrollments.sql`. Envelope `WriteEnvelope`/`writePaginatedEnvelope` (`response.go:34-53`, `enrollment_handler.go:329-339`); errors `WriteError` → `{error:{code,message,requestId,details}}`; new code needs BOTH a type in `internal/service/errors.go` AND an arm in `error_mapper.go:187-201/246-257/440-453`. `RequireRole` at `require_role.go:36-55`; chain registration `cmd/api/main.go:609-636`.
- **atdd_red_phase convention:** first line `//go:build atdd_red_phase` (`reference_atdd_red_convention`); at green, remove tag + add `// GREEN SEAMS (…)` header documenting the migration DDL + store signatures the impl filled (precedent `enrollment_history_rls_atdd_test.go:18-34`).

### anchor_ref JSONB shape (D2) — typed, versioned (GO-7)
```go
type QuestionAnchor struct {
    SchemaVersion int    `json:"schemaVersion"` // 1
    SectionIndex  int    `json:"sectionIndex"`
    // item-in-group anchor (anchor_type='item'):
    QuestionGroupIndex *int `json:"questionGroupIndex"`
    QuestionIndex      *int `json:"questionIndex"`
    // passage-span anchor (anchor_type='item' on a passage):
    CharStart *int `json:"charStart"`
    CharEnd   *int `json:"charEnd"`
}
```
`anchor_type='exercise'` ⇒ `anchor_ref` NULL. Validate at the service layer that `item` carries at least a `sectionIndex` + (group/question path OR char span). The excerpt (`anchor_excerpt`) is authoritative for display; the path is best-effort re-highlighting for 7-4b.

### WF-8 gate (risk 7 — HARD)
Epic-7 handoff lists **R25 + R26** for this epic (`classlite_new-handoff.md:54`); the Epic-7 gate criterion is "Q&A role-scope negative test (Owner/Admin see zero) green" (`:72`). **R26 = score 6** (role-scope leak, `test-design-progress.md:184`) → **hard ATDD gate**: the Task-2 red files (role-scope elision, `shared`/`personal` visibility, SEC-1 re-validation, cross-tenant RLS) MUST be on the branch and red BEFORE the story moves to `in-progress`; de-tag per-file at green. Journey coverage: E2E-J8-001/002/003 P0 (`test-design-progress.md:374-376`).

### Deferrals (file in Task 8)
- **FU-7-4-A** — In-app Inbox action items for unanswered questions → **Epic 10 / Story 10.1** (subscribes to the published `event.QuestionAsked`; sink must dedup — outbox is at-least-once, mirror FU-6-1-B). P2.
- **FU-7-4-B** — Teacher dashboard "Unanswered questions" action rail (question text + exercise anchor + time elapsed) → **Epic 8 / Story 8.1** (screen s06, FR-52); consumes the `?unanswered=true` count query. P2.
- **FU-7-4-C** — Reply edit/delete (soft-delete user-authored content per `feedback_soft_delete_user_authored_content`) — no endpoint in v1. P3.
- **FU-7-4-D** — Reopen a resolved question (`resolved→open`) — one-way in v1. P3.
- **AI-suggest reply** variant (teacher inbox ✦) rides with Epic 10 inbox — not 7-4a/7-4b backend. (Note only.)

### 7-4b handoff (frontend — backlog)
- **Routes in the epic are fictional.** `/exercises/{id}/attempt` and `/exercises/{id}` **do not exist**. Real student attempt route: `/assignments/:assignmentId/attempt` → `AttemptPage` (`src/features/quiz-attempt/`, full-bleed outside AppLayout, `routes.tsx:867-899`). **No teacher exercise-view route exists** (`/exercises` = library index; only `:id` child is `/exercises/:id/edit`). The two sidebar "Questions" links (`sidebarNavConfig.tsx:89,106`) are **dead placeholders** (`/exercises/active?questions=open`) → 7-4b must decide the real console route (likely a new top-level `/questions` "across my exercises" console, not a single-exercise view) and activate the dead links (like 7-2b activated `/students`).
- **Reusable shells:** `AnchoredQuestionCard` (`src/components/domain/AnchoredQuestionCard.tsx`, JSDoc already names "Epic 7 Story 7.4"; static — needs submit callback + **visibility toggle** + **anchor-pin color** [orange item / blue exercise], both absent today); selection mechanics `src/lib/essayAnchors.ts` + `WritingGradingPage.tsx:225-330` (getSelection/rect/mouseup composer — but Q&A is item-granular node-anchoring, a new primitive over the same scaffolding); planned but-deferred `AnchoredQuestionsRailShell`/`BatchActionBar` (domain) + `QuestionAnchorPin`/`Highlight`/`MobileQAThread`/`MobileQuestionReplyComposer` (feature) per `component-inventory.md:136-141,269-274`.
- **Data idiom:** clone `peopleKeys`/`useEnrolment`/`useEnrolmentActions` — component `useQuery` (no loader, pragmatic FW-1), generated types from `@/lib/api/client`, `apiFetch` envelope-unwrap, cache-direct invalidate (no optimistic). New `questionsKeys` + `SectionNameKey += 'questions'` (`PermissionDenied.tsx:45-58`) + i18n `questions.*` namespace (both locales — none exist).
- **Panel:** `?questions=open` param-panel over `Sheet` (`src/components/ui/sheet.tsx`, currently unused) — mirror `useSettingsTab.ts` URL-state pattern. Mobile = chat-bubble thread (s80/s85), a distinct component tree (UX-4).
- **Contract:** consume the STABLE mutation bodies; co-finalize the PROVISIONAL read shapes (strip markers + codegen, mirror 7-2b/7-3b D13).

### Project Structure Notes
- Migrations: `classlite-api/migrations/` (flat). Queries: `internal/store/queries/` → `sqlc generate` → `internal/store/generated/` (read-only). WF-3: touched `.sql` ⇒ `codegen.sh` is the last script run. WF-1 sequence: `api.yaml` → `codegen.sh` → handler → (7-4b) frontend.
- No cross-service imports (WF-7). Additive endpoints ⇒ may ship API-first (WF-4), but this is a split — 7-4b is the sole consumer, so no atomic cross-service PR needed (mirror 7-2a/7-3a).

### References
- Epic: [Source: _bmad-output/planning-artifacts/epics/epic-07.md#Story-7.4] (lines 156-221)
- FRs: [Source: _bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md] FR-38 (line 576), FR-39 (584), FR-40 (594); NFR-6 (1050)
- UX: [Source: _bmad-output/planning-artifacts/ux-design-specification.md] §6.3 anchored-work mechanic (365-374), s18 (482), s36 (498)
- Risk/gate: [Source: _bmad-output/test-artifacts/test-design/classlite_new-handoff.md] (54, 72); [test-design-progress.md] R26 (184), J8 (370-376)
- Component inventory: [Source: _bmad-output/planning-artifacts/component-inventory.md] (136-141, 269-274, 292-293, 327-328)
- Precedent stories: 7-2a (`student_service.go`, role-scope narg), 7-3a (`enrollment_service.go`/`enrollment_history` RLS + event seam), 5.2a (attempt-read gate)
- Rules: project-context.md — GO-1 (TenantContext), GO-2 (typed errors), GO-4 (ctx propagation), GO-5 (no omitempty), GO-7 (typed JSONB), GFW-5 (envelope), SEC-1 (DB role re-validate), SEC-6 (worker/async tenant ctx — n/a here, no worker), SEC-7 (tenant/class from server not body), SEC-9 (soft-delete + RLS — replies/questions are not soft-deleted in v1), PERF-1 (SET LOCAL in tx), PERF-2 (aggregate in SQL / RLS-filtered composite indexes), WF-1/WF-3 (codegen), TEST-BE-1..5

## Definition of Done
- All 16 ACs met; 8 tasks checked.
- **WF-8 hard gate discharged:** Task-2 reds were on the branch red before `in-progress`, then de-tagged green with `// GREEN SEAMS` headers.
- Adversarial proof green: Owner→0 / Admin→0 Q&A; Teacher own-classes-only; Student own-only; `shared` current-enrollment (transfer in/out) + other-class-0; `personal` asker+author-only + second-same-class-teacher-0; SEC-1 demoted-teacher rejected; cross-tenant RLS grid on both tables.
- `go build ./... && go vet ./...` clean; full `go test ./... -race -p 1` green **except** the pre-existing 3.1/2.3b spawn wall-clock date-bomb (every failure is a `Spawn*` test — excepted, untouched here).
- `scripts/codegen.sh` re-run; web `tsc -b` still 0 (additive, no consumer yet); no hand-edits to generated files.
- Migrations `up` + `down` both verified (down drops cleanly).
- Dev Agent Record + File List → sibling completion-notes.md (story file stays the spec, <600 lines — `bmad-story-conventions`).
- FU-7-4-A..D filed in `deferred-work.md`; epic-07 line-206 enum note corrected.

## Out of Scope
- **All frontend** (s18 teacher console, s36 student in-attempt sidebar, rail/pins/highlights, mobile chat-bubble) → **7-4b**.
- In-app **Inbox** action items → Epic 10 (FU-7-4-A). Teacher dashboard "Unanswered" rail → Epic 8 (FU-7-4-B).
- Reply **edit/delete** (FU-7-4-C), **reopen** resolved (FU-7-4-D), teacher **AI-suggest** reply (Epic 10 inbox).
- **@mention** and reply **attachments** (align with 7-2 deferrals; not in FR-38/39/40).
- Stable exercise item-IDs / 4.2 schema change (D2 accepts positional + excerpt instead).
- Anchoring outside an attempt (e.g. teacher-authored questions from the library) — students ask during attempts only (FR-38).

## Change Log
| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-10 | 0.1 | Story drafted — 7.4 split → 7-4a backend keystone. 4 Ducdo rulings (D1 split · D2 positional+excerpt anchor · D3 add class_id · D4 event-only notify) + D5 enum. 16 ACs / 8 tasks. WF-8 hard ATDD gate (R26=6). 3-agent parallel recon (backend/frontend/UX). | Amelia |
| 2026-09-10 | 1.0 | Implemented (in-progress → review). All 16 ACs / 8 tasks green. WF-8 gate discharged: 4 ATDD red files (18 tests) de-tagged green. FIND-1 ruled (student reply → 403 INSUFFICIENT_ROLE). 2 migrations + questions.sql + QuestionService + QuestionHandler (6 routes, open chain) + api.yaml paths/schemas + codegen. Added service + handler green tests. Gates: go build/vet clean, gofmt clean, full `go test ./... -race -p 1` green except the pre-existing 3.1/2.3b Spawn date-bomb (every failure a Spawn test), web `tsc -b`=0, migrations up+down verified. FU-7-4-A..D filed; epic-07 line-206 corrections queued. Dev record + File List → sibling completion-notes.md. | Amelia |
| 2026-09-10 | 1.1 | Code review (review → done). 3-layer adversarial review; 3 decisions (Ducdo D1/D2/D3), 8 patches applied, 1 defer (FU-7-4-E), 4 dismissed. D1: student → **404** (not 403) on resolve/batch (403 kept for reply only per FIND-1); split `authorizeTeacherOfQuestion` studentErr. D3: dropped dead `assignment.status` select. Patches: batch de-dupe `questionIds` (422), item-anchor index sanity (non-negative + charStart≤charEnd), list `status`/`unanswered` enum validation (422), `unmarshalAnchor` warn-not-silent, api.yaml `schemaVersion` readOnly, `content`/`anchorExcerpt` maxLength. D2 defer: AC9 classmate-visible shared-thread read → 7-4b (store query proven, endpoint deferred). codegen re-run; go build/vet/gofmt clean, Q&A suites `-race -p 1` green, web `tsc -b`=0. | Amelia |
