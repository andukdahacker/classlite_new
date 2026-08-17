---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-14'
storyId: '5.5a'
storyKey: '5-5a-submission-result-view-pending-and-playback'
storyFile: '_bmad-output/implementation-artifacts/5-5a-submission-result-view-pending-and-playback.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-5-5a-submission-result-view-pending-and-playback.md'
generatedTestFiles:
  - 'classlite-api/internal/service/submission_review_service_test.go'
  - 'classlite-api/internal/service/storage_presign_owned_test.go'
  - 'classlite-api/internal/handler/submission_review_handler_atdd_test.go'
  - 'classlite-web/src/features/submission-review/__tests__/SubmissionReviewPage.red.tsx'
  - 'classlite-web/src/features/submission-review/__tests__/readback.red.tsx'
  - 'classlite-web/src/features/submission-review/__tests__/audioPlayback.red.tsx'
  - 'classlite-web/src/features/submission-review/__tests__/entryPoints.red.tsx'
editedSupportFiles:
  - 'classlite-api/internal/service/storage_mock.go'  # +PresignGetKeys / +LastPresignGetExpiry spy (inert)
redPhaseMechanism: 'go build-tag atdd_red_phase (backend) + .red.tsx include-glob exclusion (frontend) — NOT test.skip (symbols do not exist yet, so skip cannot compile/load)'
inputDocuments:
  - '_bmad-output/implementation-artifacts/5-5a-submission-result-view-pending-and-playback.md'
  - '_bmad-output/project-context.md'
  - 'classlite-api/internal/service/attempt_view.go'
  - 'classlite-api/internal/service/attempt_service.go'
  - 'classlite-api/internal/service/submission_service.go'
  - 'classlite-api/internal/service/file_service.go'
  - 'classlite-api/internal/service/storage.go'
  - 'classlite-api/internal/service/storage_mock.go'
  - 'classlite-api/internal/service/file_errors.go'
  - 'classlite-api/internal/store/submission_content.go'
  - 'classlite-api/internal/store/queries/submissions.sql'
  - 'classlite-api/internal/test/story_5_2a_helpers.go'
  - 'classlite-web/vitest.config.ts'
  - 'classlite-web/src/features/writing-attempt/__tests__/WritingAttemptPage.test.tsx'
  - 'classlite-web/src/features/knowledge-hub/api/useFileDownloadUrl.ts'
  - 'knowledge/data-factories.md'
  - 'knowledge/test-quality.md'
  - 'knowledge/test-healing-patterns.md'
  - 'knowledge/test-levels-framework.md'
  - 'knowledge/test-priorities-matrix.md'
riskScore: 6
---

# ATDD Red-Phase Checklist — Story 5.5a (Submission Review: Pre-Grade Read-Back & Playback)

## Step 1 — Preflight & Context

### Stack & framework (detected)
- **Stack:** `fullstack` — Go 1.22 backend (`classlite-api`) + React 19 / Vite frontend (`classlite-web`).
- **Backend test framework:** Go `testing` + `test.SetupDB(t)` (tx-wrapped, auto-rollback), real middleware via `story_5_2a_helpers.NewStudentAttemptTestServerBareMux`, `MockStorageService` as the one storage seam. House ATDD suffix: `*_atdd_test.go` (handler) / `*_test.go` (service).
- **Frontend test framework:** **vitest + RTL + MSW + vitest-axe** — NOT Playwright. `tea_use_playwright_utils:true` in TEA config is **overridden by project reality** (TEST-FE-1: MSW is the only FE HTTP seam; Playwright exists only for a separate `e2e` script). Reds go under `src/features/submission-review/__tests__/`.
- Config flags: `test_stack_type:auto`→fullstack, `tea_browser_automation:auto`, `risk_threshold:p1`.

### Prerequisites — PASS
- Story `ready-for-dev` with 14 explicit ACs + a required RED-phase list (story §Testing standards).
- Backend + FE test configs present (`vitest.config.ts`, `test.SetupDB`, MSW server `@/test/msw-server`).
- Risk score **6** → WF-8 **hard rule: ATDD red-first MANDATORY on AC3/AC4 before `in-progress`.**

### Story-key / id
- `story_id = 5.5a`, `story_key = 5-5a-submission-result-view-pending-and-playback`.

---

## Preflight grounding findings (verified against HEAD `556ae05`)

