---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-19'
storyId: '6.2a'
storyKey: '6-2a-ai-assisted-writing-grading-backend'
storyFile: '_bmad-output/implementation-artifacts/6-2a-ai-assisted-writing-grading-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-2a-ai-assisted-writing-grading-backend.md'
generatedTestFiles:
  - 'classlite-api/internal/worker/ai_grade_writing_atdd_test.go'
  - 'classlite-api/internal/worker/ai_grade_writing_refund_atdd_test.go'
  - 'classlite-api/internal/test/ai_grade_enqueue_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/6-2a-ai-assisted-writing-grading-backend.md'
  - 'docs/project-context.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'classlite-api/internal/test/workers/harness.go'
  - 'classlite-api/internal/worker/ai_generate_atdd_test.go'
  - 'classlite-api/internal/worker/credit_refund_atdd_test.go'
  - 'classlite-api/internal/worker/secret_logging_atdd_test.go'
  - 'classlite-api/internal/gemini/mock.go'
  - '_bmad/tea/config.yaml'
---

# ATDD Red-Phase Checklist — Story 6.2a (AI-Assisted Writing Grading — Backend)

## Step 1 — Preflight & Context

### Stack & framework
- **detected_stack:** `backend` (story scope). Repo is fullstack; 6.2a is pure Go (`classlite-api`). All scaffolds are `*_test.go`.
- **Framework:** Go `testing` + real-DB transaction harness (`internal/test`), worker harness (`internal/test/workers/harness.go`). ✅ present.
- **TEA config flags:** `tea_use_playwright_utils: true` (N/A — backend), `tea_use_pactjs_utils: false`, `tea_pact_mcp: none`, `test_stack_type: auto`, `risk_threshold: p1`.

### Prerequisites — all met
- ✅ Story approved with clear AC (A–E, AC1–12; DoD explicit).
- ✅ Backend test config exists (`*_test.go`, `internal/test`, worker harness).
- ✅ Dev environment available (docker-compose Postgres for the tx-wrapped DB).
- ⚠️ **Implementation NOT present** — this is the correct pre-dev state. This run produces RED scaffolds; dev turns them green. (Confirmed: no `ai_grade_writing.go`, no migration, no job type, no enqueue endpoint.)

### Risk posture (why ATDD is mandatory here)
- **risk_score: 9.** Governing risk **R3** (worker forgets `SET LOCAL` → async cross-tenant essay leak, L×I=9). Also in scope: **R23** (refund idempotency, 6), **R16** (submission immutability, 6).
- **WF-8 HARD RULE:** ATDD red tests (submission-scoped cross-tenant read + refund idempotency) MUST be on the branch before this story goes `in-progress`. This checklist is that gate.

### Reuse anchors located (scaffolds mirror these verbatim)
| Concern | Template / seam | Path |
|---|---|---|
| 3-pattern worker harness | `SetupWorkerHarness`, `ProcessSpecific`, `ProcessWithoutTenantContext`, `JobStatus` | `internal/test/workers/harness.go` |
| Worker RLS adversarial grid + `CallCount()==0` tripwire | `TestGenerate*_{HappyPath,PayloadCenterIdIgnored,NullTenantContextRejected}` | `internal/worker/ai_generate_atdd_test.go` |
| Refund matrix + intra-run ledger poll helpers | `ledgerSum`, `countRefunds`, `enqueueDeductedJob`, `newDispatcherForTest` | `internal/worker/credit_refund_atdd_test.go` |
| Double-refund SQL seam | `TestAICreditLedger_DoubleRefundIsNoOp` | `internal/test/ai_credit_ledger_rls_atdd_test.go` |
| Secret/prompt/response never logged (R49) | `TestSecretsAndPrompt_NeverLogged` | `internal/worker/secret_logging_atdd_test.go` |
| Deterministic Gemini mock (to extend: `valid_writing_grade`, `invalid_band_scores`) | `NewMockClient`, `MockConfig`, `CallCount()` | `internal/gemini/mock.go` |

### DI-seam red convention (confirmed from templates)
Red phase compiles against **not-yet-existing** constructors, isolated in `new*Handler` helpers so dev has one place to reconcile signatures:
- `worker.NewGradeWritingHandler(h.DB, mock, h.Clock)` — does not exist yet → **compile-fail = red**.
- `service.EnqueueAIGrade(...)`, `gemini.MockValidWritingGrade`/`MockInvalidBandScores`, `model.JobTypeAIGradeWriting`, `model.AIGradeWritingParams`, `model.AIWritingGradeResponse`/`Result` — all land in green phase.

