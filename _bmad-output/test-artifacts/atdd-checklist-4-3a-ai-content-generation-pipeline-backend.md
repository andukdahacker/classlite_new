---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-28'
generationMode: 'ai-generation'
executionMode: 'sequential'
tddPhase: 'RED'
redPhaseTag: 'atdd_red'
generatedTestFiles:
  - 'classlite-api/internal/worker/ai_generate_atdd_test.go'
  - 'classlite-api/internal/worker/credit_refund_atdd_test.go'
  - 'classlite-api/internal/worker/secret_logging_atdd_test.go'
  - 'classlite-api/internal/handler/ai_generation_handler_atdd_test.go'
  - 'classlite-api/internal/test/jobs_rls_atdd_test.go'
  - 'classlite-api/internal/test/ai_credit_ledger_rls_atdd_test.go'
placeholderPackageStubs:
  - 'classlite-api/internal/worker/doc.go'
  - 'classlite-api/internal/gemini/doc.go'
storyId: '4.3a'
storyKey: '4-3a-ai-content-generation-pipeline-backend'
storyFile: '_bmad-output/implementation-artifacts/4-3a-ai-content-generation-pipeline-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-4-3a-ai-content-generation-pipeline-backend.md'
generatedTestFiles: []
detectedStack: 'backend'
redPhaseGate: 'go build tag //go:build atdd_red'
inputDocuments:
  - '_bmad-output/implementation-artifacts/4-3a-ai-content-generation-pipeline-backend.md'
  - '_bmad-output/test-artifacts/test-design/blocker-resolutions-2026-06-04.md'
  - 'classlite-api/internal/test/workers/harness.go'
  - 'classlite-api/internal/test/workers/harness_test.go'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go'
  - 'classlite-api/internal/test/exercises_rls_test.go'
  - 'classlite-api/internal/test/story_4_1_helpers.go'
  - 'classlite-api/internal/handler/exercise_handler_atdd_test.go'
  - 'classlite-api/internal/handler/enrollment_handler_atdd_test.go'
  - 'docs/project-context.md'
  - '.claude/skills/bmad-tea/resources/knowledge/{test-quality,test-levels-framework,test-priorities-matrix,data-factories}.md'
---

# ATDD Checklist — Story 4.3a: AI Content Generation Pipeline (Backend)

## Step 1 — Preflight & Context