### ★ T-VERIFY (gates AC9 stem scope) — **RESOLVED: STEMS ARE RETAINED**
`toAttemptQuestion` (`attempt_view.go:107-117`) whitelists `Text`/`Type`/`Options`. **`Text` IS the question stem.** `correctAnswer`/`acceptedVariants` are *structurally absent* from `AttemptQuestion` (whitelist mapper, not a blacklist).
- **Consequence:** AC9's "question stem beside each answer" is **cheap** — the quiz receipt reads `exercise.sections[].questionGroups[].questions[].text`. **Task 1 does NOT need to amend the strip.** (Also `AttemptQuestionGroup.instructions` and `AttemptSection.content` carry richer context if needed.)
- **Negative is inherent:** there is no `correctAnswer` field on the type to leak — the DOM-negative is structurally guaranteed; `attempt_read_test.go` golden is the backstop.

### ★ REUSE (de-risk Task 2) — the resolve query may already exist
`GetSubmissionByAssignmentStudent :one` **already exists** (`submissions.sql:8`). Task 2 proposes a "new `GetSubmissionByAssignmentAndStudent`". **Dev must verify** the existing query resolves the unique `(assignment_id, student_id)` row (used by idempotent start) and reuse it rather than adding a parallel query. If it returns only `in_progress`, a thin read-only variant is justified — otherwise reuse.

### Gate ladder to mirror (shared helpers — do NOT fork `GetAttemptBundle`)
`GetAttemptBundle` (`attempt_service.go:44-113`) order, all inside `readInSubmissionTx`:
1. `revalidateStudent(ctx, txQ, tc)` → `uuid` | `*ForbiddenError{"insufficient role"}` (→ 403 `INSUFFICIENT_ROLE`) — `submission_service.go:213-236`.
2. resolve submission by `(assignment_id, studentID)`; `pgx.ErrNoRows` → `submissionNotFound(id)` = `model.NotFoundError{Code:"SUBMISSION_NOT_FOUND"}` (→ 404).
3. **ownership BEFORE enrollment** — `sub.StudentID != studentID` → same 404 (no cross-student oracle).
4. load assignment **under the same tenant tx** (cross-tenant assignmentId must not leak it — B-2).
5. `assertActiveEnrollment(ctx, txQ, classID, studentID)` → `&NotEnrolledError{}` (→ 403 `NOT_ENROLLED`) — `submission_service.go:240-251`.
6. `toAttemptExercise(content,…)` answer-strip.
- **NOT lock-gated** (D6) — closed/past-deadline terminal still returns 200 read-only.
- **New for 5-5a:** `in_progress` short-circuit (D10) → 200 CTA payload, SKIP strip + presign; else strip; **commit tx → THEN `PresignGetOwned(audioKey?)` OUTSIDE the tx** (D9/PERF-1); assemble incl. `submission.id`.

### SEC-8 presign primitive to extract → `StorageService.PresignGetOwned`
`FileService.GetFileDownloadURL` (`file_service.go:466-508`) is the pattern:
- prefix guard `strings.HasPrefix(objectKey, tc.CenterID+"/")` else `KeyPrefixMismatchError{}` (`file_errors.go:60-65`, → 403 `R2_KEY_PREFIX_MISMATCH`).
- `downloadURLExpiry = 5 * time.Minute` (`file_service.go:70`).
- `storage.PresignGet(ctx, key, expiry, PresignGetOpts{})` (`storage.go:42`).
- Extract guard+presign as `PresignGetOwned(ctx, key, tc, expiry)`; refactor `GetFileDownloadURL` to call it (keeps its own `assertClassRole` upstream). SEC-8 in ONE auditable place (Winston STRONG).

### ★ TEST-INFRA GAP — presigner-spy needs a call recorder
`MockStorageService` (`storage_mock.go`) records `Deleted []string` but has **no `PresignGet` call recorder**. The B-1 / zero-mint-on-every-gated-failure reds require counting mints. **Add** (mirroring `Deleted`):
```go
// PresignGetKeys records every key passed to PresignGet, in call order —
// the zero-mint reds assert NO presign happened on a gated-failure path.
PresignGetKeys []string
```
append `key` inside `PresignGet` under the mutex. `PresignError` already lets a test simulate a signing failure. This is the seam that makes "presign guard and ownership gate are INDEPENDENT layers" testable (B-1).

