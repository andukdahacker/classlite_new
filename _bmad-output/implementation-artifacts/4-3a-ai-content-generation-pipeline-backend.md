---
epic: 4
story: 4.3a
story_key: 4-3a-ai-content-generation-pipeline-backend
baseline_commit: 636556e308f4e1e1afcef40db581b9d02484da72
created: 2026-07-28
audience: backend
size: L
depends_on: [4.1, 4.2, 1.2e]
splits_from: 4-3-ai-content-generation-pipeline
scope_decision: "SPLIT (Ducdo 2026-07-28). Story 4.3 was one dense L (jobs infra + workers + Gemini + ledger + endpoints + s17 dialog + polling + preview + credit UI + i18n) — split per repo precedent (2.5→a/b/c, 3.5). 4.3a = the entire BACKEND async pipeline: the durable `jobs` table + `SELECT FOR UPDATE SKIP LOCKED` dispatcher + main.go worker wiring + graceful shutdown, the in-memory→DB migration of the pre-built worker harness, the 3 ai_generate_* job handlers, the Gemini client abstraction (mock-injected), the `ai_credit_ledger` table + deduct/refund, and both API endpoints (`POST /api/exercises/{id}/ai-generate` → 202, `GET /api/jobs/{jobId}`). 4.3b = s17 AIGenerateDialog + polling hook + preview/insert + credit UI + i18n (HARD-BLOCKED on 4.3a). CREDIT-LEDGER decision (Ducdo): 4.3a MINTS `ai_credit_ledger` NOW per the A6 schema (blocker-resolutions-2026-06-04.md) — epic-04.md:117 says 'defined in Story 6.5' but the schema already exists and R23/A6 is a ≥6 risk that must be mitigated this story; 6.5 later layers monthly_grant/addon_purchase/balance-cache/Settings-UI on top. WF-8: 4.3a touches R3/A7 (score 9), R23/A6 (6), R49 (6) — ATDD red tests MANDATORY before in-progress."
---

# Story 4.3a: AI Content Generation Pipeline — Backend (Jobs, Workers, Gemini, Credits)

Status: done

## ⚠️ Scope banner — read first

Story 4.3 (`epic-04.md:82-123`) is the **AI content-generation pipeline**: a teacher configures a generation (section / questions / distractors), a **job** is enqueued, a **worker** calls **Gemini** asynchronously, and the result is previewed before insertion. Per the split ratified by Ducdo (2026-07-28), **this story (4.3a) ships the entire backend**; the **s17 dialog + polling UI is Story 4.3b** and is HARD-BLOCKED on 4.3a landing (it needs the two endpoints + the regenerated `client.ts`).

**This is the highest-risk backend surface in Epic 4.** It stands up the **durable `jobs` table** the whole product has been deferring to "Epic 4.3" (`deferred-work.md:28`, `harness.go:30-38`), plus the async worker path where **SEC-6 (worker tenant re-establishment)** lives — **risk R3/A7 scored BLOCK(9)**. It also mints the **`ai_credit_ledger`** (R23/A6, score 6) and touches the **`GEMINI_API_KEY`** secret (R49, score 6). All three are ≥6, so per **WF-8** ATDD red tests are **MANDATORY on the branch before this story moves to `in-progress`** (`/bmad-tea AT`).

**Hard dependencies — all `done`:** 4.1 (`exercises` table + v1 `ExerciseContent` struct + `assertTeacherScope`/`assertClassRole` scope gates + the `updated_at`-preconditioned `PATCH`), 4.2 (`ValidateExerciseContentStructural` — every AI-merged section/group/question MUST pass this before persist), 1.2e (presigned uploads — only relevant to 4.4; noted by the epic, not used here).

**What is net-new (nothing to reuse — build it):** the `jobs` table + migration, `store/queries/jobs.sql`, the `internal/worker/` package (no production worker package exists — only the *test* harness at `internal/test/workers/`), the dispatcher poll loop, the 3 `ai_generate_*` handlers, `internal/gemini/` client, `ai_credit_ledger` table + queries, `model/job_types.go` + `model/ai_response.go`, and both endpoints. **What to reuse:** the pre-built worker **test harness** (`internal/test/workers/harness.go`), the `email_retry.go` `Start(ctx)` worker precedent + main.go:107 `workerCtx`/`cancelWorker` graceful-shutdown wiring, the exercise scope gates + `ValidateExerciseContentStructural`, the typed error/envelope stack, and the config/audit/test-helper infrastructure.

### Decisions folded into this spec (resolve the epic's own gaps)

- **`ai_credit_ledger` is created HERE, per A6, not deferred to 6.5** (Ducdo). Full schema below (Dev Notes §"ai_credit_ledger DDL"). 4.3a implements `job_deduction` (−1) and `job_failed_refund` (+1) only; `monthly_grant`/`addon_purchase`/`admin_adjustment` + the balance cache + Settings credit UI are 6.5.
- **The worker harness migrates in-memory → real `jobs` table, public API unchanged** — this is an explicit instruction in the harness header (`harness.go:30-38`). `EnqueueJob` INSERTs; `ProcessSpecific`/a new `ProcessNext` SELECT … FOR UPDATE SKIP LOCKED inside the test transaction. `SetupWorkerHarness`, `EnqueueJob`, `ProcessSpecific`, `ProcessWithoutTenantContext`, `JobStatus`, `JobPayload` signatures stay stable so `harness_test.go` keeps passing.
- **Gemini is real in production, mock in every PR test** (`test-design-qa.md:57`, `:307`). Ship a `gemini.Client` interface with a real HTTPS impl + a `MockGeminiClient`; the worker depends on the interface. No real Gemini call in CI.
- **Job schema uses the shared `job_status` enum** (`architecture.md:307`) and carries `center_id` as the **sole tenant trust anchor** (payload tenant fields are untrusted — `harness.go:57-64`).

## Story

As a Teacher (or Admin/Owner),
I want the system to generate exercise content with AI through a durable, retried, credit-metered background job,
So that a slow Gemini call never blocks my request and a failed generation never silently costs me a credit.

## Acceptance Criteria

Adapted from `epic-04.md` Story 4.3 ACs (backend subset) + the two Failure-Path ACs + PRD FR-24/25/26 consequences. The **dialog/preview/polling-UI ACs (epic AC1 credit-display, AC3 backoff-in-UI, AC4 preview) are Story 4.3b** — 4.3a delivers the contracts they consume.

**AC1 — Enqueue endpoint returns a job, credit deducted in the same tx (FR-24/25/26; epic AC2, AC8-credit)**
**Given** a Teacher/Admin/Owner who may edit exercise `{id}` (4.1 scope: teacher→own, owner/admin→any in-center),
**When** they `POST /api/exercises/{id}/ai-generate` with a valid typed body (`{ mode: section|questions|distractors, params: {...} }`),
**Then** the service, **in a single transaction**: (a) re-validates edit scope (`assertClassRole`→403, cross-scope→**404** `EXERCISE_NOT_FOUND`, same no-oracle as 4.1), (b) inserts a `jobs` row `{center_id, type: ai_generate_*, status: 'pending', params, params_schema_version:1, retry_count:0, max_retries:3}`, (c) inserts a `−1` `ai_credit_ledger` row `{reason:'job_deduction', ref_job_id:<job>, change:-1}` — **same tx as the job insert** (R23/A6), and returns **HTTP 202** `{ data: { jobId } }`. Enqueue does NOT call Gemini (PERF-3). Enqueue p95 **<200ms** (NFR).

**AC2 — Poll endpoint returns typed job state (epic AC3-contract)**
**Given** an enqueued job the caller's tenant owns,
**When** they `GET /api/jobs/{jobId}`,
**Then** the response is the standard envelope `{ data: { id, type, status, result, errorDetails, createdAt, startedAt, completedAt } }` with `status ∈ {pending,processing,complete,failed}`; **cross-tenant / unknown jobId → 404** `JOB_NOT_FOUND` (RLS returns 0 rows — no oracle). `result` is `null` until `complete`; on `complete` it carries the typed generation result (a `content`-shaped fragment ready for 4.3b to preview/insert). The route is served under the same authenticated middleware chain as the exercises routes.

**AC3 — Worker dequeues with SKIP LOCKED and re-establishes tenant context from the JOB ROW (SEC-6, GO-1; epic AC6, AC7 / R3 / A7)**
**Given** the dispatcher poll loop,
**When** it claims a pending job,
**Then** it uses `SELECT … FOR UPDATE SKIP LOCKED` (no two workers grab the same row), transitions `pending→processing` (`started_at` set), and **before any handler DB op establishes tenant context from the job row's `center_id`** via `SET LOCAL app.current_tenant_id` inside the job's transaction (the async equivalent of GO-1). **The payload `center_id` (if any) is IGNORED and logged as a discrepancy signal, never trusted** (`harness.go:114-120`). Each handler implements `JobHandler.ProcessTask(ctx, tc, payload)` (`harness.go:62`). **This is proven by the mandatory 3-pattern adversarial test per job type (AC8).**

