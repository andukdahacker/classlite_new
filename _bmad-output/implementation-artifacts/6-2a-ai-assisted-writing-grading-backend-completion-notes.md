# Story 6-2a: Completion Notes

_Implementation record for [`6-2a-ai-assisted-writing-grading-backend.md`](./6-2a-ai-assisted-writing-grading-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Harness `ProcessSpecific` does not persist `job.result`.** The S1 HappyPath scaffold read `jobs.result` after `h.ProcessSpecific(...)`, but the worker harness calls `handler.ProcessTask` (which discards the result fragment) and only writes `status` — it *cannot* persist the result because `generate()` is unexported (the harness is package `workers`, not `worker`). Fix: S1 drives through the dispatcher (`newGradeDispatcher(...).ProcessOnce`), whose `MarkJobComplete` persists the result — the realistic path anyway. S2/S3/S4/S16/S21 keep `ProcessSpecific` (they assert the handler error / side-effects, not the stored result).
- **`ForbiddenError` type mismatch in the enqueue scaffold.** The scaffold asserted `model.ForbiddenError` (value), but the reused 6.1 authz helpers (`revalidateStaffRole`/`assertTeacherOfSubmissionClass`) return `*service.ForbiddenError` (as 6.1's own tests assert). Reconciled the two enqueue negatives to `*service.ForbiddenError`.
- **`seedCompletedAIGradeJob` SQL bind bug.** The scaffold's `now() + ($5 || ' seconds')::interval` failed to bind a Go `int` into a text-typed param (OID 25). Switched to `now() + make_interval(secs => $5)`.
- **D8 terminal-reason carrier.** The 4.3a `terminalFail` writes a fixed `error_details` label (`model.JobErrorInvalidAIResponse`) for every `ErrInvalidAIResponse`, so `invalid_band_scores` and `invalid_ai_response` were indistinguishable. Added `worker.TerminalReasonError` (wraps `ErrInvalidAIResponse` so classification stays `errors.Is`-based) and taught `handleFailure` to read its `Reason` **after** classifying — no `strings.Contains`, backward-compatible for the ai_generate handlers (which don't use it → default label).
- **Enqueue-service signature.** The scaffold guessed `NewAIGradeService(db, audit, clock)`; the enqueue needs neither audit nor a clock, and `unused` (staticcheck U1000) flags stored-but-unused fields. Landed `NewAIGradeService(db)` and adjusted the sanctioned `enqueueAIGrade` reconciliation helper. `EnqueueAIGrade` returns `(jobID, existing, err)` so the handler maps fresh→202 vs existing→200 (D6/AC1); the enqueue-logic tests discard `existing`.

### Completion Notes

Shipped the full 6.2a backend keystone over the 4.3a spine with **one additive partial-index migration** and **no dispatcher/ledger infra change**:

- **Migration (D6):** `uq_jobs_ai_grade_inflight` partial unique index on `jobs((params->>'submissionId')) WHERE type='ai_grade_writing' AND status IN ('pending','processing')`. Up/down round-trips verified.
- **Worker (`ai_grade_writing.go`):** `GradeWritingHandler` on the existing dispatcher. Reads the essay via an RLS-scoped `GetSubmissionByID` on the job-row tenant (Gemini is never reached on a cross-tenant miss — R3); builds the IELTS rubric prompt; parses → `AIWritingGradeResponse`; **completeness** (nil band/confidence → terminal `invalid_ai_response`, D10) → **`grading.ValidateCriterionScores`** (out-of-range/off-grid → terminal `invalid_band_scores`, D8) → **`grading.NormalizeComments`** (orphan/surrogate-splitting anchors demoted to whole-essay, never dropped; a structural error → terminal `invalid_ai_response`). Writes ONLY `job.result` (`AIWritingGradeResult`) — no `grades` row, no `submissions` UPDATE (D1). `latencyMs` off the injected clock (D12, deterministic).
- **Enqueue (`ai_grade_service.go` + `ai_grade_handler.go`):** `EnqueueAIGrade` runs teacher-of-class + Writing + gradable guards BEFORE `InsertJob` (D9/SEC-1), then `InsertJob` + `InsertJobDeduction` in ONE tenant tx. A `23505` on the in-flight index rolls the whole tx back (deduct included — no second charge) and returns the existing job (D6). Route on the `aiChain` (keeps the AI rate limiter). No 402 balance gate (D4; 6.5).
- **Reads (D2/D11):** `TeacherGradingView.aiSuggestion` = latest `complete` `ai_grade_writing` result (`GetLatestCompleteAIGradeJobForSubmission`, `ORDER BY completed_at DESC, id DESC`, class-shared authz). Poll `GET /api/jobs/{jobId}` unchanged (creator-private). Student `/result` path untouched.
- **Contract (D11):** `api.yaml` adds the endpoint + `AIWritingGradeResult`/`AnchoredAISuggestion`/`AIWritingGradeCriteria` schemas; widens `Job.result` to `oneOf`; adds `aiSuggestion` to `TeacherGradingView`. The regenerated `client.ts` union is narrowed in the 4.3b poll consumer (`useAiGenerationJob` via the `sections` discriminant) — ci-web `tsc` clean (0 errors), 4.3b hook tests green.
- **Refund (D4/R23):** unchanged `terminalFail`→`RefundJob` fires for the new job type on all three terminal paths + stuck-sweep; idempotent on `(ref_job_id, reason)`; exactly-once across a 3-retry-then-terminal run (intra-retry ledger poll green).

**Deferrals** (see `deferred-work.md` → *dev of story 6-2a*): FU-6-2-A auto-run; the 6.2b hand-off surface; the essay-version fingerprint (only if resubmission-under-grade ever ships); the **S22** `oneOf` consumer-contract golden → `/bmad-tea TA 6-2a` (P2 tail, needs the generated TS union; the backward-compat narrow itself is shipped + ci-web `tsc` clean). **S17 anchor/criterion parity is shipped** as a Go unit test.

### Verification

- `go build ./...`, `go vet ./...` clean. `staticcheck` on all 6.2a packages: no findings (3 findings elsewhere are pre-existing, not 6.2a).
- `go test` green: `internal/worker` (incl. `-race`), `internal/service`, `internal/service/grading`, `internal/handler`, `internal/test` — no regressions.
- ATDD gate: all 19 red scaffolds turned green (skips removed per AC); S1 strengthened to a non-vacuous demotion/shape assertion.
- `migrate.sh` up/down round-trip; `codegen.sh` run last (sqlc + openapi-typescript clean); ci-web `tsc` 0 errors; 4.3b hook vitest green.

### Implementation Plan (as executed)

1. Task 0 — partial-index migration → `migrate.sh` (up/down verified).
2. Task 2 — two `jobs.sql` queries (`GetLatestComplete…`, `GetInflight…AIGradeJobForSubmission`).
3. Task 1 — `api.yaml` (endpoint + result schemas + `Job.result` oneOf + `TeacherGradingView.aiSuggestion`).
4. Task 3 — `codegen.sh` (sqlc + openapi-typescript); fixed the 4.3b poll consumer narrow (D11).
5. Task 4 — job type + params, `AIWritingGradeResponse`/`Result` models, essay-accessor relocation (`grading.EssayText`, D7), gemini mock modes + `WritingGradeFixtureEssay`.
6. Task 5 — `GradeWritingHandler` + `TerminalReasonError` (D8) in `dispatcher.go`; registered in `main.go`.
7. Task 6 — `AIGradeService.EnqueueAIGrade` (idempotency), `AIGradeHandler` + route on `aiChain`, grading-read `aiSuggestion`.
8. Task 7 — `SeedWritingSubmissionForTenant` fixture; removed skips; reconciled 3 scaffold guesses; full test + race + lint pass.
9. Task 8 — epic amendments, deferred-work FU, manual-setup note, this file.

## File List

### Added

- `classlite-api/migrations/20260819120000_add_ai_grade_inflight_unique_index.up.sql` / `.down.sql` — D6 partial in-flight unique index.
- `classlite-api/internal/worker/ai_grade_writing.go` — `GradeWritingHandler` + `TerminalReasonError`.
- `classlite-api/internal/service/ai_grade_service.go` — `AIGradeService.EnqueueAIGrade` (authz + one-tx deduct + idempotency).
- `classlite-api/internal/handler/ai_grade_handler.go` — enqueue endpoint (202 fresh / 200 existing).
- `classlite-api/internal/service/grading/essay.go` — relocated `grading.EssayText` (D7).
- `classlite-api/internal/test/story_6_2a_helpers.go` — `SeedWritingSubmissionForTenant` fixture.
- `classlite-api/internal/worker/ai_grade_writing_atdd_test.go`, `ai_grade_writing_refund_atdd_test.go`, `classlite-api/internal/test/ai_grade_enqueue_atdd_test.go` — ATDD scaffolds, turned green.
- `classlite-api/internal/worker/ai_grade_writing_parity_test.go` — S17 anchor/criterion parity unit test.

### Modified

- `classlite-api/api.yaml` — endpoint + `AIWritingGradeResult`/`AnchoredAISuggestion`/`AIWritingGradeCriteria`/`AIWritingGradeCriterion` schemas; `Job.result` oneOf; `TeacherGradingView.aiSuggestion`.
- `classlite-api/internal/store/queries/jobs.sql` — two RLS-scoped ai_grade queries (regenerated `store/generated/jobs.sql.go`).
- `classlite-api/internal/model/job_types.go` — `JobTypeAIGradeWriting`, `AIGradeWritingParams`, `JobErrorInvalidBandScores`.
- `classlite-api/internal/model/ai_response.go` — `AIWritingGradeResponse` (nullable pointers) + `AIWritingGradeResult` (value) + nested types + confidence consts.
- `classlite-api/internal/gemini/mock.go` — `MockValidWritingGrade`/`MockInvalidBandScores`/`MockIncompleteWritingGrade`/`MockTransientErrorContainingInvalid` + `WritingGradeFixtureEssay`.
- `classlite-api/internal/worker/dispatcher.go` — `handleFailure` reads `TerminalReasonError.Reason` for distinct `error_details` (D8).
- `classlite-api/internal/service/grading_service.go` — `TeacherGradingView.AiSuggestion` + `populateAISuggestion`; essay accessor now `grading.EssayText` (local `essayTextFromSubmission` removed, D7).
- `classlite-api/internal/handler/grading_handler.go` — `aiSuggestion` on the teacher grading-view response (GO-5 explicit null).
- `classlite-api/cmd/api/main.go` — register `GradeWritingHandler` on the dispatcher; wire `AIGradeService`/`AIGradeHandler` + route on the `aiChain`.
- `classlite-web/src/features/exercises/hooks/useAiGenerationJob.ts` — narrow the widened `Job.result` union back to `AIGenerationResult` (D11).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript).

### Deleted

- (none — `essayTextFromSubmission` was relocated into `grading.EssayText`, not deleted outright.)