### Stack detection
- **Detected stack:** `backend` (Go 1.25, `go.mod` at `classlite-api/`; no frontend manifest in the story's scope).
- **Test framework:** Go stdlib `testing` + `*_test.go`; real-Postgres-in-tx via `internal/test.SetupDB` / `SetupRawPool`; worker harness `internal/test/workers.SetupWorkerHarness`. Prereqs met.

### Prerequisites (hard requirements) — all PASS
- Story approved with clear ACs — `ready-for-dev`, AC1–AC9 explicit. ✅
- Test config present — `harness.go`/`harness_test.go`, `_TEMPLATE_rls_test.go`, existing `*_atdd_test.go` suite. ✅
- Dev env available. ✅

### Red-phase gate decision (Go-specific)
Referencing the net-new `internal/worker`, `internal/gemini`, `model/job_types`, sqlc `jobs`/`ai_credit_ledger` queries, and the two new endpoints would break compilation of existing packages and block the rest of `go test ./...`. **All red scaffolds carry `//go:build atdd_red`.**
- CI stays green: default build excludes the tag.
- Red target: `go test -tags atdd_red ./...` (compiles → fails, because impl is absent).
- Dev strips the tag from each file as its AC goes green (green-phase handoff). File headers state this.

### ACs in scope (mandatory ≥6-risk first, per WF-8)
| AC | What | Risk | Level | Red file |
|---|---|---|---|---|
| AC3 | Worker re-establishes tenant from **job-row** `center_id`; payload center_id ignored; null-ctx rejected | R3/A7 **(9)** | worker (harness 3-pattern) | `internal/worker/ai_generate_atdd_test.go` |
| AC8 | 3-pattern × 3 job types + credit-ledger −1/+1 + double-refund no-op + secret-in-logs guard | R3/A7, R23/A6, R49 | worker + store + log-capture | `internal/worker/ai_generate_atdd_test.go`, `internal/worker/credit_refund_atdd_test.go`, `internal/worker/secret_logging_atdd_test.go` |
| AC7 | Idempotent refund on terminal-fail (max-retries, invalid_ai_response) + 5-min stuck-sweep; no refund on complete | R23/A6 **(6)** | worker + store | `internal/worker/credit_refund_atdd_test.go` |
| AC1 | Enqueue = single-tx {job insert + −1 job_deduction}; **202**; scope-gated 403/404; does NOT call Gemini; p95<200ms | R23/A6 | handler integration | `internal/handler/ai_generation_handler_atdd_test.go` |
| AC9 | RLS isolation on `jobs` + `ai_credit_ledger`; ledger append-only (no UPDATE/DELETE) | GO-1/SEC-6/SEC-9 | store | `internal/test/jobs_rls_atdd_test.go`, `internal/test/ai_credit_ledger_rls_atdd_test.go` |

AC2 (poll typed envelope) folded into the AC1 handler file. AC4/AC5/AC6 (Gemini parse/retry/backoff) are asserted as green-phase companions inside the worker files but not the mandatory ATDD gate — the WF-8 gate is AC3/AC7/AC8.

### Mock seams honored (no others)
- Worker tests: `gemini.Client` interface → `MockGeminiClient` (deterministic canned + error/malformed modes). Real Gemini banned from PR.
- Backend seam elsewhere: store interface in service unit tests; **real Postgres-in-tx** everywhere else (TEST-BE-1..5). Never mock pgx.

### Reuse map (build on, don't reinvent)
- `internal/test/workers/{harness.go,harness_test.go}` — `SetupWorkerHarness`, `JobHandler`, `EnqueueJob`, `ProcessSpecific`, `ProcessWithoutTenantContext`, `JobStatus`, 3-pattern reference (inspectHandler/rlsProbeHandler).
- `internal/test/_TEMPLATE_rls_test.go` (6 patterns) + `exercises_rls_test.go` + `AssertRLSViolation`.
- `internal/test/story_4_1_helpers.go` `NewExerciseTestServerBareMux` (pattern to mirror for the ai-generation route chain) + `SetupRawPool`/`CreateUserOnPool`/`CreateCenterForOwner`/`AddCenterMember`/`SignAccessTokenForRole`/`MarkUserEmailVerifiedOnPool`.
- `test.TenantAID`/`TenantBID`, `CreateCenterWithID`, `TenantContext`, `clock.MockClock`.

## Step 2 — Generation Mode
**AI Generation** (backend → always; no browser recording). Scaffolds derived from the story ACs, the A6 refund matrix, the A7 harness contract, and source analysis of the existing test suite.

## Step 3 — Test Strategy

Levels for a pure-backend story: **Unit** (pure funcs / backoff math), **Integration** (worker + real DB in tx, store RLS), **API/Contract** (handler through real middleware). No E2E.

### AC → scenario → level → priority

**AC3 — Worker re-establishes tenant from the JOB ROW (R3/A7, score 9) — P0**
Level: Integration (worker harness + real Postgres-in-tx). The 3 mandatory patterns, per job type ×3:
- S3.1 `Test{Handler}_HappyPath` — row tenant A set on the connection; handler's DB read/write lands under A; downstream effect (jobs.result written / exercise section read) asserted. (P0)
- S3.2 `Test{Handler}_PayloadCenterIdIgnored` — job row `center_id=A`, payload carries `center_id=B` (+ a B-owned resource id). Handler must operate under A → RLS returns 0 rows for the B resource → `NotFoundError`, **never** a B row. Asserts the connection's `current_setting('app.current_tenant_id')` == A. (P0)
- S3.3 `Test{Handler}_NullTenantContextRejected` — `ProcessWithoutTenantContext` → every RLS-scoped op returns 0 rows / `ErrNoRows`, never all-rows. (P0)

**AC7 — Idempotent refund on terminal-fail + stuck-sweep (R23/A6) — P0**
Level: Integration (worker/service + real DB). From the A6 refund matrix:
- S7.1 refund `+1 job_failed_refund` on **max-retries-exhausted** (3), same tx as `failed` transition. (P0)
- S7.2 refund `+1` on **`invalid_ai_response`** terminal fail. (P0)
- S7.3 refund `+1` on **5-min stuck-sweep** (`FindStuckProcessingJobs` → mark failed `stuck_timeout` + refund). (P0)
- S7.4 **double-refund is a no-op** — second insert with same `(ref_job_id, reason)` hits the unique index → `ON CONFLICT DO NOTHING`; ledger sum unchanged (worker vs sweep race). (P0)
- S7.5 **no refund on `complete`** — success path inserts no `job_failed_refund` row; balance stays at −1. (P0, negative)
- S7.6 refund tx is atomic with the state transition — rollback → neither the `failed` transition nor the `+1` persists. (P1)

**AC8 — Mandatory adversarial + ledger + secret-in-logs (WF-8) — P0**
Level: Integration + log-capture unit.
- S8.1 3-pattern × {section, questions, distractors} = the AC3 scenarios above, one file, all 9. (P0)
- S8.2 credit-ledger `−1 job_deduction` **same tx as job insert** on enqueue: assert both rows exist; on forced rollback, **neither** exists. (P0)
- S8.3 refund matrix S7.1–S7.5 (shared with AC7). (P0)
- S8.4 **secret-in-logs guard** — capture slog output across enqueue → worker → gemini paths; assert the `GEMINI_API_KEY` value AND the raw prompt/response text never appear (only job_id/center_id/model/type may). Service-level assertion; CI grep-scan is a separate infra step. (P0, R49)

**AC1 — Enqueue single-tx {job + −1 ledger} → 202; scope-gated; no Gemini (R23/A6) — P0**
Level: API/Contract (handler through real middleware, real service+store+DB).
- S1.1 teacher who owns exercise → **202** `{data:{jobId}}`; a `jobs` row (`pending`) AND a `−1 job_deduction` ledger row exist for the same job. (P0)
- S1.2 enqueue **does NOT call Gemini** — inject `MockGeminiClient`, assert `Generate` uncalled after enqueue returns. (P0)
- S1.3 scope no-oracle — cross-teacher exercise → **404** `EXERCISE_NOT_FOUND`; student → **403**; unauthenticated → **401**. (P0, negative)
- S1.4 invalid/typed-body failure (unknown `mode`, missing `params`) → **422** `VALIDATION_ERROR`. (P1)
- S1.5 enqueue is atomic — job insert + ledger −1 both-or-neither on a forced failure. (P1)
- S1.6 (AC2 poll) enqueued job owned by caller → `GET /api/jobs/{jobId}` → 200 typed envelope `{id,type,status,result,errorDetails,createdAt,startedAt,completedAt}`, `status=pending`, `result=null`; cross-tenant / unknown → **404** `JOB_NOT_FOUND`. (P0)
- S1.7 NFR note: enqueue p95 <200ms — asserted as a soft single-call latency check with a TODO to promote to k6/observability (not a hard gate here). (P2)

**AC9 — RLS isolation on both new tables (GO-1/SEC-6/SEC-9) — P0**
Level: Integration (store, real DB in tx). Copy the 6-pattern `_TEMPLATE_rls_test.go` grid per table:
- S9.1 `jobs`: CrossTenantRead, CrossTenantInsert (WITH CHECK), CrossTenantWrite (silent 0-row UPDATE), NullTenant, UnsetTenant. (P0)
- S9.2 `ai_credit_ledger`: CrossTenantRead, CrossTenantInsert, NullTenant + **append-only**: UPDATE and DELETE must be rejected (mirror `auth_audit_logs`). (P0)
- S9.3 `ai_credit_ledger` unique `(ref_job_id, reason)` idempotency at the SQL layer (shared assertion with S7.4). (P0)

### Red-phase confirmation
All scenarios fail before implementation because they reference net-new symbols (`worker.NewGenerate*Handler`, `gemini.MockGeminiClient`, `NewAIGenerationTestServerBareMux`, sqlc `jobs`/`ai_credit_ledger` queries, the two routes) or query tables that don't exist yet. `//go:build atdd_red` keeps the default suite green; `go test -tags atdd_red ./...` is the red target.

### Out of ATDD scope (green-phase companions, not the WF-8 gate)
AC4 (typed Gemini parse → map → `ValidateExerciseContentStructural` → result), AC5 (retry backoff 30/60/120), AC6 (`invalid_ai_response` terminal-not-retried) — these get inline unit/integration tests during dev via `MockGeminiClient` error/malformed modes + `MockClock`, referenced from the worker file as `// green-phase` markers so dev sees the expectation.

## Step 4 / 4c — Generated Red Scaffolds (TDD RED PHASE)

### TDD red-phase compliance (Go adaptation of `test.skip()`)
The workflow's `test.skip()` contract maps to Go via a build tag: every scaffold carries `//go:build atdd_red`.
- **Default build/CI stays green** — verified: `go build ./...` = 0, `go vet ./...` = 0, `go test ./...` compiles (the two net-new package dirs carry an untagged `doc.go` placeholder so they are valid empty packages under the default build).
- **Red target fails as designed** — `go test -tags atdd_red ./...` fails to compile on the net-new symbols (`worker.NewGenerate*Handler`, `worker.NewDispatcher`, `gemini.Client`/`NewMockClient`, `test.NewAIGenerationTestServerBareMux`, `test.SeedExerciseOwnedBy`, …) and the RLS files fail at runtime on the missing `jobs`/`ai_credit_ledger` tables.
- **No placeholder assertions** — every test asserts real expected behavior (status codes, ledger sums, RLS 0-row, tenant-on-connection). No `assert true == true`.
- `gofmt -l` clean on all 6 scaffolds + 2 stubs.

### Generated files (6 scaffolds + 2 placeholder stubs)
| File | ACs | Level | Count |
|---|---|---|---|
| `internal/worker/ai_generate_atdd_test.go` | AC3, AC8 (3-pattern × 3 types) | worker+DB | 9 |
| `internal/worker/credit_refund_atdd_test.go` | AC7, AC8, AC6 | worker+DB | 6 |
| `internal/worker/secret_logging_atdd_test.go` | AC8 / R49 | log-capture | 1 |
| `internal/handler/ai_generation_handler_atdd_test.go` | AC1, AC2 | handler+middleware+DB | 6 |
| `internal/test/jobs_rls_atdd_test.go` | AC9 (jobs) | store RLS | 5 |
| `internal/test/ai_credit_ledger_rls_atdd_test.go` | AC9, AC7/AC8 | store RLS + idempotency | 7 |
| `internal/worker/doc.go` | placeholder pkg | — | — |
| `internal/gemini/doc.go` | placeholder pkg | — | — |

**≈34 red test cases** across the 5 mandatory-gate ACs (AC3/AC7/AC8) + AC1/AC2/AC9.

### AC → red-test coverage map
- **AC3 (R3/A7, 9)** ✅ `TestGenerate{Section,Questions,Distractors}_{HappyPath,PayloadCenterIdIgnored,NullTenantContextRejected}` (9 tests).
- **AC7 (R23/A6, 6)** ✅ `TestRefund_OnMaxRetriesExhausted`, `TestRefund_OnInvalidAIResponse_TerminalNotRetried`, `TestRefund_OnStuckProcessingSweep`, `TestNoRefund_OnComplete`, `TestRefund_DoubleAttemptIsNoOp` + SQL-layer `TestAICreditLedger_DoubleRefundIsNoOp`.
- **AC8 (WF-8)** ✅ 3-pattern×3 (above) + `TestEnqueue_TeacherOwns_202_WithDeduction` (−1 same-tx) + refund matrix + `TestSecretsAndPrompt_NeverLogged` (R49).
- **AC1** ✅ `TestEnqueue_TeacherOwns_202_WithDeduction`, `TestEnqueue_DoesNotRunGenerationSynchronously`, `TestEnqueue_ScopeNegatives` (404/403/401), `TestEnqueue_BadBody_422`.
- **AC2** ✅ `TestPollJob_OwnerSeesTypedEnvelope_CrossTenant404`.
- **AC9** ✅ `TestRLS_Job_*` (Read/Insert/Write/NullTenant/UnsetTenant) + `TestRLS_AICreditLedger_*` (Read/Insert/NullTenant) + `TestAICreditLedger_{Update,Delete}Rejected` (append-only).

### Green-phase handoff — what dev must build to turn these RED→GREEN
The scaffolds are the executable spec. Implement (per story T1–T10), then run `go test -tags atdd_red ./...` and strip the `atdd_red` tag file-by-file as each passes:
1. **Migrations (T1/T2):** `jobs` + `ai_credit_ledger` tables with RLS (null-guard) + `job_status` enum + unique `(ref_job_id, reason)` + append-only ledger policy. → unblocks all RLS + runtime reds.
2. **`internal/gemini`:** `Client` interface + `NewMockClient(MockConfig)` with `CallCount()` and modes `MockValidSection|Questions|Distractors|TransientError|Malformed` + `APIKey/PromptMarker/ResponseMarker` fields (delete `doc.go`).
3. **`internal/worker`:** `NewGenerate{Section,Questions,Distractors}Handler(db, gemini, clock)`, `NewDispatcher(...)` + `ProcessOnce`/`SweepStuckJobs` (delete `doc.go`).
4. **`model`:** `JobTypeAIGenerate{Section,Questions,Distractors}` consts + `AIGenerate{Section,Questions,Distractors}Params` (each with an untrusted `CenterIDClaim` field to prove it's ignored).
5. **Harness (T9):** migrate `EnqueueJob`/`ProcessSpecific` in-memory→real `jobs` table (public API unchanged).
6. **`internal/test` helpers:** `NewAIGenerationTestServerBareMux(t, pool)` (mirror `NewExerciseTestServerBareMux`), `SeedExerciseOwnedBy(t, pool, centerID, ownerID, code)`, `SeedExerciseAuthorForWorker(t, db)`, `SeedDeductedAIJob(t, db, tenant, type, params)`, `ForceJobProcessingSince(t, db, jobID, when)`.
7. **DI note:** handler `ProcessTask(ctx, tc, payload)` uses the tx-scoped DB passed at construction (mirror `harness_test.go` inspectHandler). **See story Dev Notes → "Build constraints surfaced by ATDD" BC-1/BC-2** (ratified Amelia + Murat 2026-07-29): worker handlers take `generated.DBTX` and run in the caller's tx (never self-`Begin`, never `readInTenantTx`); enqueue service owns its tx like `ExerciseService`; and `ClaimNextJob`/reschedule/stuck-sweep must bind `clock.Now()` as a param, never SQL `now()`, or the MockClock retry tests can't go green.

### Step 5 — Validate & complete
- Red-phase scaffolds verified on disk, tag-gated, compile/vet clean on default, fail on red target. Handoff metadata captured above and linked into the story `## Dev Notes`.
- **This satisfies the WF-8 hard rule:** ATDD red tests for AC3/AC7/AC8 (all risk ≥6) now exist on the branch before 4.3a moves to `in-progress`.
