---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate
lastStep: step-04-generate
lastSaved: '2026-09-10'
storyId: '7.4a'
storyKey: 7-4a-anchored-qa-backend
storyFile: _bmad-output/implementation-artifacts/7-4a-anchored-qa-backend.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-7-4a-anchored-qa-backend.md
detectedStack: backend
generationMode: ai-generation
generatedTestFiles:
  - classlite-api/internal/test/questions_rls_atdd_test.go
  - classlite-api/internal/test/question_role_scope_atdd_test.go
  - classlite-api/internal/test/question_visibility_atdd_test.go
  - classlite-api/internal/service/question_authz_atdd_test.go
inputDocuments:
  - _bmad-output/implementation-artifacts/7-4a-anchored-qa-backend.md
  - _bmad-output/planning-artifacts/epics/epic-07.md
  - _bmad-output/test-artifacts/test-design/classlite_new-handoff.md
  - _bmad-output/test-artifacts/test-design/test-design-progress.md
  - docs/project-context.md
  - classlite-api/internal/test/enrollment_history_rls_atdd_test.go
  - classlite-api/internal/test/student_roster_rls_atdd_test.go
  - classlite-api/internal/service/staff_service_atdd_test.go
  - knowledge/test-priorities-matrix.md
  - knowledge/test-levels-framework.md
---

# ATDD Checklist — Story 7-4a: Anchored Q&A Backend Keystone

**Author:** Murat (Test Architect) · **Date:** 2026-09-10 · **Stack:** backend (Go, real DB in tx under FORCE RLS) · **Mode:** AI-generation (no browser).

## Why this is a HARD gate (WF-8)

Epic-7 handoff carries **R25 + R26** (`classlite_new-handoff.md:54`); the Epic-7 gate criterion is *"Q&A role-scope negative test (Owner/Admin see zero) green"* (`:72`). **R26 = score 6** (role-scope leak, `test-design-progress.md:184`), journey **E2E-J8-001/002/003 P0** (`:374-376`). Per WF-8, red-phase acceptance tests MUST be on the branch **before 7-4a moves to `in-progress`**, de-tagged per-file at green.

## RED convention (per `reference_atdd_red_convention`)

