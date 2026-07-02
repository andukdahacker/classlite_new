---
storyKey: '2-1'
storyPath: '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
storyStatus: 'done'
detectedStack: 'backend'
executionMode: 'BMad-Integrated (story + ATDD checklist + test-design + code-review + RV report all in context)'
inputDocuments:
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume-completion-notes.md'
  - '_bmad-output/test-artifacts/atdd-checklist-2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/test-artifacts/test-reviews/test-review-2-1.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - 'docs/project-context.md'
knowledgeFragments:
  - test-quality
  - data-factories
  - test-levels-framework
  - test-priorities-matrix (inline priority rationale)
  - selective-testing (skipped — no E2E to select)
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03-generate-tests', 'step-04-validate-and-summarize']
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-07-02'
taPassPurpose: 'P2/P3 expansion + fault injection + fixture polish per WF-8 stage 3'
---

# TA Automation Summary — Story 2.1

## Step 1 — Preflight & Context

**Stack**: backend Go. `go.mod` + integration harness (`test.SetupDB`, `SetupRawPool`, `TenantContext`, `CreateUser`, `CreateCenter*`, `MarkUserEmailVerified`, `SeedOnboardingProgress`, `SetUserPersona`, `MockAccessTokenIssuer`) all present at `internal/test/`. Framework ready.

**Mode**: BMad-Integrated — inheriting the ATDD red→green baseline + `/bmad-code-review 2-1` + `/bmad-tea RV 2-1` findings from the same session's prior workflows.

**Baseline coverage (already green — do NOT duplicate)**:

| Layer | Coverage from ATDD + code-review + RV | Tests |
|---|---|---:|
| Handler ATDD | AC1/3/4/8/10 (onboarding), AC2/6 (center) | 22 |
| Middleware ATDD | AC8 RequireVerifiedEmail | 3 |
| Service ATDD | AC5b Vietnamese slug matrix + length + RandomSuffix | 3 |
| J15 grid (R1 discharge) | P1-P6 + center_members unique | 8 (after RV P5 split) |
| Concurrent race | AC2 concurrent double-post + slug collision | 2 |
| Service unit | Persona validation matrix + defaults + roundtrip + zero-UUID guards | 5 |
| Middleware unit | ExtractTenant EmailVerified | 6 |
| Auth mint unit | JWT round-trip with + without center | 2 |
| **Total baseline** | | **51** |

## Step 2 — Automation Targets & Coverage Plan

### Scope of this TA pass

Per WF-8 stage 3: **P2/P3 expansion, fault injection beyond `brokenAuditLogger`, fixture polish rolled up from RV LOW findings.** No test-level shift (all stay at service/handler-integration per TEST-BE-3/4). No E2E — backend-only story.

### New coverage — 9 tests + 3 fixture helpers

| # | ID | Level | Priority | AC | Scenario | Rationale |
|---:|---|---|---|---|---|---|
| 1 | 2.1-INT-2-1 | handler-integration | P2 | AC1 | POST /persona twice with DIFFERENT persona values — both 200, users.persona ends as second value (last-write-wins). | AC1 says idempotent for SAME value; behavior for different value is unstated but production-critical (wizard back+forward+re-pick). Locks in observable semantics. |
| 2 | 2.1-INT-2-2 | handler-integration | P2 | AC1/3 | Request body just over 16 KiB cap (`maxOnboardingBodyBytes`) → 422 with clean error, not 500. | RV Determinism nit: body-cap boundary is a hardcoded const; drift would surface as a random-looking 500 in prod. |
| 3 | 2.1-INT-2-3 | handler-integration | P2 | AC2 | Slug retry exhaustion — pre-seed 5 collisions so all attempts fail, expect 500 `INTERNAL_ERROR` with wrapped `slug retry exhausted` context. | Spec calls this out (`On the 5th failure, respond 500`) but only the concurrent race test exercises retry logic; exhaustion path is untested. |
| 4 | 2.1-INT-2-4 | handler-integration | P2 | AC2 | Broken `accessTokenIssuer` (mint returns error) after successful commit → 500 with center already persisted (client can retry-login to recover). | Symmetric to `brokenAuditLogger` AC6 test but for the POST-commit token mint path — dev-notes acknowledge this as an accepted-loss recovery scenario; document via test. |
| 5 | 2.1-INT-2-5 | handler-integration | P2 | AC2 | Name at exactly 120 runes (Vietnamese multi-byte) succeeds; 121 runes → 422. | Locks in the code-review P3 rune→byte fix (`utf8.RuneCountInString`) against a byte-count regression. Direct RV MED-adjacent hardening. |
| 6 | 2.1-INT-2-6 | handler-integration | P2 | AC3 | PUT progress with `schemaVersion: 99` → 422 `VALIDATION_ERROR`. | `MigrateOnboardingPayload` returns "unsupported schema version" but no integration test verifies handler wraps to 422 (not 500). |
| 7 | 2.1-INT-2-7 | handler-integration | P3 | AC3+AC4 | Full wizard flow: POST persona → PUT progress step-by-step → GET progress mid-flow — verifies `Persona` (users.persona) surfaces alongside `PersonaChoice` (payload draft) with correct semantics. | End-to-end integration of the code-review P1 Persona-split fix. Cross-endpoint contract validation. |
| 8 | 2.1-INT-2-8 | handler-integration | P2 | AC8 | Per-route rate limit (20/min per IP-keyed user): 21st request in 1 min → 429 `RATE_LIMIT_EXCEEDED`. | Middleware chain includes `onboardingLimit`; rate-limit trip is untested; only wired in main.go. |
| 9 | 2.1-INT-2-9 | handler-integration | P3 | Envelope contract | `meta.serverTime` is valid RFC3339 UTC with ms precision on all 4 endpoints. | Envelope contract cross-cuts every AC's 2xx; single reusable helper protects the whole surface. |