### Confirmed inputs — proceeding to generation
Story, framework, harness/templates, mock, and risk register all loaded. Next: map AC11/AC12 (the risk≥6 red-first set) to concrete red scaffolds.

## Step 2 — Generation Mode

- **Mode: AI Generation** (mandatory for `backend` per step rule). Scaffolds generated from AC + `api.yaml` intent + the Go source templates loaded in Step 1.
- **Recording:** N/A (no browser surface in 6.2a; all frontend is 6.2b).
- **Seam strategy:** DI-seam red — reference not-yet-existing constructors so the package fails to compile until dev lands them; assertions encode the AC intent so green requires the *correct* behavior, not just a stub.

## Step 3 — Test Strategy (AC → scenario → level → priority)

### Level choice (backend; no E2E)
- **Unit (pure fn):** `NormalizeComments` demotion; anchor/criterion parity; failure classifier (`errors.Is` vs `strings.Contains`).
- **Worker integration** (worker harness + mock Gemini + real-DB tx): the R3 grid, R3-submission spy, zero-writes, taxonomy end-to-end, secret-logging.
- **Dispatcher integration** (real-DB tx): refund matrix, intra-retry ledger poll, double-refund race.
- **SQL seam** (real DB): double-refund no-op at the `(ref_job_id, reason)` constraint.
- **Service integration** (real-DB tx): enqueue single-tx rollback, idempotency (`23505`), authz negatives, writing/gradable guards, grading-read `aiSuggestion`.
- **Handler integration** (real middleware, `httptest`): 202 envelope, route on `aiChain`, authz 403 mapping, poll creator-private.
- **Contract/golden** (TS vitest + Go golden emitter): `Job.result` oneOf backward-compat.

> **Anti-duplication (meta-rule):** authz *logic* is proved once at the **service** level; the **handler** test asserts only HTTP status/envelope mapping. RLS tenant isolation is proved at **worker/store**; handlers don't re-prove it. Pure demotion/parity live at **unit**, not re-asserted inside the worker happy-path.

### Scenario map (★ = red-first mandatory, risk ≥6 → WF-8 gate)

