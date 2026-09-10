# Story 7-4a: Completion Notes

_Implementation record for [`7-4a-anchored-qa-backend.md`](./7-4a-anchored-qa-backend.md). Status: review._

## Dev Agent Record

### Debug Log
- **`ReaderRole` came out `interface{}`.** sqlc could not infer the type of `sqlc.arg('reader_role')` from `= 'student'` comparisons alone. Assigning a Go `string` into `interface{}` compiles (so the reds still built), but the GREEN SEAMS pin `ReaderRole string` and an untyped param is fragile for pgx encoding. Fix: `sqlc.arg('reader_role')::text` on every occurrence → sqlc emits `string`. Re-ran `sqlc generate`.
- **`GetQuestionForReaderRow` ≠ `ListQuestionsForReaderRow`.** sqlc emits a distinct row type per query even when the column list matches; needed a separate `questionFromSingleReaderRow` converter for the single-thread read.
- **No new `error_mapper.go` arms required.** `QUESTION_NOT_FOUND` / `QUESTION_TARGET_NOT_FOUND` ride the existing legacy `model.NotFoundError{Code}` arm (Code is passthrough → 404 with the given code); the student-reply 403 rides the existing `service.ForbiddenError{Reason:"insufficient role"}` → `INSUFFICIENT_ROLE` arm. AC16's "register the codes" is satisfied by emitting the codes; no mapper edit needed.
- Full `go test ./... -race -p 1`: the ONLY failures are the pre-existing 3.1/2.3b **Spawn wall-clock date-bomb** (`classes[0].startDate must not be more than 30 days in the past` + the `TestClassService_Spawn_*` / `TestSpawn_*` cascade). Verified by re-running `internal/service` + `internal/handler` with `-skip 'Spawn'` → both green. Excepted per DoD, untouched here.

### Completion Notes
- **All 16 ACs met; all 8 tasks checked.** WF-8 hard gate discharged: the 4 ATDD red files (18 tests) were on the branch red before `in-progress`, then de-tagged green with `// GREEN` headers.
- **FIND-1 ruled by Ducdo (2026-09-10): student reply → 403 `INSUFFICIENT_ROLE`** (the asker can already GET their own thread, so a 404 would be dishonest). Owner/Admin/non-teaching-teacher stay 404 `QUESTION_NOT_FOUND` (non-disclosure). Implemented in `authorizeTeacherOfQuestion` (role-first: student→403, owner/admin→404, teacher→teach-check→404-or-pass).
- **Elision (R25/R26) is in the STORE query, inverted from 7-2a:** owner/admin match NOTHING (0 rows), NOT center-wide. Owner/Admin reach the handler (open chain, no `RequireRole`) and receive an empty `{data,meta}` envelope — proven through the full middleware stack in `question_handler_atdd_test.go`.
- **SEC-1:** every privilege decision (ask role, reply/resolve authz, read scope) keys off the DB-fetched `center_members.role` re-read inside the tenant tx (`beginQuestionTx`), never `tc.Role`. The SEC-1 red proves a demoted teacher (DB `student`, still `classes.teacher_id`) on a stale JWT is rejected with no mutation.
- **D2 anchor:** `QuestionAnchor` typed/versioned struct (GO-7); item anchors carry a group/question path OR a char span; `anchor_ref` NULL for `exercise` (coupling CHECK). `anchor_excerpt` snapshot is authoritative for display.
- **D3:** `class_id` + `exercise_id` derived server-side from `assignmentId` (SEC-7) — never trusted from the body. Ask gate = attempt-owner (`StudentOwnsAttempt`) + active enrollment; failure → 404 `QUESTION_TARGET_NOT_FOUND` (non-disclosure).
- **D4:** notify = event-only. `event.QuestionAsked` publishes post-commit, nil-tolerant, zero subscribers today; NO email. Payload `QuestionAskedPayload{QuestionID, StudentID, ClassID, ExerciseID}`.
- **Batch reply (AC12)** is all-or-nothing in one tx: any un-taught question in the list → whole request 404, zero writes (proven `TestQuestionBatchReply_AllOrNothing`). `maxBatchReply = 50`.
- **Deferrals filed** in `deferred-work.md`: FU-7-4-A (inbox→Epic 10), FU-7-4-B (dashboard rail→Epic 8), FU-7-4-C (reply edit/delete), FU-7-4-D (reopen). epic-07 line-206 enum (`private`→`personal`) + schema (`class_id`, positional anchor) corrections queued there for the next epic-07 edit.
- **PROVISIONAL read shapes** (Question/QuestionReply/QuestionThread in api.yaml) — marked, co-finalized by 7-4b (mirror 7-2a D14 / 7-3a). Mutation bodies stable.