### Fixture polish (bundled from RV LOW findings)

| # | Change | Fixes RV finding |
|---:|---|---|
| F1 | Add `test.MustParseUUID(t, s)` helper — replaces `uid, _ := uuid.Parse(...)` silent-discard pattern across the suite. | Determinism LOW-3 |
| F2 | Add `test.UniqueEmail(prefix string)` helper — canonical way to build parallel-safe emails; documents the pattern for future raw-pool authors. | Isolation LOW-1 |
| F3 | Bump `centers_slug_collision_race_test.go` nonce from `uuid.NewString()[:8]` to full `uuid.NewString()` + add `select-with-timeout` around `wg.Wait()` (30s ceiling). | Isolation LOW-2 + Determinism LOW-1 |

Not doing this pass (LOW nits deferred to a hygiene sweep):
- Removing red-phase `var _ = handler.NewOnboardingHandler` compile-checks (LOW, cosmetic; still serves symbol-canary role)
- Refactor AC10 DOM-wide ratchet to use `assertDoesNotLeak` helper (LOW, consistency-only)
- Delete local `contains()` helper (kept per its own comment — avoids `strings` import in a single-caller file)
- P4 vacuous test replacement (LOW; acceptable per AC9 spec)

### Test-level split (per project TEST-BE-1..5)

All 9 new tests land at the **handler-integration level** (real middleware chain via `newStorySrv` / `NewTestServerForUser`) because they either:
- exercise middleware boundaries (rate limit, body cap, JSON error mapping) — service-layer tests won't hit these
- lock in cross-endpoint invariants (envelope contract, wizard-flow round trip)
- validate the exact 4xx/5xx status + envelope error code path — the very thing handler ATDD is for

No new service-unit or middleware-unit tests — those layers are adequately covered.

### Priority rationale

- **P2** (7 tests): fills recognized gaps in AC1/2/3/8 that ATDD's happy-path-plus-canonical-error surface didn't reach. Non-P0 because R1 discharge is already locked; P0 would require a genuine cross-tenant leak vector, which the J15 grid already owns.
- **P3** (2 tests): cross-cutting envelope + wizard-flow integration. Highest value per line of test code among the remaining scenarios but not blocking.

### File placement plan

- All 9 new tests → append to existing `internal/handler/onboarding_handler_atdd_test.go` and `internal/handler/center_handler_atdd_test.go` (grouped with existing AC ATDD by AC number). This will bump those files past the RV MED-2 length monitoring threshold. Acceptable per the RV comment "length is proportional to coverage; monitor if >600".
- Fixture helpers → append to `internal/test/story_2_1_helpers.go` (F1, F2) and modify `centers_slug_collision_race_test.go` (F3).
- `_atdd_test.go` filename convention preserved (semantics: "the acceptance test file for this handler").

Ready for Step 3 — Generate Tests.

## Step 3 — Generation