| ID | AC | Scenario | Level | Pri | Red mechanism |
|---|---|---|---|---|---|
| **R3 async cross-tenant leak (score 9) — the headline gate** |
| S1 ★ | 11 | `TestGradeWriting_HappyPath` — `ProcessSpecific` → `job.result` validated bands + demoted orphan comment; `CallCount()==1` | Worker-int | P0 | refs `worker.NewGradeWritingHandler` (absent → compile-fail) |
| S2 ★ | 11 | `TestGradeWriting_PayloadCenterIdIgnored` — job row=A, payload `centerId`=B → essay read under A → `NotFoundError`; `CallCount()==0` | Worker-int | P0 | assert `errors.As(NotFoundError)` + Gemini never reached |
| S3 ★ | 11 | `TestGradeWriting_NullTenantContextRejected` — `ProcessWithoutTenantContext` → every DB read 0 rows → error; `CallCount()==0` | Worker-int | P0 | `ProcessWithoutTenantContext` template |
| S4 ★ | 12 | `TestGradeWriting_SubmissionCrossTenant_GeminiNeverInvoked` — seed submission S under B; job ROW=A refs S → essay fetch 0 rows → terminal/NotFound, **`CallCount()==0`**, **no result written** (the generic grid tests a *job* read; this tests a *submission* read — the R3=9 headline miss) | Worker-int | P0 | new `testpkg.SeedWritingSubmission`; assert result NULL + spy 0 |
| **R23 refund idempotency (score 6)** |
| S5 ★ | 8/12 | `TestGradeWriting_RetryRefundExactlyOnce` — transient ×3 then exhaust; **intra-retry poll: after attempt 1 → exactly 1 ledger row (the −1 deduct only)**; at end exactly 2 rows (−1 + one +1 `job_failed_refund`) | Dispatcher-int | P0 | `ledgerSum`/`countRefunds` mid-run; catches "refunds every attempt, constraint hides it" |
| S6 ★ | 7 | Refund fires on **all three** terminal paths: `invalid_band_scores`, `invalid_ai_response`, `max_retries_exhausted` (+ `SweepStuckJobs` stuck→refund) | Dispatcher-int | P1 | mirror `credit_refund_atdd_test.go` matrix, new job type |
| S7 | 8 | `DoubleRefundIsNoOp` — worker+sweep race → exactly 1 refund row | SQL-seam + Disp-int | P1 | mirror `TestAICreditLedger_DoubleRefundIsNoOp` |
| **Enqueue + credit (the money bug — D6)** |
| S8 ★ | 1/12 | `TestEnqueueAIGrade_Idempotent_NoSecondDeduct` — 2nd in-flight enqueue → `23505` on `uq_jobs_ai_grade_inflight` → tx rollback → **returns existing job, ZERO 2nd deduct**; re-run after complete allowed | Service-int | P0 | refs `service.EnqueueAIGrade`; assert 1 job + 1 deduct row |
| S9 ★ | 1/12 | `TestEnqueueAIGrade_SingleTxRollback` — forced failure between `InsertJob` and `InsertJobDeduction` → **no job AND no ledger row** | Service-int | P0 | assert both tables empty |
| S10 | 1 | Authz negatives: teacher-of-other-class → `403 FORBIDDEN`; non-staff → `403 INSUFFICIENT_ROLE`; enforced in service **before** `InsertJob` (D9/SEC-1) | Service-int | P1 | `gradingEnv` otherTeacherTC/studentTC template |
| S11 | 1 | Guards: non-writing exercise → `409 SUBMISSION_NOT_WRITING`; non-gradable status → `409 SUBMISSION_NOT_GRADABLE` | Service-int | P1 | `assertWritingExercise` seam |
| S12 | 1 | Endpoint shape: `POST …/ai-grade` on `aiChain` → **202** `{data:{jobId},meta}`; `centerId` never read from body (SEC-7) | Handler-int | P2 | mirror `ai_generation_handler_atdd_test.go` |
| **Worker correctness — validation / completeness / normalization (D5/D8/D10)** |
| S13 ★ | 5/12 | Failure taxonomy table (type-based): `{invalid_band_scores→terminal+refund, invalid_ai_response(malformed)→terminal+refund, invalid_ai_response(incomplete)→terminal+refund, transient→reschedule+0 refunds, max_retries→terminal+refund}` **+ adversarial row: transient error whose text contains "invalid" → reschedules** (proves `errors.Is`, not `strings.Contains`) | Worker/Unit | P1 | table-driven; classifier unit + worker-int |
| S14 ★ | 5/10 | Completeness → terminal: missing criterion key / null `band`\|`confidence` / comment missing `type`\|`criterion`\|`text` → `invalid_ai_response`; seam invariant "complete ⇒ gradeable" | Worker-int | P1 | incomplete mock fixture |
| S15 | 5 | `NormalizeComments` demotion: multibyte fixture (emoji+accent), offsets **relative to `len(fixtureEssay)`** — orphan at `len+5` → whole-essay (null/null); surrogate-splitting anchor → demoted, never dropped | Unit | P1 | pure fn, UTF-16 round-trip |
| S16 ★ | 12/6 | Zero-writes immutability (R16=6): after a **successful** job, read back submission row + `grades` → **byte-identical / absent** (positive proof worker wrote neither — D1) | Worker-int | P1 | pre/post snapshot |
| S17 | 12 | Anchor/criterion parity fixture: AI comment == exact 6.1 `AnchoredComment` shape the grade write consumes (`grammaticalRange`, lowercase types, UTF-16 offsets) | Unit | P2 | golden fixture pin |
| **Reads + contract (D2/D9/D11)** |
| S18 | 10 | Grading-read `aiSuggestion` = latest **complete** job (`completed_at DESC, id DESC`), class-authz'd (co-teacher sees it), `null` when none | Service-int | P1 | new sqlc query seam |
| S19 | 10 | `aiSuggestion` **absent from the student `/result` path** (`StudentGradeView` untouched) — negative assertion | Service-int | P1 | assert field absent for studentTC |
| S20 | 9 | Poll `GET /api/jobs/{jobId}` creator-private: non-creator (co-teacher/student) → 404, no oracle | Handler-int | P2 | reuse `GetJobByID` creator scope |
| S21 ★ | 12/11 | Secret/prompt/response never logged (R49) for `ai_grade_writing` (essay text is PII) | Worker-int | P1 | mirror `secret_logging_atdd_test.go` |
| S22 | 12 | `Job.result` oneOf widening backward-compatible: golden `ai_grade_writing` fixture through 4.3b's `GET /api/jobs/{jobId}` poll parser → no throw, unknown-type → safe default | Contract/golden | P2 | TS vitest red + Go golden emitter |

