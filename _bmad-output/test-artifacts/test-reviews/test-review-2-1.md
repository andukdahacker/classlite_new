---
storyKey: '2-1'
storyPath: '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
reviewScope: 'directory'
detectedStack: 'backend-go'
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-quality-evaluation', 'step-03f-aggregate-scores', 'step-04-generate-report']
lastStep: 'step-04-generate-report'
lastSaved: '2026-07-02'
inputDocuments:
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume-completion-notes.md'
  - '_bmad-output/test-artifacts/atdd-checklist-2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-quality.md'
  - '.claude/skills/bmad-tea/resources/knowledge/data-factories.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md'
knowledgeFragments:
  - test-quality
  - data-factories
  - test-levels-framework
---

# Test Review — Story 2-1: Onboarding API

_Post-dev `/bmad-tea RV 2-1` on Opus 4.7 1M. Story 2-1 shipped a comprehensive backend test suite: 4 handler ATDD files, 3 service unit files, 1 J15 grid, 1 concurrent slug race, 1 helpers module. R1 (score 9) is the single highest-risk item this story owns; RV's job is to lock in flake defense so the R1 discharge stays green through Epic 2 story growth._

_Baseline: commit `9fcf512` (green + code-review pass merged to `origin/main`)._

## Step 1 — Context Loaded

**Scope**: directory (all story 2-1 test files under `classlite-api/internal/`).

**Stack**: backend-only (Go 1.22+, `stdlib net/http`, `pgx v5`, `sqlc`). No frontend changes. Playwright utils N/A.

**Knowledge fragments loaded**: `test-quality`, `data-factories`, `test-levels-framework`. UI-only fragments (`selector-resilience`, `network-first`, playwright-cli) skipped by profile detection — no `page.goto` / `page.locator` calls in scope.

**Story context**:
- R1 risk score 9 (highest in project) owned by this story — J15 grid discharge REQUIRED
- 10 ACs, 4 endpoints
- Test suite pre-review had already survived one adversarial code review pass (findings applied at commit `9fcf512`); RV zooms in on test-quality signals code-review doesn't optimize for (flake risk, isolation, cleanup, hidden assertions).

Ready to proceed to Step 2 — Discover Tests.

## Step 2 — Test Inventory

**Framework**: Go stdlib `testing` (native `t.Run` subtests, `testing.T.Cleanup`, `testify` NOT used — assertions are explicit `if got != want { t.Errorf(...) }`).

**Test files in scope** (11 files: 10 test + 1 helpers):

| File | Lines | Funcs | t.Run | Level | Isolation seam |
|---|---:|---:|---:|---|---|
| `handler/center_handler_atdd_test.go` | 392 | 8 | 0 | integration (ATDD) | `test.SetupDB(t)` (tx-rollback) |
| `handler/onboarding_handler_atdd_test.go` | 469 | 14 | 3 | integration (ATDD) | `test.SetupDB(t)` |
| `middleware/extract_tenant_context_test.go` | 222 | 6 | 0 | integration | `test.SetupDB(t)` |
| `middleware/require_verified_email_atdd_test.go` | 114 | 3 | 0 | unit | direct handler exercise |
| `service/center_test.go` | 78 | 3 | 0 | integration (AuthDB reuse) | `test.SetupDB(t)` |
| `service/mint_access_token_test.go` | 76 | 2 | 0 | unit | JWT signer directly |
| `service/onboarding_test.go` | 151 | 5 | 1 | integration (AuthDB reuse) | `test.SetupDB(t)` |
| `service/slug_atdd_test.go` | 101 | 3 | 1 | unit | pure function |
| `test/centers_slug_collision_race_test.go` | 138 | 1 | 0 | integration (concurrent) | `SetupRawPool(t)` + `PurgeUserAndOwnedCenters` |
| `test/onboarding_progress_rls_test.go` | 369 | 7 | 0 | integration (R1 J15 grid) | `test.SetupDB(t)` |
| `test/story_2_1_helpers.go` | 360 | 0 | 0 | (helpers) | n/a |

**Totals**: 52 test functions, 5 `t.Run` sub-tests, **zero `time.Sleep`**, **zero `t.Parallel()`** (correct — DB tests share tx via SetupDB per TEST-BE-2).

**Framework configs**:
- `test.SetupDB(t)` — canonical tx-wrapped seam (auto-rollback on t.Cleanup)
- `SetupRawPool(t)` — real-pool for concurrent scenarios; `PurgeUserAndOwnedCenters` for cleanup via superuser bypass
- `MockAccessTokenIssuer` (in helpers) — accessTokenIssuer stub for CenterService unit tests
- `brokenAuditLogger` (inline in center_handler_atdd_test.go) — proves AC6 tx atomicity by injecting a poisoned audit
- `newOnboardingSvc(t, db)` — thin per-test wrapper