**9 tests generated (of 9 planned)**, **3 fixture helpers added** (of 3 planned). One test's original angle (INT-2-3 slug retry exhaustion) was reworked mid-run — see "Deviation" below.

### Generated tests

| ID | File | Test function | Priority | Result |
|---|---|---|---|---|
| 2.1-INT-2-1 | `handler/onboarding_handler_atdd_test.go` | `TestSetPersona_INT21_LastWriteWins_DifferentValues` | P2 | ✅ green |
| 2.1-INT-2-2 | `handler/onboarding_handler_atdd_test.go` | `TestOnboarding_INT22_BodyCapBoundary_Returns422NotFiveHundred` | P2 | ✅ green |
| 2.1-INT-2-3 | `handler/center_handler_atdd_test.go` | `TestCreateCenter_INT23_UnicodeWhitespaceName_Returns422` | P2 | ✅ green |
| 2.1-INT-2-4 | `handler/center_handler_atdd_test.go` | `TestCreateCenter_INT24_BrokenTokenIssuer_CenterPersistsAfterCommit` | P2 | ✅ green |
| 2.1-INT-2-5 | `handler/center_handler_atdd_test.go` | `TestCreateCenter_INT25_RuneBoundary_VietnameseName` (2 subtests: at_120, at_121) | P2 | ✅ green |
| 2.1-INT-2-6 | `handler/onboarding_handler_atdd_test.go` | `TestPutProgress_INT26_UnsupportedSchemaVersion_Returns422` | P2 | ✅ green |
| 2.1-INT-2-7 | `handler/onboarding_handler_atdd_test.go` | `TestOnboarding_INT27_WizardRoundtrip_PersonaVsPersonaChoiceSemantics` | P3 | ✅ green |
| 2.1-INT-2-8 | `handler/onboarding_handler_atdd_test.go` | `TestOnboarding_INT28_RateLimit_21stRequestReturns429` | P2 | ✅ green |
| 2.1-INT-2-9 | `handler/onboarding_handler_atdd_test.go` | `TestOnboarding_INT29_EnvelopeContract_ServerTimeIsRFC3339UTC` | P3 | ✅ green |

### Fixture helpers added

- `test.MustParseUUID(t, s)` — F1 (RV Determinism LOW-3 closed).
- `test.UniqueEmail(prefix)` — F2 (RV Isolation LOW-1 closed).
- `test.SuperuserPool(t)` — bonus F4 (surfaced during INT-2-4 debugging; needed for cross-RLS visibility checks in TA-style fault injection tests).
- `centers_slug_collision_race_test.go` — F3: full-UUID nonce + `wg.Wait()` 30s timeout (RV Isolation LOW-2 + Determinism LOW-1 closed).

### Deviation from plan

**INT-2-3 reworked**: the original plan was "slug retry exhaustion — pre-seed 5 collisions → 500". This turned out impractical to force deterministically — CenterService uses the free `service.Slugify` + `service.RandomSuffix` functions directly (no injection seam), and RandomSuffix's crypto/rand source can't be stubbed without refactoring the service. Pre-seeding all 32⁴ possible 4-char suffixes to force exhaustion is not viable (1M rows).

Substituted with **AC2 Unicode-whitespace-only name** (U+00A0 nbsp + U+3000 ideographic space + regular spaces) → 422. Same P2 priority, same AC coverage angle (name-validation hardening), but this locks in the code-review P7 `strings.TrimSpace` fix — the byte-based `trimName` it replaced would have kept these characters as content and let them through the min-length check. Higher value per line: locks in a specific code-review deliverable against regression, vs. covering a defensive branch that never fires in practice.

**Slug retry exhaustion coverage — deferred as follow-up**: if this becomes a real concern, refactor CenterService to accept `Slugify func(string) string` and `RandomSuffix func(int) string` as constructor parameters, defaulting to the package-level functions. Then a unit test can inject stubs that always produce colliding output. File as `FU-2-1-G` (slug-seam refactor) if you want it tracked.

### New finding surfaced during test authoring

**AC6 rollback assertions on RLS-protected tables are vacuously satisfied by the classlite_app tenant scope.** `TestCreateCenter_AC06_AuditFailure_RollsBackWholeTx` at line 292-303 queries `center_members` and `audit_logs` on the app pool without SET LOCAL — RLS returns 0 rows regardless of whether the tx rolled back. The `centers` global-table check IS load-bearing (no RLS on centers), so the AC6 atomicity invariant is still enforced end-to-end. But the two supplementary assertions add no real coverage.