### Green-phase fixture/DI dependencies (dev reconciles in one place)
- **NEW** `testpkg.SeedWritingSubmission(t, db, tenantID, assignmentID, studentID, status, essay) uuid.UUID` — promote 6.1's local `insertWritingSubmission` to exported testpkg so `worker_test` (S4/S16) and `test` (S18/S19) both use it.
- `worker.NewGradeWritingHandler(db, gem, clk)` — constructor (mirror `grade_release.go` DB-reading handler).
- `service.EnqueueAIGrade(ctx, tc, submissionID) (jobID, error)`.
- `gemini` mock modes: `MockValidWritingGrade` (in-range, one orphan comment at `len(essay)+5`, one emoji-straddling), `MockInvalidBandScores` (band 9.5), `MockIncompleteWritingGrade` (missing criterion) + reuse `MockMalformed`/`MockTransientError`.
- `model.JobTypeAIGradeWriting`, `model.AIGradeWritingParams{SubmissionID}`, `model.AIWritingGradeResponse`/`AIWritingGradeResult`.

### Red-phase guarantee
Every scenario above fails **before** implementation — either by **compile-fail** (references to absent constructors/types/mock modes) or by **assertion-fail** against behavior that does not yet exist. No scaffold can pass against an empty/stub implementation.

### Scope of THIS run vs. later stages
- **This ATDD run generates:** all ★ (P0 + risk≥6 P1) + the P1 correctness set (S6, S10, S11, S13–S16, S18, S19, S21). That is the WF-8 gate.
- **Green-phase dev-inline:** S12, S17, S20 (P2 shape/parity/oracle) may be added by dev alongside implementation.
- **Post-dev TA (`/bmad-tea TA`):** S22 oneOf consumer-contract full matrix, broader fault-injection, and any P3 tail.

## Step 4 — Generated Red-Phase Scaffolds

**Execution:** sequential, single-author (deviation from generic subagent fan-out — justified: interdependent Go scaffolds must mirror exact loaded templates; fidelity > parallelism for a risk-9 gate). No E2E worker (no browser surface).

**Red mechanism (two-phase):** references to absent DI seams → the package FAILS TO COMPILE now (loud red gate on the branch); once dev lands the seams it compiles and each test halts at `t.Skip("RED (6-2a): …")` (visibly pending, never false-green); dev removes each skip per-AC as it goes green.

### Files written (3)
| File | Package | Scenarios |
|---|---|---|
| `internal/worker/ai_grade_writing_atdd_test.go` | `worker_test` | S1 HappyPath, S2 PayloadCenterIdIgnored, S3 NullTenantContext, **S4 SubmissionCrossTenant+Gemini-never-invoked**, S14 Incomplete→terminal, S16 Zero-writes immutability, S21 Secret/essay never logged |
| `internal/worker/ai_grade_writing_refund_atdd_test.go` | `worker_test` | S6a invalid_band_scores, S6b malformed, S6c max-retries, **S5 refund-exactly-once intra-retry poll**, S6-neg no-refund-on-complete, S7 double-refund-no-op, **S13 transient-containing-"invalid"→reschedules (errors.Is not strings.Contains)** |
| `internal/test/ai_grade_enqueue_atdd_test.go` | `test` | **S8 idempotency no-2nd-deduct**, S9 forbidden→no-partial-write, S10 student-forbidden, S18 grading-read latest-suggestion, S19 student-path-never-leaks |

### Compile-verification (red-for-the-right-reason) ✅
`go vet` confirms every compile error resolves to an **intended 6-2a seam**, none to a mistyped existing symbol:
- `worker.NewGradeWritingHandler` (undefined) — intended
- `service.NewAIGradeService` (undefined) — intended
- `service.TeacherGradingView` has no field `AiSuggestion` — intended
- (plus, halted behind these: `model.JobTypeAIGradeWriting`, `model.AIGradeWritingParams`, `model.AIWritingGradeResult`, `gemini.MockValidWritingGrade`/`MockInvalidBandScores`/`MockIncompleteWritingGrade`/`MockTransientErrorContainingInvalid`, `testpkg.SeedWritingSubmissionForTenant`, `(*AIGradeService).EnqueueAIGrade`)

Existing-symbol references validated against source: `GetSubmissionForGrading`→`TeacherGradingView`, `GetStudentSubmissionReview`, `SeedDeductedAIJob`, `NewDispatcher`/`ProcessOnce`/`SweepStuckJobs`, `ledgerSum`/`countRefunds` (reused from `credit_refund_atdd_test.go`), `jobs`/`grades` columns (seed INSERT green-phase-valid; `created_by` nullable ⇒ grading-read is correctly class-shared, not creator-scoped).