**AC4 — Gemini call, typed-parse, merge, complete (FR-24/25/26; epic AC5)**
**Given** a claimed `ai_generate_section` / `ai_generate_questions` / `ai_generate_distractors` job,
**When** the handler runs,
**Then** it builds the per-mode prompt, calls the injected `gemini.Client`, **unmarshals the response into a typed `model` struct** (`ai_response.go`, GO-7 — never `map[string]interface{}`), maps it into the v1 `ExerciseContent` shape (section = passage + question groups; questions = groups appended to an existing section; distractors = options for one MCQ question), **runs `ValidateExerciseContentStructural` on the produced fragment** (a malformed generation must not become an un-insertable result), writes the typed result into `jobs.result` (+`result_schema_version:1`), and marks `status='complete'` (`completed_at` set). **The worker never mutates the exercise itself — it only produces a result fragment; insertion is the teacher's explicit act in 4.3b** (preview→accept). `GEMINI_API_KEY` and full prompt/response payloads are **never logged** (EDGE-4/R49 — log job_id/center_id/model/type only).

**AC5 — Retry with backoff on transient Gemini failure (epic Failure-Path AC2)**
**Given** Gemini returns an error or is unreachable,
**When** the handler fails,
**Then** the job is **rescheduled** with `error_details` recorded and `retry_count` incremented, and **retried with exponential backoff 30s → 60s → 120s up to `max_retries` (3)**. A transient failure that still has retries left keeps the job in `status='pending'` with `next_attempt_at = now()+backoff` so it is re-claimable once `next_attempt_at <= now()` (not terminal); the job transitions to terminal `status='failed'` only when `max_retries` is exhausted. _(Amended 2026-07-29 code review, Decision 2: the single-state `pending`+`next_attempt_at` design replaces the original literal "marked `failed` then re-claim retry-ready `failed`-with-retries" wording — ratified as cleaner; a job is never left `failed` with retries remaining.)_