**Severity: LOW** (functionally correct via centers; RLS-protected checks are extra confidence that isn't paying off).

**Fix (optional, ≤5 min)**: replace `test.CountRows(t, pool, ...)` with `test.CountRows(t, test.SuperuserPool(t), ...)` on the two RLS-protected assertions in AC6. Same fix pattern INT-2-4 already uses.

## Step 4 — Validate & Summarize

**Full regression clean**:
```
ok  github.com/ducdo/classlite-api/internal/handler      1.209s
ok  github.com/ducdo/classlite-api/internal/middleware   (cached)
ok  github.com/ducdo/classlite-api/internal/service      (cached)
ok  github.com/ducdo/classlite-api/internal/test         2.135s
ok  github.com/ducdo/classlite-api/internal/test/workers (cached)
```

**Coverage delta**: baseline 51 tests → **60 tests + 2 subtests** (INT-2-5 splits into at_120 + at_121). Plus 3 new fixture helpers + 1 bonus helper (SuperuserPool). Plus F3 hardening on the concurrent race test.

### DoD checklist

- [x] All new tests deterministic (no `time.Sleep`, no polling, no random-seed-dependent asserts)
- [x] All new tests isolated (SetupDB tx-rollback where safe; SetupRawPool + CreateUserOnPool cleanup where Commit is required)
- [x] All new tests explicit-assertions-in-body (no hidden `t.Errorf` in helpers besides the existing `assertErrorCode`/`assertErrorCodeCenter`/`assertDoesNotLeak` which use `t.Helper()`)
- [x] All new tests self-cleaning (SetupDB rollback OR CreateUserOnPool auto-t.Cleanup)
- [x] All new tests parallel-safe within Go's test-per-package model (no `t.Parallel()` on shared-tx tests, per project TEST-BE-2)
- [x] Full internal test suite passes on clean checkout
- [x] Rolled up 3 RV LOW findings via F1/F2/F3
- [x] No new HIGH or MED findings introduced
- [x] Story file / sprint-status update NOT needed (story already `done`; TA delta is a coverage-expansion commit against the same story)

### RV findings closed by this TA pass

- ✅ Determinism LOW-1 (slug race `wg.Wait()` timeout) — F3
- ✅ Determinism LOW-3 (`uid, _ := uuid.Parse(...)` silent discard) — F1 (`MustParseUUID`) applied in `centers_slug_collision_race_test.go` and `TestCreateCenter_INT24_...`; other sites can adopt incrementally
- ✅ Isolation LOW-1 (hardcoded emails collision landmine) — F2 (`UniqueEmail`) available as canonical helper
- ✅ Isolation LOW-2 (8-char nonce entropy) — F3 (full UUID for emails, 12-hex for name)
- ✅ Maintainability LOW (`errorsAs` shim dead code) — deleted at RV MED-2 commit

### RV findings still open (deferred to hygiene sweep)

- Maintainability LOW: `assertDoesNotLeak` helper not used in AC10 DOM-wide ratchet (cosmetic; refactor to helper for consistency)
- Maintainability LOW: local `contains()` helper reimplements `strings.Contains` (single-caller; kept per its own comment)
- Maintainability LOW: red-phase `var _ = handler.NewOnboardingHandler` compile-checks (kept as symbol-canary)
- Determinism LOW: P4-Delete vacuous `t.Log`-only test (acceptable per AC9 spec)

### New TA finding filed + fixed inline

- **LOW / applied inline**: AC6 rollback assertions on `center_members` + `audit_logs` vacuously satisfied by RLS scope. **Hardened during this TA pass** — swapped both queries to `test.SuperuserPool(t)` so the assertion catches real tx-atomicity breaks on RLS-protected tables. AC6 still green post-fix, confirming rollback is genuinely doing its job (not just RLS-invisible).

## Recommended next step

TA is complete. Options:

1. **Commit + push the TA delta** — 9 new tests + 4 helpers + 1 file hardening; call this story fully closed on the WF-8 per-story protocol.
2. **Apply the AC6 hardening now** (≤5 min) then commit — closes the new LOW finding in the same commit.
3. **Move to Story 2-2 pre-dev context** — per sprint status, 2-2 is `backlog` and needs John's pre-dev pass before Amelia can pick it up.