**Coverage by AC** (from ATDD file comment blocks):
- AC1 persona: 5 tests (valid / 422 / idempotent / 401 / 403)
- AC2 center creation: 6 tests (happy / fresh token / seq double-post / concurrent double-post / 403 unverified / 422 empty name)
- AC3 progress upsert: 3 tests (upsert / 422 / updatedAt)
- AC4 progress read: 3 tests (existing row / default / join persona)
- AC5 slugify: AC5b Vietnamese matrix + length cap + RandomSuffix alphabet in `slug_atdd_test.go`
- AC6 audit: 2 tests (rollback via brokenAuditLogger / exact JSONB shape with entity_type+entity_id post code-review)
- AC7 RLS-substitute: 6-pattern J15 grid (P1 forgot filter / P2 insert trust / P3 update trust / P4 delete N/A / P5 no-auth 500 handler + service / P6 no-cache)
- AC8 middleware chain: 1 test (unverified rejected)
- AC9 = AC7 (implementation)
- AC10 attack vectors: 3 subtests (url_param_override / body_field_override / header_spoof) + DOM-wide byte ratchet

Ready to proceed to Step 3 — Quality Evaluation.

## Step 3 — Quality Evaluation (Determinism / Isolation / Maintainability / Performance)

**Execution mode**: sequential (in-context, Murat direct — Step 2's hands-on scan produced dimension inputs; no subagent fan-out required since the diff is already fully in context from the code-review pass).

**Dimension outputs** (JSON at `/tmp/tea-test-review-{dim}-1782976510-tea-2-1.json`):

| Dimension | Score | Grade | Weight | Contribution |
|---|---:|---|---:|---:|
| Determinism | 92 | A | 0.30 | 27.60 |
| Isolation | 88 | B | 0.30 | 26.40 |
| Maintainability | 85 | B | 0.25 | 21.25 |
| Performance | 90 | A | 0.15 | 13.50 |
| **Overall** | **89** | **B** | | **88.75** |

**Violation totals**: 12 findings — 0 HIGH, 2 MEDIUM, 10 LOW.

### Findings — MEDIUM (2)

1. **[maintainability] Missing `Persona`-field assertions in service unit tests** — code-review split introduced a new `Persona` field distinct from `PersonaChoice`; the two unit tests (`GetProgress_DefaultWhenMissing`, `UpsertProgress_TypedPayloadRoundtrip`) weren't extended to cover it. If P1's payload-leak bug regresses, unit tests won't catch it.
   Fix: add `if got.Persona != nil { t.Errorf("...") }` assertions to both tests.

2. **[maintainability] P5 test packs two concerns into one function** — `TestOnboardingProgress_P5_NoAuthContextRejects` now covers both service-layer zero-UUID rejection AND handler-layer missing-TenantContext branch (added in code review). Split into `P5_ServiceRejectsZeroUUID` + `P5_HandlerRejectsMissingTenantContext` so failures name the correct layer.

### Findings — LOW (10)

**Determinism (3)**
- Slug race test `wg.Wait()` has no timeout — theoretical CI-stress hang risk.
- P4 test is a vacuous `t.Log`-only function — replace with `t.Skipf(...)` for linter-safety.
- `uid, _ := uuid.Parse(...)` silent discards — extract a `MustParseUUID(t, ...)` helper.

**Isolation (2)**
- 16 hardcoded emails reused across tests — safe under SetupDB (tx-rollback) but a landmine if any test migrates to SetupRawPool. Extract `test.UniqueEmail(prefix)` helper or document the nonce pattern.
- Slug race nonce is 8 hex chars (32-bit) — bump to full uuid.NewString() for future-proofing.

**Maintainability (4)**
- `assertDoesNotLeak` helper declared but AC10 DOM-wide ratchet uses inline `bytes.Contains` — refactor to helper for consistency.
- Dead-weight local `contains()` + `errorsAs` shims in onboarding_progress_rls_test.go — delete; use stdlib directly.
- Three test files exceed the 300-line guideline (onboarding_handler_atdd 469, center_handler_atdd 392, onboarding_progress_rls 369) — MONITORED; length is proportional to R1 coverage. Split if any crosses 600.
- Red-phase `var _ = handler.NewOnboardingHandler` compile-checks — dead weight after green; delete.

**Performance (1)**
- Same as determinism-1 (slug race timeout) — surfaces here because it affects wall-clock.

Ready to proceed to Step 4 — Generate Report.

## Step 4 — Report

### Executive Summary

**Story 2-1 test suite: 89/100 (Grade B).** Zero HIGH findings. R1 (score 9) J15 discharge fully intact — six named patterns green, byte-level cross-user privacy ratchets green, concurrent double-post race green. 52 test functions across 11 files (10 test + 1 helpers), zero `time.Sleep`, zero `t.Parallel` on shared-tx tests, zero conditional flow control in test bodies. Two MEDIUM findings both stem from the /bmad-code-review pass — additive test extensions, not test rewrites. Ten LOW findings are cleanup nits and future-proofing.

**No merge blockers.** Story 2-1 is safe to ship as-is (already merged to `main` at commit `9fcf512`). The MED-severity items can be closed as a follow-up chore commit; none of them are R1 threats.

### Critical Findings — MEDIUM

**1. Missing `Persona`-field assertions in service unit tests** _(maintainability)_

- **Files**: `internal/service/onboarding_test.go:80-102, :104-135`
- **Root cause**: `/bmad-code-review 2-1` split `OnboardingProgress.PersonaChoice` into two fields (`Persona` — users.persona derived, top-level response; `PersonaChoice` — payload draft). Service unit tests weren't extended to cover the new `Persona` field. If the payload-leak bug (code-review P1 HIGH) regresses, unit tests won't catch it.
- **Fix**:
  ```go
  // in TestOnboardingService_GetProgress_DefaultWhenMissing
  if got.Persona != nil {
      t.Errorf("default Persona = %v, want nil (users.persona was never set)", *got.Persona)
  }
  // in TestOnboardingService_UpsertProgress_TypedPayloadRoundtrip
  if got.Persona != nil {
      t.Errorf("Persona = %v, want nil (users.persona never set for this user)", *got.Persona)
  }
  ```
- **Effort**: ≤5 minutes. Two assertion adds.

**2. P5 test packs service + handler concerns into one function** _(maintainability)_

- **File**: `internal/test/onboarding_progress_rls_test.go:213-261`
- **Root cause**: `/bmad-code-review 2-1` extended P5 test with the handler-layer branch (spec AC9 P5 mandates 500-not-422). Result: a single function covers both service-with-zero-UUID rejection and handler-with-missing-context rejection. When a P5 CI failure lands, the test name (`_P5_NoAuthContextRejects`) doesn't tell reviewers which layer regressed.
- **Fix**: Extract the handler block (~lines 241-260) into a sibling test:
  ```go
  func TestOnboardingProgress_P5_HandlerRejectsMissingTenantContext(t *testing.T) {
      db := SetupDB(t)
      svc := newOnboardingSvc(t, db)
      h := handler.NewOnboardingHandler(svc, RealClock{})
      req := httptest.NewRequest("GET", "/api/onboarding/progress", nil)
      rec := httptest.NewRecorder()
      err := h.GetProgress(rec, req)
      // …same three assertions moved verbatim…
  }
  ```
  Rename the current function to `..._P5_ServiceRejectsZeroUUID`.
- **Effort**: ≤10 minutes. Cut, paste, rename.

### Warnings — LOW (10)

See Step 3 dimension breakdown above. Highest-leverage cleanups (grouped):

- **Slug race hardening**: add `wg.Wait()` timeout + bump 8-char nonce to full UUID.
- **P4 vacuous test**: replace `t.Log`-only body with `t.Skipf("P4 N/A per AC9 …")` for linter-safety.
- **Dead code purge**: delete `contains()` + `errorsAs` shims in onboarding_progress_rls_test.go; delete red-phase `var _ = handler.NewOnboardingHandler` compile-checks in ATDD files.
- **AC10 consistency**: refactor inline `bytes.Contains` in DOM-wide ratchet to use existing `assertDoesNotLeak` helper.
- **Isolation guardrails**: extract `test.UniqueEmail(prefix)` helper OR document per-run nonce pattern for future raw-pool authors.
- **Silent-discard cleanup**: replace `uid, _ := uuid.Parse(...)` with a `MustParseUUID(t, ...)` helper.

### Coverage Boundary Note

`test-review` scoring is **quality-only** (Determinism / Isolation / Maintainability / Performance). AC-to-test coverage traceability is `trace`'s job. R1 J15 discharge is validated as intact HERE by dimension-scoring the six existing pattern tests, not by counting whether every AC has a test — that gap check lives in `/bmad-tea TR 2-1`.

### Context References

- Story: `_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md` (status: done)
- Completion notes: `_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume-completion-notes.md`
- ATDD checklist: `_bmad-output/test-artifacts/atdd-checklist-2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md`
- Test design (Epic 2 → R1 R18): `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md`
- Code review pass: commit `9fcf512` — feeds Persona-split fallout gap into MED-1
- Story baseline: commit `9fcf512` on `main` (pushed to origin)

### Recommended Next Workflow

**`/bmad-tea TA 2-1`** — expand P2/P3 (P0/P1 are covered) test scenarios, add fixture polish, produce DoD summary. This is the strict WF-8 post-dev protocol and complements RV.

**Optional (epic boundary — not now)**: `/bmad-tea TR 2-1` for AC-to-test traceability matrix, but this fires more naturally at Epic 2's boundary once 2-2 through 2-7 also land.

### Progress Save

Step 4 complete. Report written to `_bmad-output/test-artifacts/test-reviews/test-review-2-1.md`. Dimension outputs at `/tmp/tea-test-review-{dim}-1782976510-tea-2-1.json`. Aggregation summary at `/tmp/tea-test-review-summary-1782976510-tea-2-1.json`.
