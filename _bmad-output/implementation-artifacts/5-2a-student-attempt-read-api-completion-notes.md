# Story 5.2a: Completion Notes

_Implementation record for [`5-2a-student-attempt-read-api.md`](./5-2a-student-attempt-read-api.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc + LEFT JOIN LATERAL nullability (the one real snag).** The `ListStudentAssignments` submission-summary join was authored as AC2 specifies — `LEFT JOIN LATERAL (… LIMIT 1)`. sqlc does **not** propagate a LATERAL's outer-join nullability: it typed the NOT NULL `submissions.status` source column as a non-nullable `string`, which would fail to scan the NULL for a not-started assignment. Tried three expression tricks to coax nullability back inside the LATERAL: a `CASE`-without-`ELSE` (→ `interface{}`, untyped), a `::text` cast (→ `string`, treated NOT NULL), and casting the CASE (→ `string`). All rejected. **Resolved** by switching to a plain `LEFT JOIN submissions … ON assignment_id AND student_id` — sqlc reliably types a plain LEFT JOIN's right-side columns nullable (`SubmissionID pgtype.UUID`, `SubmissionStatus pgtype.Text`). This is provably equivalent to `LATERAL … LIMIT 1` **because** `submissions` carries `UNIQUE(assignment_id, student_id)` — the (assignment, caller) predicate matches at most one row, so there is nothing for a `LIMIT 1` to trim and no row multiplication is possible. See the Deviations note below.
- No other snags. Every gate green first try after the join fix.

### Completion Notes

Shipped the two student-facing READ endpoints the attempt UIs (5.2b/5.3/5.4) consume, API-first (WF-1), zero schema change:

- `GET /api/assignments` — student enrollment-scoped assignment list (`StudentAssignmentListItem[]`, paginated), ordered `deadline_at ASC, id`. Non-student → 403 `INSUFFICIENT_ROLE`. Method+role-branched from `POST /api/assignments` create on the same path (D4).
- `GET /api/submissions/{id}/attempt` — the answer-stripped `AttemptBundle` `{submission, assignment, exercise}`. Owner+enrolled → 200; not-owner → 404 `SUBMISSION_NOT_FOUND` (no cross-student oracle); withdrawn mid-attempt → 403 `NOT_ENROLLED` (re-checked on read, D5); non-student → 403 `INSUFFICIENT_ROLE`; closed / past-hard-deadline still → 200 (D6, read NOT lock-gated).

**BLOCKING answer-strip (AC10-12) — DONE.** `AttemptExercise/AttemptSection/AttemptQuestionGroup/AttemptQuestion` are distinct Go + OpenAPI types that do **not** declare `correctAnswer`/`acceptedVariants` at all (D1, structural omission). The mapper `toAttemptExercise` (service/attempt_view.go) whitelists field-by-field and never references an answer field — a future field on `store.Question` is hidden by default. The raw-JSON golden test across all five group types is green, and its **teeth were proven by mutation**: temporarily leaking the answer in the mapper made `TestAttemptBundle_NeverLeaksAnswers_AllQuestionTypes` catch both the `correctAnswer` key and the sentinel value; reverted.

**No over-build (AC14):** no migration, no write path, no grading/result fields, **no new error codes** (reused `SUBMISSION_NOT_FOUND`/`NOT_ENROLLED`/`INSUFFICIENT_ROLE` from 5.1). `GET /api/exercises/{id}` and the teacher assignment endpoints are untouched — students still 403 there; this is a parallel answer-stripped surface, not a widening.

**Reuse (per the pre-flight):** the enrollment gate (`assertActiveEnrollment`), student role re-validation (`revalidateStudent`), tenant read-tx wrapper (`readInSubmissionTx`), pagination clamp (`normalizeAssignmentPaging` + int64 OFFSET clamp), envelope helpers (`WriteEnvelope`/`WriteEnvelopeWithMeta`/`PaginationMeta`), and the JSONB ladders (`store.UnmarshalExerciseContent`/`UnmarshalSubmissionContent`) were all reused verbatim — the only genuinely new logic is the answer-strip mapper + the enrollment-scoped list query.

### Deviations from spec (each pragmatic, each justified)

1. **AC2 `LEFT JOIN LATERAL … LIMIT 1` → plain `LEFT JOIN`.** Forced by a sqlc nullability limitation (see Debug Log); provably equivalent under `UNIQUE(assignment_id, student_id)`. Fully satisfies the AC's actual intent — a single join, no per-row `EXISTS`, no app-level N+1 (PERF-2). The DoD line "LATERAL submission summary (no N+1)" is met in substance (single join, no N+1); the join is plain-not-lateral. Flagged here for the reviewer per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`.
2. **File placement.** The two read methods are methods on `*SubmissionService` and `*SubmissionHandler` (as the story's Project Structure Notes specify — "methods on submission_service.go … handler methods on submission_handler.go") but physically live in new `attempt_service.go` / `attempt_handler.go` files so all 5.2a code is isolated and greppable. Behaviorally identical; keeps the two large 5.1 files unbloated.
3. **`GetExerciseForAttempt` added** (exercises.sql) — Task 2 sanctioned adding a query if none returns `content`+`schema_version`+`title`+`skill` for one exercise. `GetExerciseContentByID` lacks title/skill; `GetExerciseByID` filters `deleted_at`. New query has NO `deleted_at` filter (mirrors `GetExerciseContentByID`'s rationale — an in-flight attempt must still render its exercise). The list query likewise does not filter `deleted_at` (consistency), and the exercise always exists via the assignment FK.

### Implementation Plan (as executed)

1. `api.yaml` FIRST (WF-1): 2 read paths + `Attempt*`/`StudentAssignment*`/`AttemptBundle` schemas + 2 envelopes.
2. sqlc read queries: `ListStudentAssignments` + `CountStudentAssignments` (assignments.sql), `GetExerciseForAttempt` (exercises.sql).
3. `codegen.sh` (sqlc + openapi-typescript) → verified generated TS `AttemptQuestion` has **no** answer members (only `ExerciseQuestion` does).
4. Mapper unit test RED → `attempt_view.go` mapper GREEN (answer strip, ordering, prompt-only passthrough, nil→[] options).
5. Service read methods on `SubmissionService` (`attempt_service.go`).
6. Handler methods on `SubmissionHandler` + wire shapes (`attempt_handler.go`); 2 routes in `main.go`.
7. Full-stack ATDD (`attempt_read_test.go`) — 9 tests incl. the raw-JSON golden across all 5 types; mutation-proved the golden test's teeth.
8. Gates: gofmt / build / vet clean; `go test ./internal/... -race` green (no regressions); codegen re-run; `tsc --noEmit` (ci-web) exit 0.

## File List

### Added

- `classlite-api/internal/service/attempt_view.go` — answer-strip mapper + the `Attempt*` response types (SEC core, AC10-12).
- `classlite-api/internal/service/attempt_view_test.go` — mapper unit tests (strip / ordering / prompt-only passthrough / nil→[]).
- `classlite-api/internal/service/attempt_service.go` — `SubmissionService.GetAttemptBundle` + `.ListStudentAssignments` (read-only, AC1-13).
- `classlite-api/internal/handler/attempt_handler.go` — `SubmissionHandler.GetAttempt` + `.ListStudentAssignments` + wire shapes.
- `classlite-api/internal/test/story_5_2a_helpers.go` — `NewStudentAttemptTestServerBareMux` (2 read routes, real chain, no auth injection).
- `classlite-api/internal/test/attempt_read_test.go` — full-stack ATDD (golden no-leak + owner/enrollment/lock/list/cross-tenant).
- `_bmad-output/implementation-artifacts/5-2a-student-attempt-read-api-completion-notes.md` — this file.

### Modified

- `classlite-api/api.yaml` — `GET /api/assignments` + `GET /api/submissions/{id}/attempt` paths; `AttemptQuestion`/`AttemptQuestionGroup`/`AttemptSection`/`AttemptExercise`/`StudentAssignmentView`/`StudentAssignmentListItem`/`AttemptBundle` schemas; `EnvelopeAttemptBundle`/`EnvelopeStudentAssignmentList`.
- `classlite-api/internal/store/queries/assignments.sql` — `ListStudentAssignments` + `CountStudentAssignments` (read-only, no schema change).
- `classlite-api/internal/store/queries/exercises.sql` — `GetExerciseForAttempt`.
- `classlite-api/cmd/api/main.go` — wired the 2 read routes on the existing `assignmentChain`.
- `classlite-api/internal/store/generated/*.go` — sqlc regen (generated, do not hand-edit).
- `classlite-web/src/lib/api/client.ts` — openapi-typescript regen (generated).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-2a` → `review`.
- `_bmad-output/implementation-artifacts/5-2a-student-attempt-read-api.md` — task/subtask + DoD checkboxes, status, change log.

### Deleted

_(none — read-only story.)_