### Implementation Plan (as executed)
1. **Task 1 — migrations:** `create_questions` + `create_question_replies`, standard mutable 4-policy FORCE-RLS grid (NOT append-only REVOKE). `migrate.sh up`; verified `down`→`up` reverses cleanly.
2. **Task 3 — queries:** `queries/questions.sql` (Create/Get/List/Count/Reply/Resolve + ask-path derivation), `sqlc generate`. Verified the store-level reds (F1 RLS grid, F2 role-scope, F3 visibility) green.
3. **Task 5 — service:** `question_service.go` (Ask/List/GetThread/Reply/Resolve/BatchReply + `publish` + typed anchor + SEC-1 `authorizeTeacherOfQuestion`). Verified the F4 authz reds green.
4. **Task 6 — handler + routes:** `question_handler.go` + 6 routes on the open chain in `main.go` (no `RequireRole`).
5. **Task 4 — codegen:** api.yaml `/api/questions*` paths + PROVISIONAL read schemas + stable mutation bodies; `scripts/codegen.sh` (sqlc + openapi-typescript). web `tsc -b` = 0.
6. **Task 2/7 — de-tag + green tests:** removed `//go:build atdd_red_phase` from the 4 red files (added `// GREEN` headers); added `question_service_test.go` (ask/anchor/batch/resolve-unanswered) + `question_handler_atdd_test.go` (envelope + elision + non-disclosure through the stack) + `story_7_4a_helpers.go`.
7. **Task 8 — deferrals + docs, this file.**

## File List

### Added
- `classlite-api/migrations/20260910120000_create_questions.up.sql` / `.down.sql`
- `classlite-api/migrations/20260910120100_create_question_replies.up.sql` / `.down.sql`
- `classlite-api/internal/store/queries/questions.sql`
- `classlite-api/internal/service/question_service.go`
- `classlite-api/internal/service/question_service_test.go`
- `classlite-api/internal/handler/question_handler.go`
- `classlite-api/internal/handler/question_handler_atdd_test.go`
- `classlite-api/internal/test/story_7_4a_helpers.go`
- `classlite-api/internal/store/generated/questions.sql.go` (generated — sqlc)

### Modified
- `classlite-api/api.yaml` — `/api/questions*` paths + Q&A schemas (read shapes PROVISIONAL, mutation bodies stable)
- `classlite-api/cmd/api/main.go` — 6 Q&A routes on the open questionChain (no RequireRole)
- `classlite-api/internal/store/generated/models.go` — generated `Question` + `QuestionReply` models (sqlc)
- `classlite-web/src/lib/api/client.ts` — generated TS types (openapi-typescript)
- `classlite-api/internal/test/questions_rls_atdd_test.go` — de-tagged (green)
- `classlite-api/internal/test/question_role_scope_atdd_test.go` — de-tagged (green)
- `classlite-api/internal/test/question_visibility_atdd_test.go` — de-tagged (green)
- `classlite-api/internal/service/question_authz_atdd_test.go` — de-tagged (green)
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-7-4-A..D + epic-07 corrections
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 7-4a ready-for-dev → in-progress → review
- `_bmad-output/implementation-artifacts/7-4a-anchored-qa-backend.md` — task checkboxes, Change Log, Status

### Deleted
- (none)