- BE red = **`//go:build atdd_red_phase`** first line → quarantined from the default build; compile-fails ONLY on the greenfield seams (documented in each file's `GREEN SEAMS` header). **Verify red with `go vet` (not `go build` — build skips `_test.go`):** `go vet -tags atdd_red_phase ./internal/test/... ./internal/service/...`.

**VERIFIED RED (2026-09-10):** `go build ./...` clean (default build excludes the tagged files). Under `-tags atdd_red_phase`, compilation fails on exactly and only: `generated.ListQuestionsForReader{,Params,Row}`, `generated.CountQuestionsForReader{,Params}`, `generated.ListRepliesForReader{,Params,Row}`, `service.QuestionService` / `NewQuestionService` / `ReplyInput`. No unrelated errors. All 4 files gofmt-clean. **18 red tests** (F1=7, F2=4, F3=2, F4=5).
- All local seed helpers are **`qa`-prefixed** — the 7.1a/7.2a/7.3a reds are DE-TAGGED now and own `pgUUID`/`seedActiveEnrollment`/etc. in the default `test` build; a tagged file compiles alongside them, so unprefixed names would collide.
- Mock seams honored: **none** — store-layer + service-direct integration on a real DB in a rolled-back tx (TEST-BE-1/2/4). Never `DISABLE ROW LEVEL SECURITY`. `SetupDB(t)` sets `SET LOCAL ROLE classlite_app` so FORCE RLS is enforced.
- **Murat house rule** (from `student_roster_rls_atdd_test.go:5-7`): a reader seeing *zero* rows is only proof when another reader genuinely CAN see the row — every scope-negative seeds a **positive control**.

## Generated red files → AC / risk map

| # | File | ACs | Risk | Level | P |
|---|------|-----|------|-------|---|
| F1 | `internal/test/questions_rls_atdd_test.go` | AC1, AC2, AC15 | R1–R3 tenant isolation | store / raw-SQL RLS | P0 |
| F2 | `internal/test/question_role_scope_atdd_test.go` | AC6, AC7 | **R25/R26** | store query (`ListQuestionsForReader`) | P0 |
| F3 | `internal/test/question_visibility_atdd_test.go` | AC9, AC10 | **R25** | store query (`ListRepliesForReader`) | P0 |
| F4 | `internal/service/question_authz_atdd_test.go` | AC8, AC11, AC13 | **R15-style SEC-1** + FR-46 authz | service-direct | P0 |

## Green-phase SEAMS the dev (Amelia) must build to turn these green

**Migrations (Task 1):** `questions` + `question_replies` tables, standard **mutable** 4-policy FORCE-RLS grid (NOT the append-only REVOKE lock — Q&A `status` transitions). Column lists are pinned in F1's `qaInsertQuestion`/`qaInsertReply` raw inserts — the migration must match them.

**Store queries (Task 3, `queries/questions.sql` → sqlc):**
- `ListQuestionsForReader(ctx, ListQuestionsForReaderParams{CenterID, ReaderID, ReaderRole, ExerciseID(narg), ClassID(narg), Status(narg), Unanswered(narg), Limit, Offset}) → []ListQuestionsForReaderRow` — scope encoded in SQL: student ⇒ `q.student_id = ReaderID`; teacher ⇒ `q.class_id IN (SELECT id FROM classes WHERE teacher_id = ReaderID)`; **owner/admin ⇒ matches NOTHING** (0 rows). Row exposes at least `QuestionID, ExerciseID, ClassID, StudentID, AnchorType, AnchorRef, AnchorExcerpt, Content, Status, CreatedAt`.
- `CountQuestionsForReader(...) → int64` (F1 compile anchor + `meta.total` under the same scope).
- `ListRepliesForReader(ctx, ListRepliesForReaderParams{CenterID, QuestionID, ReaderID, ReaderRole}) → []ListRepliesForReaderRow` — per-reply visibility: `shared` ⇒ visible to a teacher of the class, the asker, or a student with an **active** enrollment in `q.class_id`; `personal` ⇒ visible only to the asker (`q.student_id`) or the reply `author_id`; owner/admin ⇒ never.

**Service (Task 5, `question_service.go`):**
- `NewQuestionService(db AuthDB, clk clock.Clock, events *event.Bus) *QuestionService` (nil-tolerant `events`; no `emailQueue` — D4 event-only).
- `(*QuestionService).Reply(ctx, tc model.TenantContext, questionID uuid.UUID, in ReplyInput) (*QuestionReply, error)` — `ReplyInput{Content string, Visibility string, Resolve bool}`. Teacher-of-the-question's-class gate re-validated from **DB `center_members.role`** (SEC-1, NOT `tc.Role`). Owner/Admin/non-teaching-teacher ⇒ `*model.NotFoundError` code `QUESTION_NOT_FOUND` (non-disclosure). `Resolve=true` flips `status open→resolved` in the same tx.
- `(*QuestionService).Resolve(ctx, tc, questionID uuid.UUID) error` — same authz; one-way `open→resolved`.
- New typed errors + `error_mapper.go` arms: `QUESTION_NOT_FOUND`, `QUESTION_TARGET_NOT_FOUND`.

## De-tag protocol (at green)

Remove the `//go:build atdd_red_phase` line from each file, add a `// GREEN SEAMS (…)` header naming the migration DDL + store/service signatures actually shipped, and fold each file into the permanent suite. Run `go test ./... -race -p 1` (excepting the pre-existing 3.1/2.3b spawn wall-clock date-bomb).

## ATDD findings for Ducdo (fold into a D-decision at green)

- **FIND-1 (student reply status code).** AC8 as written says a Student replying → **404 `QUESTION_NOT_FOUND`**, but the *asking* student can already see their own thread (GET), so a 404 on the reply verb is arguably dishonest — **403 `INSUFFICIENT_ROLE`** is the alternative. F4 asserts the student reply is *rejected as an authz failure* (accepts either 403 or 404) rather than pinning the code, so the dev is free to implement either after a Ducdo ruling. Owner/Admin/non-teaching-teacher → 404 is unambiguous and IS pinned. **Decide the student code at green.**

## Deferred to TA (post-dev `/bmad-tea TA`) — NOT gate-blocking

- **Ask-path authz** (AC4/AC5): non-student → 403, non-owner/not-enrolled → 404, anchor validation (item requires ref, exercise forbids ref). Needs the assignment→submission ownership+enrollment chain; add as green-phase service/handler tests.
- **Batch reply** all-or-nothing atomicity (AC12), resolve-drops-from-unanswered-count (AC11 filter), event publish shape (AC14), handler envelope/pagination (AC16). P1/P2 — automate post-dev.