**AC6 — Malformed AI output is terminal, NOT retried (epic Failure-Path AC4)**
**Given** Gemini returns unparseable/invalid output (typed unmarshal fails, or the fragment fails `ValidateExerciseContentStructural`),
**When** the handler processes it,
**Then** the job fails with `error_details = 'invalid_ai_response'` and is **NOT auto-retried** (a bad prompt won't fix itself by retrying) — it goes terminal-failed immediately regardless of `retry_count`.

**AC7 — Refund on terminal failure and on the 5-minute stuck timeout, idempotently (R23 / A6; epic AC8-credit, Failure-Path AC1/AC3)**
**Given** a job reaches a terminal `failed` state — either `max_retries` exhausted (AC5), `invalid_ai_response` (AC6), or a **sweep finds it stuck in `processing` > 5 minutes** —
**When** the terminal transition is written,
**Then** a **`+1` `ai_credit_ledger` refund row** `{reason:'job_failed_refund', ref_job_id:<job>, change:+1}` is inserted **in the same tx as the state transition**. **Idempotency:** the unique index `(ref_job_id, reason)` makes a second refund for the same job a no-op (ON CONFLICT DO NOTHING) — a job cannot be refunded twice even if the sweep and the worker race. **No refund on `complete`** (or on a user-cancel-mid-processing — cancel is 4.3b/Epic-6 territory; not in 4.3a). The stuck-sweep also marks the row `failed` (`error_details='stuck_timeout'`) so it stops being re-swept.

**AC8 — Mandatory worker adversarial tests + credit-ledger tests + secret-in-logs guard (WF-8; R3/A7, R23/A6, R49)**
**Given** each of the 3 job types (`ai_generate_section`, `ai_generate_questions`, `ai_generate_distractors`),
**When** the worker test suite runs (via `SetupWorkerHarness`),
**Then** each type ships the **3 mandatory patterns** (`harness.go:14-28`): `Test{Worker}_HappyPath` (row-tenant context set, downstream effect asserted), `Test{Worker}_PayloadCenterIdIgnored` (job row `center_id=A`, payload claims tenant B → RLS 0 rows → `NotFoundError`, **not** a leak), `Test{Worker}_NullTenantContextRejected` (`ProcessWithoutTenantContext` → every DB op returns 0 rows, never all-rows). **AND**: credit-ledger tests — `−1` on enqueue in the same tx as job insert (assert both rows or neither on rollback); `+1` refund on max-retries-exhausted, on `invalid_ai_response`, and on stuck-timeout; **double-refund rejected by the unique index**. **AND**: an assertion that no log line emitted by the enqueue/worker/gemini paths contains `GEMINI_API_KEY`'s value or the raw prompt/response (R49 — service-level check; the CI grep-scan is a separate infra step).

**AC9 — jobs + ai_credit_ledger RLS isolation (GO-1, SEC-6, SEC-9)**
**Given** the two new tenant-scoped tables,
**When** cross-tenant access is attempted,
**Then** both `jobs` and `ai_credit_ledger` enforce **RLS keyed on `center_id`** with the **null-guard** (0 rows, never all rows, when `app.current_tenant_id` is unset); `ai_credit_ledger` is **append-only (INSERT-only policy, no UPDATE/DELETE)** mirroring `auth_audit_logs` (Story 1.3b). Adversarial read+write isolation tests per TEST-BE-1 (cross-tenant read → empty; cross-tenant refund/insert → RLS-blocked).

## Tasks / Subtasks

> **Pre-dev (mandatory):**
> 1. **ATDD FIRST (WF-8, risk ≥6):** run `/bmad-tea AT` for AC3/AC7/AC8 (the R3/A7 worker-tenant + R23/A6 credit ACs) — red acceptance tests on the branch BEFORE moving to `in-progress`. This story fails epic-gate review without them.
> 2. Read `internal/test/workers/harness.go` **fully** (the harness IS the worker contract) + `harness_test.go`. Read `service/email_retry.go` `Start(ctx)` (the worker-loop + panic-recovery + clock-injection precedent) and `cmd/api/main.go:107-108,603-620` (the `workerCtx`/`cancelWorker` graceful-shutdown wiring you extend).
> 3. Read `blocker-resolutions-2026-06-04.md` A6 (ledger schema) + A7 (harness contract), and `test-design-qa.md` P0-313..320 / P0-391..395 / P0-441..445.
>
> **Ordering guard (WF-1/WF-3/WF-2):** migrations FIRST (`jobs`, `ai_credit_ledger`) → `migrate.sh` → write `.sql` queries → **`codegen.sh` LAST** (also regenerates `api.yaml`→Go/TS/Zod once the two endpoints land). Never edit an existing migration (WF-2). Atomic commit includes `api.yaml` + all generated output + handler (WF-4).

### Migrations & schema (classlite-api/migrations)

- [x] **T1 — `jobs` table migration (AC1, AC2, AC3, AC9)**
  - [x] New pair `20260728120000_create_jobs.up.sql/.down.sql` (next slot after `20260727120000_create_exercises`; confirm with `ls migrations | tail`). `CREATE TYPE job_status AS ENUM ('pending','processing','complete','failed')` (shared enum, `architecture.md:307`). Columns per Dev Notes §"jobs DDL". Index `idx_jobs_status_created_at (status, created_at)`. **RLS ON** keyed `center_id` with the null-guard helper (same pattern as `exercises`); down-migration drops table + enum + policy.
- [x] **T2 — `ai_credit_ledger` table migration (AC1, AC7, AC9)**
  - [x] New pair `..._create_ai_credit_ledger.up.sql/.down.sql`, schema per Dev Notes §"ai_credit_ledger DDL" (A6). **Append-only INSERT-only RLS policy** (mirror `auth_audit_logs`, Story 1.3b — no UPDATE/DELETE). **Unique index `(ref_job_id, reason)`** (idempotency). Read index `(center_id, user_id, created_at DESC)`. `reason` constrained to the 5-value set (CHECK or enum).

### Data layer (classlite-api/internal/store)

- [x] **T3 — sqlc queries (AC1–AC3, AC5–AC7)**
  - [x] `store/queries/jobs.sql`: `InsertJob`, `GetJobByID`, `ClaimNextJob` (`SELECT … FOR UPDATE SKIP LOCKED … LIMIT 1` filtered to `status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= @now)`; order by `created_at` — amended per Decision 2, no separate "retry-ready `failed`" branch), `MarkJobProcessing`, `MarkJobComplete`, `MarkJobFailed` (sets error_details, retry_count), `RescheduleJob` (retry backoff), `FindStuckProcessingJobs` (processing older than 5min). `store/queries/ai_credit_ledger.sql`: `InsertLedgerEntry` (with `ON CONFLICT (ref_job_id, reason) DO NOTHING` for the refund path), `SumCenterUserBalance` (read helper for 6.5/enqueue guard). `codegen.sh` after.
  - [x] `model/job_types.go` — `JobType` constants (`AIGenerateSection`/`Questions`/`Distractors` = the `architecture.md:484` strings) + status constants mirroring the enum + `MaxRetries=3` + backoff table `[30s,60s,120s]` (named constants, CQ-3). `model/ai_response.go` — typed generation-result structs per mode with `SchemaVersion` (GO-7).

### Gemini client (classlite-api/internal/gemini)

- [x] **T4 — Client abstraction (AC4, AC6, R49)**
  - [x] `gemini.Client` interface (`Generate(ctx, req) (raw, err)`), a real HTTPS impl (model + key from config; timeout ≤ the worker budget), and `MockGeminiClient` (deterministic canned responses + injectable error/malformed modes for tests — `worker/testdata/` per `architecture.md:707`). Per-mode prompt builders. **Dependency decision — FLAG FOR HUMAN REVIEW (like `excelize` in 2.7):** prefer a **raw `net/http` REST call** to the Gemini `generateContent` endpoint to stay consistent with the stdlib-only ethos (no third-party HTTP router, roll-your-own auth); if the official `google.golang.org/genai` SDK is used instead, flag the new dependency for human review before adding to `go.mod`. Architecture pins no SDK (`architecture.md:1015` names only the provider). **EDGE-4/R49:** key lives in env only; never in structs serialized to JSON, health checks, errors, or logs. Add `GEMINI_API_KEY` + `GEMINI_MODEL` to `config.go` loader, `.env.example`, and `docs/manual-setup.md` (WF-9 — new secret + third-party service).

### Worker (classlite-api/internal/worker)

- [x] **T5 — Dispatcher poll loop + main.go wiring + graceful shutdown (AC3, AC5, AC7)**
  - [x] `internal/worker/dispatcher.go` — `Start(ctx)` ticker loop: `ClaimNextJob` (SKIP LOCKED) → set tenant context from row `center_id` → dispatch by `type` to the registered `JobHandler` → on success `MarkJobComplete`; on transient error `RescheduleJob` (backoff) or terminal `MarkJobFailed`+refund; **panic-recovery per job** (copy `email_retry.go:170-177` `callSenderRecovered`) so one bad job can't kill the loop; deterministic `clock.Clock` injection. **Worker pool size 3, DB pool 15** (NFR — named constants). A separate **stuck-sweep** tick (`FindStuckProcessingJobs` → mark failed + refund, AC7). Wire `go dispatcher.Start(workerCtx)` in `main.go` using the existing `workerCtx`/`cancelWorker` (`main.go:107`) so `cancelWorker()` on shutdown drains cleanly (extend the existing graceful-shutdown block, not a new one).
- [x] **T6 — The 3 ai_generate_* handlers (AC4, AC6)**
  - [x] `internal/worker/ai_generate.go` — three `JobHandler` impls (`ProcessTask(ctx, tc, payload)`): unmarshal typed params → build prompt → `gemini.Client.Generate` → typed-unmarshal (fail → `invalid_ai_response`, AC6) → map to `ExerciseContent` fragment → `ValidateExerciseContentStructural` (fail → `invalid_ai_response`) → write `jobs.result`. `section` = passage + question groups; `questions` = groups for an existing section id (in params); `distractors` = options for one MCQ question. **Handlers never re-derive tenant from payload** (`harness.go:57-64`).

### Service & handler (classlite-api/internal/{service,handler})

- [x] **T7 — Enqueue + poll service/handler (AC1, AC2, AC9)**
  - [x] `service/ai_generation_service.go` (or extend `exercise_service.go`) `EnqueueGeneration(ctx, tc, exerciseID, mode, params)`: scope gate (reuse `assertClassRole`/`assertTeacherScope` → 403/404) → **single tx**: `InsertJob` + `InsertLedgerEntry(-1, job_deduction)` → return jobId. `service/job_service.go` `GetJob(ctx, tc, jobID)` (RLS-scoped read → `NotFoundError` on 0 rows). Handlers: `POST /api/exercises/{id}/ai-generate` → **202** `{data:{jobId}}` (GFW-5 envelope; typed request body validated → `ValidationError` 422); `GET /api/jobs/{jobId}` → job envelope. Register both on the authenticated mux chain in `main.go` (mirror the `exerciseSvc`/`exerciseHandler` block at `main.go:486-487` + the `mux.Handle("VERB /api/...", chain(...))` pattern at `:459-462`).
- [x] **T8 — api.yaml + codegen (AC1, AC2, AC4)**
  - [x] Add schemas: `AIGenerateRequest` (discriminated by `mode`) with `AIGenerateSectionParams`/`QuestionsParams`/`DistractorsParams`, `Job` (+ `JobStatus` enum), `AIGenerationResult`. Endpoints `POST /api/exercises/{id}/ai-generate` (**202**/403/404/422 — the **402 insufficient-credits gate is reserved for 6.5**, NOT implemented here; enqueue records the −1 without blocking on balance) and `GET /api/jobs/{jobId}` (200/404). camelCase, explicit nulls (GO-5). **`scripts/codegen.sh` LAST** → Go types + `client.ts` + Zod (consumed by 4.3b).

### Harness migration & tests (classlite-api/internal/test/workers + package tests)

- [x] **T9 — Migrate the worker harness in-memory → real `jobs` table (AC3, AC8; harness.go:30-38)**
  - [x] Rework `harness.go` internals: `EnqueueJob` INSERTs into `jobs` (within the test tx); add `ProcessNext` + keep `ProcessSpecific`/`ProcessWithoutTenantContext` doing `SELECT … FOR UPDATE SKIP LOCKED`. **Public API (signatures) unchanged** — `harness_test.go` must still pass untouched (or with only additive changes). This is the seam the epic promised.
- [x] **T10 — ATDD + unit/integration tests (AC1–AC9; TEST-BE-1..5)**
  - [x] **Worker 3-pattern per type** (AC8, the ATDD red tests): `HappyPath`/`PayloadCenterIdIgnored`/`NullTenantContextRejected` × {section,questions,distractors} via `SetupWorkerHarness` + `MockGeminiClient`.
  - [x] **Credit ledger** (AC1, AC7): `-1` same-tx-as-insert (rollback → neither row); `+1` refund on max-retries / `invalid_ai_response` / stuck-timeout; **double-refund → unique-index no-op**; balance sum correct.
  - [x] **Retry/backoff** (AC5): transient Gemini error → reschedule at `now()+30/60/120s`, terminal after 3; **`invalid_ai_response` terminal immediately, NOT retried** (AC6) — assert via `MockGeminiClient` error/malformed modes + `MockClock`.
  - [x] **RLS isolation** (AC9, TEST-BE-1): cross-tenant `jobs` read → empty; cross-tenant ledger insert/read blocked; `ai_credit_ledger` UPDATE/DELETE rejected (append-only).
  - [x] **Handler integration** (AC1, AC2, TEST-BE-3): `POST …/ai-generate` teacher→202+jobId (+ledger −1), cross-teacher→404, student→403; `GET /jobs/{id}` owner→200 typed, cross-tenant→404. Full `{data,meta}`/`{error}` envelope shape asserted. **Enqueue does NOT call Gemini** (assert mock uncalled).
  - [x] **R49** (AC8): capture slog output across enqueue/worker/gemini; assert key value + raw prompt/response absent. `go test ./... && go vet ./... && gofmt -l` clean.

### Close-out

- [x] **T11 — Deferred-work + docs + memory**
  - [x] `deferred-work.md` **FU-4-3-A**: (a) **4.3b (frontend) is the remaining half** — s17 AIGenerateDialog + polling + preview/insert + credit UI + i18n, blocked on this story; (b) **Story 6.5 layers onto `ai_credit_ledger`** — `monthly_grant`/`addon_purchase`/`admin_adjustment` reasons, balance cache + nightly reconciliation cron (A6), Settings→Credits UI, enqueue **hard credit-limit guard** (4.3a inserts the `-1` but does NOT block on insufficient balance — the 402 limit-gate is 6.5; note this explicitly so an unfunded enqueue isn't mistaken for a bug); (c) **Epic 6 reuses this dispatcher** for `ai_grade_writing`/`ai_grade_speaking` (the generic queue is here). Update `docs/manual-setup.md` (GEMINI_API_KEY/GEMINI_MODEL). Dev Agent Record + File List → sibling `4-3a-…-completion-notes.md` (bmad-story-conventions), NOT this file.

### Review Findings

**Chunk 1 of 3 — Data layer** (migrations, `jobs.sql`, `ai_credit_ledger.sql`, `model/job_types.go`, `model/ai_response.go`, RLS ATDD tests). `/bmad-code-review` 2026-07-29 — Blind Hunter + Edge Case Hunter + Acceptance Auditor. 15 findings after dedup: 2 decision, 7 patch, 3 defer, 3 dismissed.

_Decision-needed (both RESOLVED 2026-07-29, Ducdo):_

- [x] [Review][Decision→Patch] `balance_after` running sum computed with no row lock — `ai_credit_ledger.sql:11-33` (`InsertJobDeduction`/`RefundJob`) compute `COALESCE((SELECT SUM(change) …),0) ± 1` with **no** lock, but header + migration comment claim "under the row-lock." Concurrent same-`(center,user)` inserts write a stale/duplicate `balance_after` into an append-only, unrepairable ledger. **Resolution: add the lock now (targeted)** — see patch P8. [blind+edge+auditor]
- [x] [Review][Decision] Retry state machine holds jobs in `status='pending'` not `'failed'` — diverges from AC5/T3's literal "marked `failed` … retry-ready `failed`-with-retries" wording. **Resolution: accept the design (cleaner single-state claim predicate); AC5 + T3 amended in this story 2026-07-29 to match. No code change.** [auditor]

_Patch:_

- [x] [Review][Patch] Add `AND status = 'processing'` guard to terminal transitions [classlite-api/internal/store/queries/jobs.sql:45-69] — `MarkJobComplete`/`MarkJobFailedTerminal`/`RescheduleJob` filter only `WHERE id = @id`; the 5-min stuck sweep can mark+refund a slow-but-alive worker's job, then that worker's `MarkJobComplete` overwrites `failed`→`complete` (refund + delivered content = free generation) or `RescheduleJob` resurrects a refunded terminal job. Worker must treat 0-rows-affected as "already swept" (coordinate in chunk 2). **Critical.** [blind+edge]
- [x] [Review][Patch] Add jobs RLS Pattern 4 (cross-tenant DELETE) test [classlite-api/internal/test/jobs_rls_atdd_test.go] — `jobs_delete` policy exists but no test proves tenant A cannot DELETE tenant B's job; `exercises_rls_test.go` includes Pattern 4. [blind+edge]
- [x] [Review][Patch] Add ai_credit_ledger RLS Pattern 6 (UnsetTenant/RESET default GUC) test [classlite-api/internal/test/ai_credit_ledger_rls_atdd_test.go] — ledger suite tests `NullTenant` (empty string) but not the never-set/`RESET` GUC case the jobs suite + exercises cover. [blind+edge]
- [x] [Review][Patch] Add jobs UPDATE `WITH CHECK` reparent test [classlite-api/internal/test/jobs_rls_atdd_test.go] — current cross-tenant-write test only exercises `USING` (update another tenant's row); no test attempts to reparent your **own** row's `center_id` to another tenant (the `WITH CHECK` guard). [blind]
- [x] [Review][Patch] Add own-tenant positive-control assertions to both RLS suites — every test asserts only 0-rows/error; an RLS policy misconfigured to block ALL access would leave the whole adversarial suite green. [blind]
- [x] [Review][Patch] Add `, id` tiebreaker to `ORDER BY created_at` [classlite-api/internal/store/queries/jobs.sql:25-43; 20260728140000_create_job_dispatch_functions.up.sql] — `ClaimNextJob` + `next_ready_job_center` have no secondary sort, so claim order among identical timestamps is nondeterministic (violates implied FIFO). [edge]
- [x] [Review][Patch] Fix misleading `down.sql` comments [classlite-api/migrations/20260728120000_create_jobs.down.sql:78; 20260728130000_create_ai_credit_ledger.down.sql:170] — both describe drop-ordering as protecting a `ref_job_id` **FK** that intentionally does not exist (it's a plain-uuid soft pointer); DDL is correct, comments self-contradict the up migration. [blind]
- [x] [Review][Patch] (from Decision 1) Add per-`(center,user)` lock to the ledger running-sum + fix the "under the row-lock" comment [classlite-api/internal/store/queries/ai_credit_ledger.sql:11-33; 20260728130000_create_ai_credit_ledger.up.sql:107-108] — `SELECT pg_advisory_xact_lock(hashtextextended(center||user,0))` before the `INSERT … SELECT SUM(change) ± 1` in both `InsertJobDeduction` and `RefundJob`, so no corrupt `balance_after` is ever written into the append-only ledger. [blind+edge+auditor]

_Deferred:_

- [x] [Review][Defer] No data-layer overspend/negative-balance guard [classlite-api/internal/store/queries/ai_credit_ledger.sql:11-20] — `InsertJobDeduction` always inserts `-1` with no non-negative guard; correct enforcement belongs in the service layer (graceful 402, not a DB `CHECK` that would raise 500). Verify service-layer guard in chunk 3. [blind+edge]
- [x] [Review][Defer] `JobRetryBackoffs[retry_count]` index-out-of-range [classlite-api/internal/model/job_types.go:415-419] — slice len 3, `MaxJobRetries=3`; indexing at `len` panics. Depends on the worker's `retry_count < MaxJobRetries` guard — verify in chunk 2; consider a clamped accessor. [edge]
- [x] [Review][Defer] `next_ready_job_center` discovery has no `FOR UPDATE SKIP LOCKED` [classlite-api/migrations/20260728140000_create_job_dispatch_functions.up.sql] — harmless with a single dispatcher (the `ClaimNextJob` claim is atomic), wasteful only with >1 dispatcher instance. Verify deployment model in chunk 2. [blind]

_Dismissed (noise / handled / false positive):_ append-only UPDATE/DELETE tests "depend on classlite_app role" — false positive, `helpers.go:60,97` connect as and `SET LOCAL ROLE classlite_app` so REVOKE genuinely trips; missing `CHECK` constraints — `type text` is intentional Epic-6 extensibility and the reason/change sign coupling cannot be violated by the controlled `-1`/`+1` queries; `SumCenterUserBalance` not shipped — ratified 6.5 deferral in completion notes (YAGNI, no 4.3a consumer).

_Chunk-1 patch verification (2026-07-29):_ `sqlc generate` clean; `go vet ./...` clean; `gofmt` clean on both edited test files. `go test ./internal/test/ -run 'RLS_Job|AICreditLedger'` → 16/16 PASS (incl. new P2 CrossTenantDelete, P4 ReparentRejected, P3 UnsetTenant, P5 positive controls); `go test ./internal/worker/` PASS (exercises the P8 advisory-lock `InsertJobDeduction`/`RefundJob` + P1-guarded `MarkJob*` at runtime). ⚠️ **P8 required a fix**: casting `@center_id::text` for the lock key made sqlc infer the param as `text` and broke `WHERE center_id = @center_id` (`uuid = text`) — resolved by typing the params in a `k AS MATERIALIZED (SELECT @center_id::uuid …)` CTE and hashing the *column*. ⚠️ **Re-migration note**: the P6 tiebreaker on `next_ready_job_center` edits migration `20260728140000` (an already-applied, not-yet-committed same-story migration); the local dev DB must re-run `migrate.sh` down+up for it to take effect (the `ClaimNextJob` tiebreaker took effect immediately via sqlc; the SECURITY-DEFINER function is not exercised by the harness so tests stay green either way). Generated `store/generated/` refreshed via `sqlc generate` — include in the commit (WF-3).

### Review Findings — Chunk 2 of 3 (Async pipeline)

`internal/worker/*`, `internal/gemini/*`, `main.go` wiring, `config.go`, `harness.go` in-memory→DB migration, `.env.example`, `manual-setup.md`. `/bmad-code-review` 2026-07-29 — Blind Hunter + Edge Case Hunter + Acceptance Auditor. Verified against source (`dispatcher.go`, `ai_generate.go`, `main.go`). 1 decision, 8 patch, 5 defer, 3 dismissed.

_Decision-needed:_

- [x] [Review][Decision→Patch] **RESOLVED (Ducdo 2026-07-29): SPLIT the claim into its own committed tx** (robust option). Production `drainReady` becomes claim-commit (tx1) → process+complete/fail (tx2); a panic/error in tx2 leaves the row committed-`processing` → the now-functional stuck-sweep terminal-fails+refunds it (poison-pill gone, AC7 sweep real). Requires conditional refund (P18). ⚠️ **Scoped deferral:** fully freeing the pooled connection *during* the Gemini call needs a 3-phase `GenerationHandler` interface split (read-phase / Gemini-phase / complete-phase) — large refactor, **deferred to a hardening FU**; the conn is held during Gemini exactly as before, just decoupled from the claim. Implemented as P17 (tx split) + P18 (conditional refund). Original finding retained below for context.
- [ ] [Review][Decision-context] **Transaction architecture — claim + Gemini call + complete/fail all run in ONE tx** (`dispatcher.go` `runInTenantTx`+`processOnce`; `ClaimNextJob` at L87 → handler at L110 → `MarkJobComplete`/`handleFailure`, deferred `Rollback` at L306). Verified consequences: **(a) poison-pill [Blind Critical]** — a handler panic → `runRecovered` returns error → rollback undoes the claim itself → job re-claimed and re-panics every tick forever; `retry_count` never advances, credit never refunded (the `recover()` prevents a crash but creates an infinite loop; currently no panic is reachable in default config once P10 lands, but the design is panic-fragile). **(b) AC7 stuck-sweep is dead code in prod [Edge Medium]** — `processing` is never committed standalone, so `FindStuckProcessingJobs`/`stuck_job_centers` never see it; the 5-min sweep only fires against the `ForceJobProcessingSince` test helper (single-tx IS self-healing — a crash rolls the claim back to `pending` — so nothing actually wedges). **(c) row-lock + pooled conn held for the entire Gemini call [Edge Medium]** — up to 3 conns pinned; the uncommitted `processing` is invisible to `next_ready_job_center`, so sibling claim loops busy-spin (~50 claim attempts/tick) on the same locked row. **(d)** gates the finding-#5 conditional-refund fix (a completed-then-swept job would get refunded = free generation — only reachable if the claim is committed separately).

_Patch — from the D3 resolution (split-tx):_

- [x] [Review][Patch] P17 — Split the production dispatch path: claim-commit (tx1) → process+complete/fail (tx2) [classlite-api/internal/worker/dispatcher.go `drainReady`/`runInTenantTx`/`processOnce`] — decouples the claim so a panic/error in tx2 leaves the row committed-`processing` for the (now real) stuck-sweep; removes the poison-pill infinite re-claim. Unit path (`ProcessOnce` on the harness tx) stays single-tx for deterministic tests.
- [x] [Review][Patch] P18 — Conditional refund [classlite-api/internal/store/queries/jobs.sql `MarkJobFailedTerminal`→`:execrows`; internal/worker/dispatcher.go `terminalFail`] — refund only when `MarkJobFailedTerminal` affected 1 row, so a completed-then-swept job (now reachable with the live sweep) is not refunded on top of a delivered result (free-generation). `RefundJob`'s unique-index idempotency stays as the second line of defense.

_Patch (safe regardless of the D3 choice; applied after D3):_

- [x] [Review][Patch] Commit with `context.WithoutCancel(ctx)` [classlite-api/internal/worker/dispatcher.go:316] — on shutdown, a job that finished generating currently commits on the cancelled `ctx` → fails → rollback → re-run on restart = double Gemini spend. `Rollback` (L306) already uses `WithoutCancel`; `Commit` must too. [blind+edge]
- [x] [Review][Patch] Backoff bounds guard [classlite-api/internal/worker/dispatcher.go:133-134] — guard `job.RetryCount < len(model.JobRetryBackoffs)` (or `min`), not just `job.MaxRetries` (a DB-controlled column); resolves chunk-1 DF2 — a row with `max_retries>3` currently panics on `JobRetryBackoffs[3]`. [blind+edge+auditor]
- [x] [Review][Patch] `io.LimitReader` cap on the Gemini response body [classlite-api/internal/gemini/client.go ~L608] — unbounded `io.ReadAll` OOMs the worker on a pathological upstream body. [blind+edge]
- [x] [Review][Patch] Send the API key via the `x-goog-api-key` header, not the `?key=` URL query param [classlite-api/internal/gemini/client.go ~L589] — removes the secret from the URL (proxy/LB/APM logs) and from the `%w`-wrapped `NewRequestWithContext` error (R49). [blind]
- [x] [Review][Patch] `nextReadyCenter` — log DB errors instead of collapsing them to "queue empty" [classlite-api/internal/worker/dispatcher.go:292] — a discovery-query failure currently presents as a silently idle dispatcher (no processing, no alert). [edge]
- [x] [Review][Patch] Recover around the discovery-loop bodies [classlite-api/internal/worker/dispatcher.go `drainReady`/`sweepAllTenants`] — only the per-job `fn` is `runRecovered`; a panic in `rows.Scan`/discovery runs in the loop goroutine with no recover → crashes the whole API process. [blind]
- [x] [Review][Patch] AC3 discrepancy logging [classlite-api/internal/worker/*] — AC3 requires the payload `center_id` be "IGNORED **and logged as a discrepancy signal**"; the ignore half holds (handlers never read `CenterIDClaim`) but nothing compares payload-vs-row and logs a mismatch. Add the compare+`slog.Warn` (attack-detection signal). [auditor]
- [x] [Review][Patch] Reclassify transient infra errors as retryable [classlite-api/internal/worker/dispatcher.go `handleFailure`; ai_generate.go:206] — a transient DB error (pool exhaustion/deadlock) during the pre-Gemini exercise read is neither `ErrTransientGeneration` nor `ErrInvalidAIResponse` → `handleFailure` marks it terminal (`generation_failed`) + refunds, permanently failing a job that would succeed on retry. Route `NotFoundError` → terminal; other unexpected/store errors → transient (retry with backoff). [blind+edge]

_Deferred:_

- [x] [Review][Defer] Permanent Gemini conditions fail slow [classlite-api/internal/gemini/client.go:603-621] — a bad/blocked key (4xx) or content-filter empty-candidate block is wrapped as `ErrTransientGeneration` → 3 wasted retries over 30/60/120s before terminal. Bounded waste (eventually terminal+refund); fast-fail is an enhancement. [blind+edge]
- [x] [Review][Defer] Dev empty-key wires the real client [classlite-api/cmd/api/main.go:45-51] — local dev without `GEMINI_API_KEY` hits Gemini with `key=` → every generation fails+refunds; add a mock fallback in dev. Dev ergonomics, not prod correctness. [blind]
- [x] [Review][Defer] Harness `ProcessSpecific` state-machine fidelity [classlite-api/internal/test/workers/harness.go] — the DB-backed harness jumps `pending→complete/failed` unguarded, so the Pattern 1-3 adversarial grid validates handler tenant-scoping but never exercises `ClaimNextJob`/`processing`/the status-guarded terminal writes (those ARE covered by `dispatcher_skiplocked_test`, the real-`ProcessOnce` refund matrix, and the chunk-1 RLS tests). [edge]
- [x] [Review][Defer] `TestRefund_DoubleAttemptIsNoOp` doesn't attempt a real 2nd refund [classlite-api/internal/worker/credit_refund_atdd_test.go] — after max-retries the job is `failed`, so the follow-up `SweepStuckJobs` (queries `processing`) never reaches `RefundJob`; idempotency is actually proven at the SQL seam (chunk-1 `TestAICreditLedger_DoubleRefundIsNoOp`). Test-strength nit. [blind+auditor]
- [x] [Review][Defer] DF3 (chunk 1) `next_ready_job_center` no `SKIP LOCKED` — **VERIFIED correctness-safe across 1..N instances** (`ClaimNextJob`'s `FOR UPDATE SKIP LOCKED` hands the row to exactly one claimer; losers get `ErrNoRows`); `main.go` wires exactly one dispatcher instance (3 in-process claim loops). Perf-only (redundant discovery) and entangled with the D3 busy-spin issue; revisit if D3 → split-tx or >1 instance is deployed. [blind+edge]

_Dismissed (noise / handled / covered):_ distractors mapping puts a QuestionGroup-type constant in `Question.Type` (works — the string values coincide; nit) [auditor]; carrier-section mapping "may fail the validator" — the green `ai_generate`/`credit_refund` worker tests prove the map→`ValidateExerciseContentStructural` path passes for all three supported modes [blind, unverifiable-while-blind]; "API key in URL is inherent to Gemini" — superseded by patch P12 (moving it to the header). [blind]

_Chunk-2 patch verification (2026-07-29):_ `sqlc generate` clean (`MarkJobComplete`/`MarkJobFailedTerminal` now `:execrows`); `go build ./...`, `go vet`, `gofmt` all clean. **Full `go test ./...` → 12/12 packages PASS** (incl. `internal/handler`, so the earlier `TestLoginHandler` failure was confirmed a flake). Worker suite 16/16 PASS — the refund matrix (`TestRefund_OnMaxRetriesExhausted`/`OnInvalidAIResponse`/`OnStuckProcessingSweep`/`NoRefund_OnComplete`/`DoubleAttemptIsNoOp`) exercises the new conditional-refund path, and `TestClaimNextJob_SkipLockedDisjoint` + the tenant-isolation grid still pass under the claimJob/processClaimed split. **P17/P18 design notes:** production `drainReady` = `claimJob` (tx1, commits `processing`) → `processClaimed` (tx2, panic-recovered, commits with `WithoutCancel`); a panic/error in tx2 leaves the row committed-`processing` for the now-live stuck-sweep (no poison-pill), and a committed-`processing` row is invisible to `next_ready_job_center` (also kills the sibling busy-spin). `terminalFail` refunds only when `MarkJobFailedTerminal` affected 1 row (no free-generation on a completed-then-swept job); `RefundJob`'s unique index is the 2nd line of defense. Unit path (`ProcessOnce` on the harness tx) stays single-tx. **Deferred (new FU-4-3-A-2):** freeing the pooled connection *during* the Gemini call (3-phase handler split) — logged to `deferred-work.md`.

### Review Findings — Chunk 3 of 3 (API surface)

`api.yaml`, `ai_generation_handler.go` (+ATDD), `ai_generation_service.go`, `story_4_3a_helpers.go`, generated `client.ts`. `/bmad-code-review` 2026-07-29 — Blind Hunter + Edge Case Hunter + Acceptance Auditor. Verified against source. 2 decision, 4 patch, 3 defer, 2 dismissed. **DF1 (chunk-1 overspend) verdict: CONFIRMED overspend possible but a DOCUMENTED, intended pre-6.5 deferral** — `EnqueueGeneration` inserts `-1` with no balance check; api.yaml correctly omits 402; the hard credit gate is Story 6.5. No action (honored deferral).

_Decision-needed (both RESOLVED 2026-07-29, Ducdo):_

- [x] [Review][Decision→Patch] **Poll endpoint has NO role/user authorization** — RESOLVED: **strict per-creator** (P23). Added a nullable `created_by` column to `jobs` (migration edited — re-migrated locally), `InsertJob` sets it to the enqueuing user, and `GetJobByID` filters `created_by = @caller` → a different user in the same tenant (incl. a student) gets 404 JOB_NOT_FOUND (no oracle). New test `TestPollJob_CrossCreatorSameTenant_404`.
- [x] [Review][Decision→Patch] **429 documented but no rate limiting wired** — RESOLVED: **wire the limiter now** (P24). Added `middleware.RateLimitByKey("ai-generate", rate.Every(3s), 20, UserAndIPKeyFn)` on a dedicated `aiChain` (after requireCenter so the user id is in context), per SEC-10; emits Retry-After matching the documented 429.
- [ ] [Review][Decision-context] **Poll endpoint has NO role/user authorization** [classlite-api/internal/service/ai_generation_service.go `GetJob`; handler `PollJob`] — `GetJob` runs `GetJobByID` under RLS tenant scope only; `exerciseChain` = extractTenant→requireVerified→requireCenter (no `RequireRole`), and `GetJob` does no `assertClassRole`. So any verified center member — **including a student** — can `GET /api/jobs/{jobId}` and read the unpublished AI `result` (answers/distractors). Asymmetric with the enqueue, which is teacher-scoped via `assertExerciseTeacherScope`. `jobs` has **no `created_by` column** (only `center_id`), so per-creator scoping needs a schema change. Options: (1) role-gate the poll to staff (reject `student` in `GetJob` via the DB-resolved `tc.Role`) — minimal, no migration; (2) add `created_by` to `jobs` (chunk-1 migration + populate + scope `GetJob` to the creator) — strict per-user; (3) accept intra-tenant visibility + document. [blind High]
- [ ] [Review][Decision] **429 documented but no rate limiting wired** [classlite-api/api.yaml:59-64,98-103; cmd/api/main.go route wiring] — both endpoints declare `429 RATE_LIMIT_EXCEEDED`, but the chain has no limiter; **SEC-10 mandates `/api/ai/*` cost-based limits (20/min)** because enqueue triggers a paid Gemini call. A reusable `middleware.RateLimitByKey` exists. Options: (1) wire an AI rate limit now per SEC-10 (key IP+user, ~20/min) — recommended; (2) remove 429 from api.yaml + defer rate limiting to a FU (credits are the interim cost control). [blind+auditor]

_Patch:_

- [x] [Review][Patch] P19 — Validate required param VALUES at enqueue [classlite-api/internal/handler/ai_generation_handler.go `buildJobParams`] — the `len(params)==0` gate passes for `{}`/`null`/typo'd bodies; `json.Unmarshal` fills a zero-value struct with no error → 202 + pending job + irreversible `-1` deduction for an unfulfillable job. Reject empty `topic` (section) / `sectionId` (questions) / `questionId` + non-positive/over-max `count` (distractors), and decode inner params strictly (`DisallowUnknownFields`). [blind+edge High]
- [x] [Review][Patch] P20 — `params_schema_version` from a dedicated job-params constant, not `store.CurrentExerciseSchemaVersion` [classlite-api/internal/service/ai_generation_service.go ~L490; model/job_types.go] — conflates the exercise-content schema line with the job-params line; both are 1 today but the job-params version silently drifts to 2 when exercise content bumps (Story 4.5). Add a named `AIJobParamsSchemaVersion = 1`. [blind+auditor]
- [x] [Review][Patch] P21 — api.yaml contract/doc accuracy [classlite-api/api.yaml] — add `413` to `POST /ai-generate` (the handler's `MaxBytesReader`→`PayloadTooLargeError` is reachable but undocumented); correct the `errorDetails` description set to include `generation_failed`/`unknown_job_type` (chunk-2's pre-Gemini terminal path writes `generation_failed`, not in the current list). Regenerate `client.ts`. [blind+auditor]
- [x] [Review][Patch] P22 — Add typed `params` sub-schemas (discriminated by `mode`) + an `AIGenerationResult` schema to api.yaml so `client.ts` is typed for 4.3b [classlite-api/api.yaml + codegen] — T8 mandated the discriminated `AIGenerate{Section,Questions,Distractors}Params` + `AIGenerationResult`; currently `params`/`result` are `object additionalProperties:true` → `client.ts` gives `{[k]:unknown}`, defeating the backend-first split's purpose (freeze the typed seam 4.3b builds against). [auditor]
- [x] [Review][Patch] P23 (from Decision) — Strict per-creator poll: add nullable `created_by` to `jobs` (migration + `InsertJob` + `GetJobByID` `created_by` filter) so only the enqueuer reads a job's AI result [classlite-api/migrations/20260728120000_create_jobs.up.sql; store/queries/jobs.sql; service/ai_generation_service.go; test/story_4_3a_helpers.go]. ⚠️ re-migrate the dev DB (down×3 → up). [decision]
- [x] [Review][Patch] P24 (from Decision) — Wire the AI rate limiter (SEC-10) on a dedicated `aiChain` [classlite-api/cmd/api/main.go], `UserAndIPKeyFn`, ~20/min burst 20, emits Retry-After (the documented 429). [decision]

_Deferred:_

- [x] [Review][Defer] No request-level idempotency — a double-submit creates two jobs + two deductions [classlite-api/internal/service/ai_generation_service.go `EnqueueGeneration`] — each `InsertJob` mints a fresh uuid so the `(ref_job_id,reason)` idempotency never collides; likely intended (each enqueue is a distinct generation) but an accidental client retry double-charges. An `Idempotency-Key` header is an enhancement. [blind+edge]
- [x] [Review][Defer] Non-UUID `tc.CenterID`/`tc.UserID` → bare 500 [classlite-api/internal/service/ai_generation_service.go:464-471] — `uuid.Parse` failure returns an untyped error (GO-2/CQ-5: never bare 500). Only reachable if middleware (which already validates the ids) is bypassed — defense-in-depth. [edge]
- [x] [Review][Defer] No `Content-Type` enforcement on enqueue [classlite-api/internal/handler/ai_generation_handler.go] — JSON is decoded regardless of content type (no 415); consistent with sibling endpoints, minor. [blind]

_Dismissed (noise / handled / covered):_ `requireOwnerTenant` misleading name/docstring on this non-owner chain — functionally correct (role enforced in the service via `assertClassRole`); it's a shared helper (`term_handler.go`) so renaming touches unrelated call sites (out of scope) [blind+auditor]; the `default: INVALID_MODE` branch in `buildJobParams` is "unreachable" — it's an idiomatic defensive switch default (a new mode added to the map but not the switch would be caught), not dead code [blind]. DF1 (overspend) — documented intended 6.5 deferral, verified in api.yaml + package docs + memory.

_Chunk-3 patch verification (2026-07-29):_ `scripts/codegen.sh` clean (sqlc + openapi-typescript → `client.ts` regenerated with typed `AIGenerate{Section,Questions,Distractors}Params` + `AIGenerationResult`, 7 refs); `go build ./...`, `go vet`, `gofmt` clean; web `tsc --noEmit` clean (WF-6). **Full `go test ./...` → 12/12 packages PASS**, including the new `TestPollJob_CrossCreatorSameTenant_404` (teacher B + student → 404, creator → 200) and the existing enqueue/poll/scope ATDD suite. **P23 required a dev DB re-migration** (`migrate.sh down×3 → up`) since `created_by` was added by editing the not-yet-committed `create_jobs` migration; this also applied the earlier chunk-1 P6 (`next_ready_job_center` tiebreaker) + P8 (ledger comment) migration edits. `created_by` is nullable + `ON DELETE SET NULL`; production always sets it, `GetJobByID`'s filter fails closed (NULL ≠ any real user → 404). P22 used a `oneOf` on `params` + a nullable `allOf`-wrapped `AIGenerationResult` ($ref `ExerciseContent`). ⚠️ **Commit must include the regenerated `client.ts` + `store/generated/`** (WF-1/WF-4 atomic: api.yaml → codegen → backend → the frozen client 4.3b consumes).

## Dev Notes

### ATDD Artifacts (RED phase — generated 2026-07-28 via `/bmad-tea AT`, Murat)

WF-8 gate satisfied: red acceptance tests for the risk-≥6 ACs (AC3/AC7/AC8) exist on the branch **before** this story moves to `in-progress`. All scaffolds are gated behind `//go:build atdd_red` (Go equivalent of `test.skip()`): default `go build/vet/test ./...` stay GREEN; the red target is `go test -tags atdd_red ./...`, which fails until the impl lands. Dev strips the tag file-by-file as each AC goes GREEN.

- Checklist + green-phase handoff (exact symbols to build): `_bmad-output/test-artifacts/atdd-checklist-4-3a-ai-content-generation-pipeline-backend.md`
- Worker (AC3/AC7/AC8): `classlite-api/internal/worker/ai_generate_atdd_test.go`, `credit_refund_atdd_test.go`, `secret_logging_atdd_test.go`
- Handler (AC1/AC2): `classlite-api/internal/handler/ai_generation_handler_atdd_test.go`
- Store RLS (AC9): `classlite-api/internal/test/jobs_rls_atdd_test.go`, `ai_credit_ledger_rls_atdd_test.go`
- Placeholder package stubs (delete when real source lands): `classlite-api/internal/worker/doc.go`, `internal/gemini/doc.go`

### Build constraints surfaced by ATDD (Amelia + Murat, 2026-07-29) — HONOR before green

Two seam decisions the red scaffolds bake in. Taking the scaffolds literally without these fails the build; both are cheap now, expensive mid-implementation.

- **BC-1 — Two opposite tx-ownership patterns; do not conflate them.**
  - **Enqueue service (AC1) OWNS its tx** — build `EnqueueGeneration` exactly like `ExerciseService` (`service/exercise_service.go:90,312-342`): take `db AuthDB`, `s.db.Begin(ctx)` → `SET LOCAL` → `generated.New(tx)`, do `InsertJob` + `InsertLedgerEntry(-1, job_deduction)` in that one tx.
  - **Worker handlers (AC3/AC4) RUN IN the caller's tx — never open their own.** The harness (`test/workers/harness.go` `ProcessSpecific`) already opened the tx and ran `SET LOCAL` from the **job row** `center_id` before calling `ProcessTask`; `harness_test.go`'s `inspectHandler` is the reference (holds the handle, queries it directly, no `Begin`). So `NewGenerate{Section,Questions,Distractors}Handler` takes a **`generated.DBTX`** (satisfied by both `*test.TxDB` and a real `pgx.Tx`) and issues ops directly on it. **Do NOT call `readInTenantTx`/`mutateInTenantTx` inside a handler** — a nested `Begin` + second `SET LOCAL` inside the dispatcher's tx is a PERF-1 hazard and double-scopes tenant context. (This is why the scaffolds' `newXHandler(t, h, mock)` pass `h.DB` — it is the already-scoped tx.)

- **BC-2 — Backoff clock must reach the SQL, or the MockClock retry tests can't go green.**
  - `ClaimNextJob`'s re-claim predicate (`WHERE next_attempt_at <= $now`) and the reschedule write MUST bind **`clock.Now()`** as a parameter — **never Postgres `now()`**. `credit_refund_atdd_test.go` advances the injected `MockClock` across 30s→60s→120s to make a failed job re-claimable; with SQL `now()` the advance is inert and `TestRefund_OnMaxRetriesExhausted` never terminates. Same rule for the stuck-sweep 5-min threshold (`FindStuckProcessingJobs` compares `started_at` against the bound `now`).

- **Note (not a gate):** the SKIP-LOCKED **contention** proof ("two claims → disjoint rows", T3/Testing-standards) can't run on the single-tx `SetupWorkerHarness` — it needs `SetupRawPool` + 2 goroutines. It's a green-phase concurrency test, out of the ATDD gate, but keep it on the T10 list.
- **Note (T9 dependency, already satisfied by the scaffolds):** post-T9 `jobs.center_id NOT NULL REFERENCES centers(id)` means `EnqueueJob` requires the center to exist first — every ATDD scaffold already seeds it via `CreateCenterWithID`; T9 must audit any *other* existing harness caller that enqueues without seeding a center, and ensure `JobStatus` reads status from the table.

### Scope decisions (why this shape)

1. **Split backend-first; 4.3b consumes the contract (Ducdo).** The risk (R3/A7 score 9, R23/A6, R49 — all ≥6) is concentrated in the async path. Landing it independently makes the score-9 worker-tenant surface reviewable on its own, and gives 4.3b a frozen `client.ts` to build against. 4.3b is HARD-BLOCKED until this is `done`.
2. **`ai_credit_ledger` is minted here, per A6 — not deferred to 6.5 (Ducdo).** The AC (`epic-04.md:117`) *requires* ledger rows in-tx; deferring the table would make the AC unsatisfiable and leave R23 unmitigated. The schema already exists (A6/`blocker-resolutions-2026-06-04.md`) — 4.3a is simply its first consumer. 6.5 adds the rest of the reasons + balance cache + UI. This is the same "a prior artifact already defines the canonical shape" posture as the exercise-content co-development in 4.1/4.2.
3. **`center_id` on the job row is the ONLY tenant trust anchor (R3/A7).** The harness enshrines this (`harness.go:57-64,114-120`): the worker reads `center_id` from the row and `SET LOCAL`s it before any handler DB op; a payload `center_id` is logged as a discrepancy and ignored. This is the async GO-1 — forgetting it is a silent cross-tenant leak that compiles clean.
4. **The worker produces a result fragment; it never mutates the exercise.** Generation writes `jobs.result`; the teacher inserts via 4.3b's preview→accept (which rides 4.2's autosave PATCH, already `ValidateExerciseContentStructural`-gated). This keeps the worker side-effect-free on the exercise and makes "preview before insert" (FR-24/25/26) structural, not advisory.
5. **Refund idempotency is enforced by the DB, not by discipline (A6).** Unique `(ref_job_id, reason)` + `ON CONFLICT DO NOTHING` means the worker-terminal-fail path and the stuck-sweep can both attempt a refund and exactly one lands. N code paths agreeing by convention is how you double-refund silently.
6. **Reuse the generic queue for Epic 6.** The dispatcher dispatches by `type` string to a registered `JobHandler` (`architecture.md:486`) — `ai_grade_*` (Epic 6) slot in by adding a handler, no framework change. Don't special-case generation into the loop.

### jobs DDL (design — no column-level DDL exists in architecture; derived from harness `jobRow` + epic-04:100-105 + conventions)

```
CREATE TYPE job_status AS ENUM ('pending','processing','complete','failed');
CREATE TABLE jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id              uuid NOT NULL REFERENCES centers(id),   -- RLS scope + tenant trust anchor
  type                   text NOT NULL,                          -- ai_generate_section|questions|distractors (+ Epic 6 ai_grade_*)
  status                 job_status NOT NULL DEFAULT 'pending',
  params                 jsonb NOT NULL,
  params_schema_version  int  NOT NULL DEFAULT 1,                -- JSONB + schema_version companion (architecture.md:206,967)
  result                 jsonb,
  result_schema_version  int,
  error_details          text,                                   -- 'invalid_ai_response' | 'stuck_timeout' | provider msg
  retry_count            int  NOT NULL DEFAULT 0,
  max_retries            int  NOT NULL DEFAULT 3,
  next_attempt_at        timestamptz,                            -- retry backoff schedule (null = ready now)
  created_at             timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  completed_at           timestamptz
);
CREATE INDEX idx_jobs_status_created_at ON jobs (status, created_at);
-- RLS ON, policy USING (center_id = current_tenant_id()) with null-guard (0 rows when unset), mirror exercises.
```
`type` stays `text` (not a second enum) so Epic 6 adds job types without a migration — the epic explicitly wants "new job types by adding a handler" (`architecture.md:486`). Column set matches the harness's planned `jobRow` (`harness.go:74-83`) so the harness migration is mechanical.

### ai_credit_ledger DDL (A6 — blocker-resolutions-2026-06-04.md:74-90)

```
CREATE TABLE ai_credit_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL REFERENCES centers(id),          -- RLS scope
  user_id        uuid NOT NULL REFERENCES users(id),
  change         int  NOT NULL,                                 -- -1 deduction, +1 refund, +N grant/purchase (6.5)
  reason         text NOT NULL CHECK (reason IN
                   ('monthly_grant','job_deduction','job_failed_refund','addon_purchase','admin_adjustment')),
  ref_job_id     uuid REFERENCES jobs(id),                      -- nullable
  ref_purchase_id uuid,                                         -- nullable (6.5)
  balance_after  int  NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ai_credit_ledger_job_reason ON ai_credit_ledger (ref_job_id, reason)
  WHERE ref_job_id IS NOT NULL;                                 -- idempotency (double-refund no-op)
CREATE INDEX idx_ai_credit_ledger_read ON ai_credit_ledger (center_id, user_id, created_at DESC);
-- RLS ON, INSERT-only policy (no UPDATE/DELETE) — mirror auth_audit_logs (Story 1.3b, audit.go).
```
4.3a only writes `job_deduction`/`job_failed_refund`. `balance_after` is computed at insert from the running sum (the enqueue/refund tx reads the latest balance under the row lock); the balance *cache* + reconciliation cron are 6.5. **4.3a does NOT hard-block enqueue on balance** — the 402 credit-limit gate is 6.5 (FU-4-3-A); a `-1` may drive balance negative in 4.3a and that's acceptable pre-6.5 (single-owner test tenants).

### Worker / dispatcher design

- **Precedent to copy, not the impl:** `email_retry.go` is channel-based in-memory; 4.3a is **DB-backed** (`SELECT … FOR UPDATE SKIP LOCKED`). Reuse its *shape*: `Start(ctx)` loop with `select { case <-ctx.Done(): return … }`, per-job panic-recovery (`callSenderRecovered`, `email_retry.go:170-177`), `clock.Clock` injection for deterministic backoff tests. Reuse the main.go wiring: `workerCtx, cancelWorker := context.WithCancel(...)` already exists at `main.go:107` with `go retryQ.Start(workerCtx)` at `:108` — add `go dispatcher.Start(workerCtx)` beside it; `cancelWorker()` in the shutdown block drains it.
- **Tenant context in production (the SEC-6 hole architecture never spelled out):** the dispatcher, after `ClaimNextJob`, must open the job's tx, `SET LOCAL app.current_tenant_id = <row.center_id>`, build `model.TenantContext{CenterID: row.center_id}`, THEN call `handler.ProcessTask`. The harness's `ProcessSpecific` (`harness.go:161-176`) is the exact reference for what production must do.
- **Two ticks:** a fast claim tick (poll for ready jobs) and a slower stuck-sweep tick (5-min `FindStuckProcessingJobs`). Both honor `ctx.Done()`.

### Reuse map — build on, do not reinvent

- **Worker contract + tests:** `internal/test/workers/harness.go` (`SetupWorkerHarness`, `JobHandler`, 3-pattern), `harness_test.go`. **Migrate its backing to the real table (T9).**
- **Worker loop precedent + wiring:** `service/email_retry.go:96-177` (Start/recover/clock); `cmd/api/main.go:107-108` (workerCtx), `:486-487` (svc/handler block to mirror), `:459-462` (`mux.Handle` route pattern), `:603-620` (graceful shutdown to extend).
- **Scope gates + content validation:** `service/exercise_service.go` `assertClassRole`(:367,403)/`assertTeacherScope`(404)/`readInTenantTx`(:312)/`mutateInTenantTx`(:330)/`Update`(:601) + `store.ValidateExerciseContentStructural` (wired at `exercise_service.go:624`) — the AI fragment must pass it. v1 `ExerciseContent`/`Section`/`QuestionGroup`/`Question`/`Settings` in `store/exercise_content.go`.
- **Errors/envelope/audit:** `model/errors.go` (`NotFoundError{Resource,ID,Code}`, `ForbiddenError{Reason}`, `ValidationError{Fields}`, `ConflictError`, `GoneError`); `handler/response.go`; `middleware/error_mapper.go`; `internal/audit` `LogWithinTx`.
- **Config/test helpers:** `internal/config/config.go` (add Gemini env); `internal/test` `SetupDB`(RLS tx)/`TenantContext`/deterministic `TenantAID`/`TenantBID`; `internal/clock` `MockClock`; 4.1's `NewExerciseTestServerBareMux` + `SignAccessTokenForRole`; forged-JWT scope pattern `enrollment_handler_atdd_test.go:160-171`.
- **Append-only RLS precedent:** `auth_audit_logs` (Story 1.3b) for the ledger's INSERT-only policy.

### Testing standards summary

- **Mock seams (do not add others):** store interface in service unit tests; **`gemini.Client` interface** injected as `MockGeminiClient` in worker tests; real Postgres-in-tx everywhere else (TEST-BE-1..5). Never mock pgx. Real Gemini is banned from PR (`test-design-qa.md:57`).
- **ATDD (WF-8, red before in-progress):** AC3/AC7/AC8 worker + credit ACs.
- Worker: 3-pattern × 3 types (`SetupWorkerHarness`); retry/backoff + `invalid_ai_response`-not-retried via `MockClock`+`MockGeminiClient`; refund idempotency (unique-index no-op).
- Store: RLS read+write isolation both tables (TEST-BE-1); append-only ledger; `ClaimNextJob` SKIP-LOCKED contention (two claims → disjoint rows).
- Handler: enqueue 202 + ledger −1 through real middleware; cross-teacher 404 / student 403; poll typed envelope; enqueue-doesn't-call-Gemini.
- R49: log-capture assertion (no key/prompt/response). NFR: enqueue p95 <200ms (bench or note as k6/observability follow-up).

### References

- [Source: epics/epic-04.md#Story-4.3] — ACs (109-123): enqueue+poll (110-112), preview (113 → 4.3b), section/question/distractor (114), SKIP LOCKED (115), **worker harness + 3 patterns / R3-A7 (116)**, **ledger −1/+1 + idempotency / R23-A6 (117)**; Failure-Path ACs (119-123): stuck-5min (120→4.3b UI + AC7 sweep), retry 30/60/120 max-3 (121), max-retries-fail (122), invalid_ai_response-not-retried (123).
- [Source: prds/prd-classlite_new-2026-05-26/prd.md#FR-24..FR-26] — AI section (446-452, preview + est-cost + credit-counter), question (454-458), distractor (460-464) generation.
- [Source: architecture.md] — job queue + SKIP LOCKED + state machine (208), `job_status` enum (307), worker-as-peer/PERF-3 (917,952), dispatch-by-type (486), job types incl. ai_generate_* (478-486), Gemini in worker + credits-in-billing (1015), grading flow 202+poll 2/4/8s (246), JSONB+schema_version (206,967), migration/sqlc conventions (712,935,682), file locations (700-707), SEC-6 note (gap — worker re-establishment not spelled out).
- [Source: classlite-api/internal/test/workers/harness.go] — `JobHandler.ProcessTask` (62), 3-pattern (14-28), `center_id`-trust-anchor (57-64,114-120), `ProcessSpecific` tenant-from-row (161-176), **in-memory→table migration mandate (30-38)**, planned `jobRow` (74-83).
- [Source: _bmad-output/test-artifacts/test-design/blocker-resolutions-2026-06-04.md] — A6 ledger schema + refund matrix + invariants (70-111), A7 harness contract + 3 patterns (34-50).
- [Source: _bmad-output/test-artifacts/test-design/{test-design-architecture.md,test-design-qa.md,test-design-progress.md}] — R3(123)/R23(139)/A6-A7(70,74)/R49(147) risk rows; P0-313..320/391..395/441..445; INT-WRK-001..010; NFR enqueue-p95<200ms, pool-3, retry 30/60/120, mock-Gemini-in-PR.
- [Source: classlite-api/internal/service/email_retry.go] — worker Start/recover/clock precedent (96-177); [cmd/api/main.go] — workerCtx (107-108), svc/route/shutdown patterns (459-462,486-487,603-620).
- [Source: 4-1-… / 4-2-… stories] — v1 `ExerciseContent` co-developed shape; `assertTeacherScope`/`assertClassRole`; `ValidateExerciseContentStructural` (4.2 Decision B).
- [Source: docs/project-context.md] — GO-1/2/4/5/7, GFW-1/2/5, SEC-6/9, EDGE-4, PERF-3, XL-1/2, CQ-3/4, WF-1/2/3/4/9, TEST-BE-1..5.

## Definition of Done

- [x] ATDD red tests for AC3/AC7/AC8 existed on the branch before `in-progress` (WF-8); all now green.
- [x] `jobs` + `ai_credit_ledger` migrations applied; both RLS-isolated with null-guard; ledger append-only; unique `(ref_job_id, reason)`; `job_status` enum shared.
- [x] Enqueue = single tx {job insert + `-1` `job_deduction`} → **202** `{jobId}`; scope-gated (403/404, no-oracle); does NOT call Gemini; p95 <200ms (measured or noted).
- [x] Dispatcher claims via `SELECT … FOR UPDATE SKIP LOCKED`, re-establishes tenant context from the **job row** `center_id` before any handler DB op, panic-recovers per job, drains on `cancelWorker()`; pool 3.
- [x] 3 `ai_generate_*` handlers: typed Gemini parse → map → `ValidateExerciseContentStructural` → `jobs.result`; **worker never mutates the exercise**; retry 30/60/120 max-3; **`invalid_ai_response` terminal, not retried**.
- [x] Refund `+1` `job_failed_refund` in the terminal-fail/stuck-sweep tx, **idempotent** (double-refund no-op); no refund on complete; stuck-sweep marks failed.
- [x] Worker harness migrated in-memory→real table, **public API unchanged**, `harness_test.go` green.
- [x] `GEMINI_API_KEY`/prompt/response never logged (service assertion green; CI grep-scan noted); key + `GEMINI_MODEL` in config + `.env.example` + `docs/manual-setup.md`.
- [x] Worker 3-pattern × 3 types green; credit-ledger + idempotency + retry/backoff + RLS-isolation + handler-integration tests green. `go test ./... && go vet ./... && gofmt -l` clean.
- [x] `api.yaml` two endpoints + schemas; `codegen.sh` last (Go + `client.ts` + Zod); FU-4-3-A logged. Dev record in sibling completion-notes.

## Out of Scope

- **s17 `AIGenerateDialog` + polling hook (2/4/8s) + preview/accept/edit/dismiss + credit counter UI + i18n** → **Story 4.3b** (this story delivers the endpoints + `client.ts` it consumes).
- **The 402 hard credit-limit gate on enqueue, monthly grant / add-on purchase / admin adjustment reasons, balance cache + nightly reconciliation cron, Settings→Credits UI** → **Story 6.5** (4.3a mints the table + −1/+1 refund only; enqueue does not block on balance).
- **AI grading jobs (`ai_grade_writing`/`ai_grade_speaking`)** → **Epic 6** (reuse this dispatcher — add handlers, no framework change).
- **From-Knowledge-Hub source-material attachment** (the s17 "drag a Hub document") → **Story 4.4**; 4.3a params take free-text topic/material only.
- **JSONB lazy version-dispatch upgrade** for `jobs`/ledger blobs → **Story 4.5** (4.3a stamps `schema_version=1`).
- **User-initiated cancel of an in-flight job** (and its refund rule) → deferred with 4.3b/Epic-6 (4.3a refunds only on system-terminal-fail + stuck-timeout).

## Change Log

| Date | Change |
|---|---|
| 2026-07-29 | **Implemented (review).** All T1–T11 + DoD complete. Migrations (jobs + append-only ai_credit_ledger + 2 SECURITY-DEFINER dispatch fns), SKIP-LOCKED dispatcher + main.go wiring + graceful shutdown, 3 ai_generate_* handlers, gemini.Client (real REST + mock), enqueue(202)+poll endpoints, harness in-memory→DB (public API unchanged). ~34 ATDD tests green (tags stripped) + SKIP-LOCKED contention companion; `go test ./...` 12pkg/0fail, `go vet`/`gofmt` clean, FE `tsc` clean. Two ratified deviations: `ai_credit_ledger.ref_job_id` soft pointer (not A6 FK — append-only correctness) + unique index full-not-partial (ON CONFLICT inference); `SumCenterUserBalance` deferred to 6.5 (no 4.3a consumer). Dev record → sibling completion-notes; FU-4-3-A logged. |
| 2026-07-28 | Story created (ready-for-dev). **Split from 4.3** (Ducdo): 4.3a = backend AI pipeline — `jobs` + `ai_credit_ledger` tables, `SELECT FOR UPDATE SKIP LOCKED` dispatcher + main.go wiring + graceful shutdown + harness in-memory→DB migration, 3 `ai_generate_*` handlers, `gemini.Client` (mock-injected), enqueue(202)+poll endpoints, deduct(−1)/refund(+1)-idempotent ledger. **`ai_credit_ledger` minted here per A6, not deferred to 6.5** (Ducdo). Touches R3/A7(9), R23/A6(6), R49(6) — ATDD MANDATORY before in-progress (WF-8). 4.3b (s17 dialog) HARD-BLOCKED on this. |