### Content shapes (per skill, verified)
- Writing: `content = {schemaVersion:1, text}` (5.3 D1, plain text).
- Quiz (reading/listening/vocab): `content = {schemaVersion:1, answers, flagged}` (5.2b).
- Speaking: `content = {schemaVersion:1, audioKey, contentType, durationSec}` (5.4).
- `store.SubmissionContent` is an opaque `raw json.RawMessage` carrier (5.1); handler emits `RawJSON()` verbatim.

### FE precedents (house style — match exactly)
- **Trilogy:** `WritingAttemptPage.test.tsx` — `server` from `@/test/msw-server`, `createTestQueryClient`, `RouteRoleGate`, real `i18n`, `vitest-axe`, factory fns for `Submission`/`AttemptBundle` from `components['schemas']`, `SERVER_NOW` clock anchor.
- **On-demand presign hook:** `useFileDownloadUrl.ts` — `useQuery`, `staleTime = 4*60*1000` (< 5-min server expiry → auto-refetch when stale), `enabled` gate. Exactly `useSubmissionAudioUrl`'s shape (AC10).
- **Submission wire shape:** `{id, centerId, assignmentId, studentId, status, isLate, appliedPenalty, startedAt, submittedAt, timeBudgetSeconds, schemaVersion, content, createdAt, updatedAt}`.
- `submission-review` feature dir does **not exist yet** — reds define the target contract (RED by construction: imports won't resolve until dev builds it).

### Knowledge fragments loaded
Core: `data-factories`, `test-quality`, `test-healing-patterns`, `component-tdd`. Backend: `test-levels-framework`, `test-priorities-matrix`. (Playwright-utils profile skipped — project uses vitest/MSW, not Playwright, for these tests.)

---

## Step 2 — Generation Mode: **AI generation** (no browser recording)
- Backend security ACs (AC3/AC4) are the risk-6 core → always AI-gen from source + api.yaml contract.
- FE reds are vitest+MSW integration tests against a not-yet-existent feature dir (RED by construction); audio path uses synthetic `fireEvent.error` (jsdom never loads real media — Murat). Nothing to record.

---

## Step 3 — Test Strategy (risk-based AC → level → priority map)

**Level rule (project TEST-*):** business logic + security invariants at the **lowest** level that proves them. Backend seam = `MockStorageService` (storage) + real DB tx. FE seam = **MSW only**. No E2E for this story (Playwright reserved for separate `e2e`). No duplicate coverage: the presign SEC-8 invariant is proven once at the `PresignGetOwned` unit level; the gate ladder once at the service level; the HTTP envelope/status once at the handler level; UX at FE integration.

### P0 — risk-6 security core (RED-first MANDATORY before `in-progress`, WF-8)

| # | AC | Scenario (RED) | Level / File |
|---|----|----|----|
| P0-1 | AC3 | Own **terminal** submission → 200 + read-back bundle (`submission` incl. `id`, `assignment`, stripped `exercise`, `released:false`) + speaking `audioUrl` non-null & **prefix-valid** | service `submission_review_service_test.go` |
| P0-2 | AC3 | **B-1 same-center cross-student** submission id/assignment → **404 `SUBMISSION_NOT_FOUND`** AND **presigner-spy `PresignGetKeys` == 0** (ownership gate + presign guard are INDEPENDENT layers) | service |
| P0-3 | AC3 | **B-2 cross-tenant `assignmentId` IDOR** → **404** AND the assignment loader ran **under tenant RLS tx** (both reads scoped; the foreign assignment never leaks) | service RLS-adversarial |
| P0-4 | AC3 | Ownership checked **before** enrollment → non-owner gets 404 not 403 (no cross-student/class existence oracle) | service |
| P0-5 | AC3 | Non-student principal (teacher/owner/admin, stale JWT) → **403 `INSUFFICIENT_ROLE`** + zero mint | service + handler |
| P0-6 | AC3 | Withdrawn / never-enrolled owner → **403 `NOT_ENROLLED`** + zero mint | service |
| P0-7 | AC3 | No submission for `(student,assignment)` → **404** + zero mint | service |
| P0-8 | AC4 | `PresignGetOwned` valid prefix → signs a **GET** (not PUT); **TTL == 5*time.Minute as a literal**; returns URL | unit `storage_presign_owned_test.go` |
| P0-9 | AC4 | `PresignGetOwned` **foreign prefix** (key not under `tc.CenterID+"/"`) → **`KeyPrefixMismatchError`** (403 `R2_KEY_PREFIX_MISMATCH`), **zero mint** | unit |
| P0-10 | AC4 | **B-3 null/absent `audioKey`** (in_progress-speaking OR non-speaking) → `audioUrl: null`, **no 500**, zero mint | service |
| P0-11 | AC4 | **Presign runs OUTSIDE the read tx** (D9/PERF-1): tx committed before `PresignGetOwned` — assert order (spy timestamp / tx-closed hook), no PG tx held across signing | service |
| P0-12 | AC4 | **Zero-mint on EVERY gated-failure path** (403 role, 403 enrollment, 404 ownership, 404 missing) — parametrized spy assertion | service |
| P0-13 | AC4 | On-demand `GET /api/assignments/{id}/submission/audio` → **same gate ladder** + fresh 5-min GET mint; every gated failure → zero mint | handler `submission_review_handler_atdd_test.go` |
| P0-14 | AC4 | `FileService.GetFileDownloadURL` refactored onto `PresignGetOwned` → **parity** (still 5-min GET, still prefix-guards, still `assertClassRole` upstream) — no regression | unit |

### P1 — behavior & state integrity

| # | AC | Scenario (RED) | Level / File |
|---|----|----|----|
| P1-1 | AC3/D10 | **`in_progress` short-circuit** → 200 **CTA payload**; backend **SKIPS strip + presign** (spy 0; no stripped exercise) | service |
| P1-2 | AC3/D6 | Closed / past-hard-deadline **terminal** → still **200 read-only** (NOT lock-gated) — differential vs sibling `GetAttemptBundle` lock test | service |
| P1-3 | AC3 | Handler envelope: 200 → full `{data,meta}`; errors → full `{error:{code,message,requestId}}` (not just status) | handler |
| P1-4 | AC10 | Speaking **hybrid**: first paint uses inline `audioUrl` (no extra RTT); `<audio src>` == inline url | FE `audioPlayback.test.tsx` |
| P1-5 | AC10 | **Play-intent → on-demand refresh** when cached url >~4min (`useSubmissionAudioUrl`, staleTime 4min); shows "Loading your recording…" | FE audio |
| P1-6 | AC10 | Synthetic `fireEvent.error` on `<audio>` → **one** refresh; **second** error → **recoverable** "tap to try again" (never terminal unless mint 4xxs) | FE audio |
| P1-7 | AC1/AC7 | **Role-negative**: teacher/owner/admin → role-copy, review surface **absent from DOM** (not hidden); no `data-score` anywhere | FE `SubmissionReviewPage.test.tsx` |
| P1-8 | AC7 | **No grade data ANY state**: class-average AND band/per-question-score/correctness/released-feedback structurally absent from DOM (negatives) | FE page |

### P2 — UX trilogy, read-back, i18n/a11y

| # | AC | Scenario (RED) | Level / File |
|---|----|----|----|
| P2-1 | AC11 | Trilogy: **Loading = review-shaped skeleton** (`role=status`,`aria-busy`, not spinner) / success / error card (`role=alert`) | FE page |
| P2-2 | AC11 | Error routing: `404`→non-retryable "not started" + attempt CTA; `in_progress`→non-retryable "resume" CTA; `403`→non-retryable; retry only for transient/5xx | FE page |
| P2-3 | AC5/D12 | Identity = "Review my submission"; quiet "grades not released yet + you'll be notified" note (NOT a pending hero) | FE page |
| P2-4 | AC6 | On-time badge = explicit calm "Submitted on time"; late = "after the due date" + soft note; **assert NOT red/alarm** (`--cl-muted`); **no penalty number** | FE page |
| P2-5 | AC8 | Writing read-back: `content.text` read-only, `white-space: pre-wrap`, no toolbar/word-count | FE `readback.test.tsx` |
| P2-6 | AC9/D11 | Quiz **receipt**: stem beside each answer; framed "your submitted answers, grading not released"; **NOT a correctness grid**; **no `correctAnswer`/`acceptedVariants` in DOM** (negative) | FE readback |
| P2-7 | AC13 | Entry-point: `/assignments` terminal rows (`submitted`/`ai_processing`/`graded`) → link to `/assignments/{id}/submission`; both `SubmittedElsewhereOverlay` "View result" links repointed | FE `entryPoints.test.tsx` |
| P2-8 | AC14 | `axe` clean on every state (loading / per-skill read-back / not-started / not-submitted / error); focus-on-heading; `<title>` set; `<audio>` labelled | FE page + readback |
| P2-9 | AC14 | i18n `submissionReview.*` parity en+vi (`assertI18nParity`); VN-length on tightest mobile chrome | FE i18n (fold into page) |

### P3 — mobile split

| # | AC | Scenario (RED) | Level / File |
|---|----|----|----|
| P3-1 | AC12 | `useIsDesktop()` single-tree-per-breakpoint; mobile invests in `<audio>` (≥44×44, full-width) + writing reading-measure (≥16px) | FE page (mobile variant) |

### RED-phase guarantee
- **Backend**: reds call `service.GetStudentSubmissionReview` / the new handlers / `StorageService.PresignGetOwned` — **none exist yet** → compile-fail (RED). The `PresignGetKeys` spy field is the only inert test-infra add (compiles, stays 0 until wired).
- **Frontend**: reds import from `@/features/submission-review/*` — **dir does not exist** → RED. `useSubmissionReview`/`useSubmissionAudioUrl`/`SubmissionReviewPage`/read-back components are the contract the reds pin.
- **Contract (api.yaml)**: `StudentSubmissionResult` / `EnvelopeAudioUrl` schemas + the two paths don't exist → `components['schemas']` types absent → FE type-RED until Task 1 codegen.

### Target RED files (7)
1. `classlite-api/internal/service/submission_review_service_test.go` — P0 gate ladder + B-1/B-2/B-3 + zero-mint matrix + in_progress + differential-lock (+ RLS-adversarial read isolation).
2. `classlite-api/internal/service/storage_presign_owned_test.go` — P0-8/9/14 `PresignGetOwned` unit + `FileService` parity.
3. `classlite-api/internal/handler/submission_review_handler_atdd_test.go` — P0-5/13, P1-3 envelope/status/role/audio-endpoint.
4. `classlite-web/src/features/submission-review/__tests__/SubmissionReviewPage.test.tsx` — trilogy, negatives, role-neg, CTAs, identity, badge, axe, i18n, mobile.
5. `classlite-web/src/features/submission-review/__tests__/readback.test.tsx` — writing pre-wrap; quiz receipt+stem+not-a-grid+no-correctAnswer.
6. `classlite-web/src/features/submission-review/__tests__/audioPlayback.test.tsx` — hybrid inline+on-demand refresh+`fireEvent.error`+recoverable retry.
7. `classlite-web/src/features/submission-review/__tests__/entryPoints.test.tsx` — assignmentRow CTA + overlay repoint.
- Plus inert seam: extend `classlite-api/internal/service/storage_mock.go` with `PresignGetKeys` recorder.

---

## Step 4 / 4C — Generated RED scaffolds (aggregate)

**TDD phase: RED.** 7 test files (26 test scenarios) + 1 inert mock-spy edit. Execution: SUBAGENT (backend + frontend in parallel). Both verified: normal suites GREEN, activation → deterministic RED.

### Red-phase mechanism (repo-native — substitutes for `test.skip()`)
`test.skip()` is inapplicable: the target symbols/modules do not exist yet, so a skipped test still fails at compile/module-load. Mechanism used (matches Story 1.6's WF-8 red phase):
- **Backend:** `//go:build atdd_red_phase` (line 1). `go build ./...` + `go vet` GREEN (excluded). `go test -tags=atdd_red_phase ./...` → **compile-fails** on `undefined: GetStudentSubmissionReview / PresignGetOwned / test.NewSubmissionReviewTestServerBareMux` = RED. Dev removes the tag per-file, red→green.
- **Frontend:** `*.red.tsx` (outside the `*.{test,spec}` include glob). `vitest run` GREEN (2412 tests, reds not collected). `tsc --noEmit` → RED at `Cannot find module '@/features/submission-review'`, `StudentSubmissionResult` missing on schemas, `reviewCtaForRow` missing, `assignmentId` missing on `SubmittedElsewhereOverlayProps`. Dev renames `.red.tsx`→`.test.tsx` per-file, red→green.
- Assertions are REAL (no `expect(true).toBe(true)` placeholders).

### Files (RED)
**Backend (`//go:build atdd_red_phase`)**
1. `classlite-api/internal/service/submission_review_service_test.go` — P0-1..7, P0-10..12, P1-1, P1-2 (gate ladder, B-1/B-2/B-3, zero-mint matrix, in_progress short-circuit, not-lock-gated differential).
2. `classlite-api/internal/service/storage_presign_owned_test.go` — P0-8/9/14 (`PresignGetOwned` GET+5min+prefix-guard; `FileService` parity).
3. `classlite-api/internal/handler/submission_review_handler_atdd_test.go` — P1-3, P0-5(handler), 404-no-oracle, P1-1(handler), P0-13 (audio endpoint same ladder + zero-mint).
**Frontend (`*.red.tsx`)**
4. `…/submission-review/__tests__/SubmissionReviewPage.red.tsx` — P2-1/2/3/4, P1-7, P1-8, P2-8/9, P3-1.
5. `…/submission-review/__tests__/readback.red.tsx` — P2-5 (writing pre-wrap), P2-6 (quiz receipt+stem, not-a-grid, no-correctAnswer).
6. `…/submission-review/__tests__/audioPlayback.red.tsx` — P1-4/5/6 (hybrid inline+on-demand, synthetic `fireEvent.error`, recoverable retry).
7. `…/submission-review/__tests__/entryPoints.red.tsx` — P2-7 (`reviewCtaForRow` + overlay repoint).
**Support (inert, no tag):** `classlite-api/internal/service/storage_mock.go` — `PresignGetKeys []string` + `LastPresignGetExpiry time.Duration` recorded at `PresignGet` entry (the zero-mint spy).

### AC coverage → all 14 ACs have ≥1 RED scenario
- AC1/AC7 role-negative → P1-7; AC2/AC3 read contract + gate ladder → P0-1..7,P1-1..3; AC4 SEC-8 presign → P0-8..14; AC5 identity → P2-3; AC6 badge → P2-4; AC7 no-grade-data → P1-8; AC8 writing → P2-5; AC9 quiz receipt → P2-6; AC10 hybrid audio → P1-4/5/6; AC11 trilogy → P2-1/2; AC12 mobile → P3-1; AC13 entry-point/repoint → P2-7; AC14 i18n/a11y → P2-8/9.

### Contract pinned for the dev (honor these — reds assert on them)
- `SubmissionService.GetStudentSubmissionReview(ctx, tc, assignmentID) (StudentSubmissionReviewResult, error)`; result fields `Submission (.Row.ID)`, `Assignment`, `Exercise (AttemptExercise, zero when in_progress)`, `Released bool` (false), `AudioURL *string` (nil non-speaking/nil-key), `InProgress bool`. Handler JSON: `data.{submission,assignment,exercise,released,audioUrl,inProgress}`; audio endpoint `data.url`.
- `StorageService.PresignGetOwned(ctx, key, tc, expiry) (string, error)` — prefix-guard `tc.CenterID+"/"` else `KeyPrefixMismatchError{}`; GET presign; callers pass `5*time.Minute`. Dev must also add it to the mock in green phase so `PresignGet`'s recorder fires.
- **REUSE:** `GetSubmissionByAssignmentStudent :one` already exists (submissions.sql:8) — verify/reuse; do NOT add a parallel query.
- Handler test seam to create: `test.NewSubmissionReviewTestServerBareMux(t, pool) (http.Handler, *service.MockStorageService)` in a `story_5_5a_helpers.go` (mirror `NewStudentAttemptTestServerBareMux`).
- FE hooks: `useSubmissionReview(assignmentId)`, `useSubmissionAudioUrl(assignmentId, enabled)` (staleTime 4min). Components: `ResultWritingReadback({submission})`, `ResultQuizReceipt({submission, exercise})`, `ResultSpeakingPlayback({assignmentId, submission, audioUrl, audioUrlMintedAt})`. New `reviewCtaForRow(status, assignmentId)` on `assignmentRow.ts`; `assignmentId` prop on both `SubmittedElsewhereOverlay`s.
- Markers the reds bind: skeleton `role="status"`/`aria-busy`; badge `data-tone="muted"` on late (never `alarm`/`destructive`), no penalty number; DOM-negatives (no `[data-score]`, no class-average/band/score/correctness/feedback); quiz not-a-grid (no correct-column/checkmark cells); audio `submissionReview.audio.{label,loading,retry}` + recoverable (never `result-speaking-unavailable` on recoverable paths).
- i18n keys en+vi: `submissionReview.{heading, notReleased.note|horizon, status.onTime|late|lateNote, essay.label, answers.label|stem, audio.label|loading|retry, notStarted.title|body|cta, notSubmitted.title|cta, error.title|body|retry, back}` + `assignments.cta.reviewSubmission`.
- **Open dev choice:** the 404 not-started CTA destination is pinned only as "a link, no retry" (route left to dev).

## Task-by-task RED activation guide (dev, red→green)
| Story Task | Activate (remove tag / rename `.red.tsx`→`.test.tsx`) | Turn green by |
|---|---|---|
| Task 1 (api.yaml+codegen) | — (schemas make FE `tsc` red clear) | add `StudentSubmissionResult`/`EnvelopeAudioUrl` + 2 paths; codegen |
| Task 2 (Go svc + `PresignGetOwned` + handlers) | `submission_review_service_test.go`, `storage_presign_owned_test.go`, `submission_review_handler_atdd_test.go` | implement svc/primitive/handlers + `story_5_5a_helpers.go`; add `PresignGetOwned` to mock |
| Task 3 (FE hooks) | (part of page reds) | `useSubmissionReview`, `useSubmissionAudioUrl` |
| Task 4 (read-back cmps) | `readback.red.tsx`, `audioPlayback.red.tsx` | 3 read-back components |
| Task 5 (page+shell+states+mobile) | `SubmissionReviewPage.red.tsx` | page/shell/trilogy/mobile |
| Task 6 (route+entry+repoint) | `entryPoints.red.tsx` | `reviewCtaForRow` + route + overlay repoint |
| Task 7 (i18n+a11y) | (satisfies the axe/i18n asserts across page/readback reds) | `submissionReview.*` en+vi + a11y wiring |

**Per activated file:** confirm it FAILS first (RED), implement, confirm GREEN, then commit. Never delete a red assertion to make it pass.

---

## Step 5 — Validation & Completion

### Validation checklist
- [x] Prerequisites satisfied (story ready-for-dev, clear ACs, test frameworks present, risk-6 → WF-8 mandate).
- [x] Test files created correctly (7 reds + inert mock spy) at real paths.
- [x] Checklist maps every one of the 14 ACs to ≥1 RED scenario.
- [x] Red-phase scaffolds verified RED (repo-native mechanism, `test.skip` inapplicable — documented):
  - Backend: `go build ./...` + `go vet` exit 0 (GREEN); `go test -tags=atdd_red_phase ./internal/service ./internal/handler` → **build failed** on ONLY the undefined 5.5a symbols (`PresignGetOwned`, `GetStudentSubmissionReview`, `NewSubmissionReviewTestServerBareMux`).
  - Frontend: `vitest run` GREEN (2412 tests; `.red.tsx` uncollected — confirmed by `vitest list` exit 0); `tsc --noEmit` red points at the missing module/types/exports (the pinned contract).
- [x] Assertions are real (no placeholder `expect(true).toBe(true)`).
- [x] Story metadata + handoff paths captured (frontmatter + story `### ATDD Artifacts`).
- [x] No orphaned browser/CLI sessions (no browser automation used; stray `vitest list` reaped).
- [x] Artifacts in `_bmad-output/test-artifacts/` (not random locations).
- [x] Story file linked (`### ATDD Artifacts` under Dev Notes).

### Completion summary
- **7 RED files (26 scenarios) + 1 inert mock-spy edit.** All 14 ACs covered; P0 security core (AC3 gate ladder + AC4 SEC-8 `PresignGetOwned`, incl. Murat B-1/B-2/B-3 + zero-mint-every-gated-failure) is red-first, satisfying the WF-8 risk-6 gate to move to `in-progress`.
- **Key risk / assumption:** the reds PIN a plausible contract (result field names, hook/component/prop names, handler test seam `NewSubmissionReviewTestServerBareMux`, DOM/i18n markers). The dev conforms to these OR adjusts the reds deliberately — they are the contract, not incidental. B-2 cross-tenant + P0-11 outside-tx ordering assert intent; dev should ensure the RLS-tx-commit-before-presign ordering is genuinely exercised (see test comments).
- **De-risks banked:** T-verify → stems retained (AC9 cheap, no strip amend); `GetSubmissionByAssignmentStudent` already exists (reuse, no parallel query).
- **Next workflow:** `/bmad-dev-story 5-5a` (implement red→green per the activation table). After green: `/bmad-tea TA 5-5a` (expand P2/P3 + fixtures + DoD), then `/bmad-tea RV 5-5a` (test-quality review). Epic-boundary: `TR` → `NR` → `GATE`.

_ATDD RED phase COMPLETE._