### Deliberately NOT auto-generated (P2 tail) — flagged for a ruling
AC12 marks these "red-first mandatory", but authoring them faithfully **now** is blocked by ordering, so I did not guess:
- **S22 oneOf consumer-contract** — a **TS/vitest** test through 4.3b's `client.ts` poll parser. The union type does not exist until `api.yaml` widens `Job.result` + `codegen.sh` runs (Tasks 1–3). Writing it against guessed types would pin the wrong contract.
- **S17 anchor/criterion parity** — pins the AI comment to the 6.1 `grading.Comment` shape; best written against the generated `AIWritingGradeResult` type (post-codegen), not guessed field names.
- **S12 endpoint 202-on-`aiChain`** and **S20 poll creator-private** — need a `test.NewAIGradeTestServerBareMux` server-wiring seam not yet recon'd; the enqueue *logic* (authz/tx/idempotency) is already proven at the service level (S8–S10), so the handler test's marginal value is HTTP-shape only.

**Recommendation (pragmatic, per project-context spec-absolute guidance):** author S17/S22 **immediately after Task 3 (codegen), before Task 5 (worker)** — still red-first relative to implementation, but against real generated types. S12/S20 as green-phase dev-inline. This keeps AC12's intent (red before the behavior exists) without pinning a guessed contract. Ducdo to ratify or override.

## Step 4C — Aggregation & Red-Phase Compliance

- **Total red tests:** 19 across 3 files, 100% guarded with `t.Skip("RED (6-2a…")`.
- **Red compliance:** ✅ all assert real behavior (no `assert(true)` placeholders); expected-to-fail confirmed two ways — compile-fail now (undefined seams), assert/skip after seams land.
- **Coverage vs risk register:** R3 (9) — S1–S4 (incl. the submission-read spy the generic harness misses) ✅; R23 (6) — S5–S7 refund idempotency incl. intra-retry poll ✅; R16 (6) — S16 zero-writes ✅; D6 money-bug — S8 idempotency ✅; D8 classification — S13 adversarial ✅; D2/D9 read separation — S18/S19 ✅; R49 — S21 ✅.
- **AC coverage:** AC1, AC5, AC6, AC7, AC8, AC10, AC11, AC12 (worker + refund + enqueue + reads). AC2 (no-balance-gate) implicitly covered by S8/S9 ledger asserts. AC3/AC4/AC9 (handler wiring, Gemini prompt build, poll-unchanged) land green-phase; AC9 poll-creator-private is S20 (deferred).
- **Story linked:** `### ATDD Artifacts` added under Dev Notes in the story file.
- **Fixtures/seams for green phase:** enumerated in each test-file header + the story link (single reconciliation points).
- **Execution:** SEQUENTIAL single-author, baseline (no parallel speedup) — deliberate for fidelity.

## Step 5 — Validation & Completion

**Validation checklist:** ✅ prerequisites satisfied · ✅ 3 test files created + compile-verified red-for-right-reason · ✅ checklist maps all in-scope ACs · ✅ 19/19 tests carry `t.Skip("RED …")` guards, real assertions · ✅ story metadata + handoff paths captured, `### ATDD Artifacts` linked into the story · N/A CLI/browser sessions (backend) · ✅ artifacts in `test_artifacts/`.

### Handoff
- **Story:** `6.2a` · key `6-2a-ai-assisted-writing-grading-backend` · file `_bmad-output/implementation-artifacts/6-2a-ai-assisted-writing-grading-backend.md`
- **Checklist:** this file.
- **Gate status:** WF-8 ATDD red gate **SATISFIED for the risk≥6 set** — the story may transition `ready-for-dev → in-progress`. (Contingency: author the two deferred red contract pins S17/S22 right after Task 3 codegen.)

### Key risks / assumptions
1. Green phase must land the DI seams **exactly** as headed in each file — especially `testpkg.SeedWritingSubmissionForTenant` (new exported fixture; promote 6.1's `insertWritingSubmission` chain) and the `gemini` mock modes with `CallCount()`.
2. `MockValidWritingGrade` MUST emit one orphan comment at `len(essay)+5` and one emoji-straddling comment, or S1/S16 demotion assertions go vacuously green.
3. `S13` requires `MockTransientErrorContainingInvalid` (transient error whose text contains "invalid") — the only way to prove `errors.Is`-not-`strings.Contains` classification.
4. Refund tests assume the dispatcher's existing `terminalFail`→`RefundJob` fires for the new job type with no new wiring (D4/D12); if `terminalFail` writes only the sentinel to `error_details`, dev adds a `reason` param (D8) — the S6 error_details assertions depend on it.

### Next recommended workflow
- **`/bmad-dev-story 6-2a`** (Amelia) — turn the red gate green (Tasks 0–8), removing each `t.Skip` per AC.
- **Then `/bmad-tea TA 6-2a`** (this was your original ask) — expand the P2/P3 tail (S12/S17/S20/S22 full matrix, broader fault-injection) once implementation exists.
- **Then `/bmad-tea RV`** — flake/quality review of the green suite.
