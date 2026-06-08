---
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-quality-evaluation', 'step-04-generate-report']
lastStep: 'step-04-generate-report'
lastSaved: '2026-06-08'
inputDocuments:
  - _bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md
  - _bmad-output/test-artifacts/automation-summary.md
  - docs/project-context.md
detected_stack: backend
review_scope: directory (14 Story 1.6 test files; ~3,427 lines)
target_story: 1-6-google-oauth-and-invite-acceptance-api
execution_mode: sequential (single-author single-story, no parallel subagent value)
overall_score: 92/100
verdict: PASS — no blockers; 4 low-severity polish items
---

# Test Quality Review — Story 1.6

## Scope

| Layer | Files | Lines | Test functions |
|---|---|---|---|
| service (ATDD) | 4 (`oauth_state`, `google_oauth`, `accept_invite`, `force_logout`) | 1,274 | 22 |
| service (TA) | 4 (`oauth_state`, `auth_google`, `accept_invite`, `force_logout`) | 774 | 13 (+ 6 subtests) |
| handler (ATDD) | 3 (`google_oauth`, `accept_invite`, `force_logout`) | 779 | 13 |
| handler (TA) | 1 (`google_oauth`) | 309 | 6 |
| middleware (ATDD) | 1 (`require_role`) | 172 | 4 (+ subtests) |
| middleware (TA) | 1 (`require_role`) | 119 | 3 (+ 4 subtests) |
| **TOTAL** | **14 files** | **3,427** | **61 test functions + ~14 subtests** |

Coverage mapping (AC → tests) is out of scope for RV — routed to `/bmad-tea TR` at the Epic 1B boundary.

## Score Summary

| Dimension | Score | Verdict |
|---|---|---|
| **Determinism** | 96 / 100 | Strong — MockClock everywhere, zero `time.Sleep`, HMAC + token seeding via the signer/clock contract, no `time.Now()` direct calls in test bodies |
| **Isolation** | 95 / 100 | Strong — every test uses `test.SetupDB(t)` (tx-rollback via `t.Cleanup`); zero `t.Parallel()` calls (correct for shared TxDB connection); zero `SetupRawPool` usage in 1.6 scope; deterministic test-data per test |
| **Maintainability** | 86 / 100 | Mostly good — 4 minor polish opportunities (named constants, helper extraction, naming consistency) — no blockers |
| **Performance** | 92 / 100 | Strong — `BcryptHasher{Cost: 4}` (test minimum) everywhere; no individual test >0.5s; full Story 1.6 suite runs in <5s |
| **Overall (weighted)** | **92 / 100** | **PASS** |

## Critical Findings

**None.** No `time.Sleep`, no hidden assertions, no leaked goroutines, no flaky timing, no missing cleanup, no race-prone shared state.

## Warnings (low severity)

### W1 — TA-pass test names miss the `AC##` marker convention

The ATDD pattern is `Test<Subject>_AC##_<Scenario>`. Several TA-pass tests legitimately don't map 1:1 to an AC (risk-driven coverage, regression for review patches), but a few that DO map to an AC could carry the marker for `/bmad-tea TR` alignment:

| Current name | Could be |
|---|---|
| `TestAssertTenantBinding_IPv6Host_Apex` | `TestAssertTenantBinding_AC03_IPv6Host_Apex` |
| `TestAssertTenantBinding_MixedCaseHost_LowerCasesSlug` | `TestAssertTenantBinding_AC03_MixedCaseHost` |
| `TestHandleGoogleCallback_EmptyAppApexHost_TenantBindingStillRuns` | `TestHandleGoogleCallback_AC03_EmptyAppApexHost` |
| `TestInitiateGoogleOAuth_OversizeInviteToken_Rejected` | `TestInitiateGoogleOAuth_AC01_OversizeInviteToken` |

The 9 remaining unmarked TA tests are risk-driven (adversarial state replay, cross-tenant grid, role-upgrade) — those stay without AC markers because they cross AC boundaries.

**Impact:** Trace matrix will need manual mapping for the 4 above. Fix is a 30-second rename. **Severity: low.**

### W2 — Magic literal `7 * 24 * time.Hour` repeated 10 times

The invite TTL appears as a raw expression in 10 places across service tests. The production constant `inviteTTL` exists in `auth_admin.go` but is unexported. A test-local named constant (`testInviteTTL = 7 * 24 * time.Hour`) at the top of `accept_invite_atdd_test.go` would centralize it.

**Impact:** Hard to grep "where do we use the invite TTL in tests?" — but the literal is consistent across all sites. **Severity: low.**

### W3 — Fixture setup duplicated 5× in `accept_invite_atdd_test.go`

The "Owner + center A" seed block:
```go
centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
_ = test.TenantContext(t, db, centerA.ID)
_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")
```
repeats 5× in `accept_invite_atdd_test.go`. A `seedCenterAOwner(t, db) (center, owner)` helper would cut ~20 lines.

**Impact:** Maintenance — if the schema changes, 5 sites need updating instead of 1. The duplication isn't hiding a bug today. **Severity: low.**

### W4 — Three near-identical `seedInvite` helpers across packages

- `seedInvite` (service tests)
- `seedInviteForHandler` (handler tests, includes center+inviter setup)
- `seedInviteForInitTest` (handler tests, also includes center+inviter setup)

The package-boundary split is real (handler tests can't import service-test helpers), but `seedInviteForHandler` and `seedInviteForInitTest` could be unified inside the handler package. Currently they differ only in signature (return type).

**Impact:** Future tests will pick the wrong helper or write a fourth. **Severity: low.**

## Quality Signals (Strong)

What this suite does well — worth carrying into future stories as templates:

1. **Single mock seam per layer** — backend tests use `test.SetupDB(t)` (real DB in tx) at service+handler integration layers, and `mockGoogleOAuthClient` at the one untestable external boundary (Google). Honors project-context **TEST-BE-2/3/4** without drift.
2. **MockClock injection threading** — every time-dependent assertion routes through the injected clock. The `TestOAuthStateTTL_ExactSecondBoundary_StillValid` test exercises an exact-second boundary deterministically, which would be impossible with wall clock.
3. **Negative assertions paired with positive** — `TestGoogleCallback_UserinfoTimeout_RedirectsGoogleTimeout` asserts BOTH `error=google_timeout` (positive) AND `not google_userinfo_failed` (negative). `TestGoogleCallback_InviteEmailMismatch_NoEmailLeakInRedirectURL` asserts the error code is present AND that 6 forbidden substrings are absent. This matches project-context's TEST meta-rule.
4. **R1 (cross-tenant) coverage is grid-shaped, not single-point** — `TestForceLogout_CrossTenantGrid_AuditAttribution` runs every off-diagonal cell (6 pairs) and asserts collateral is zero across all of them. The score-9 risk gets score-9 attention.
5. **Latent-bug discovery during TA pass** — the D1 review patch (`UpdateCenterMemberRole` after isUniqueViolation catch) had a Postgres tx-state bug; the role-upgrade test caught it. This is exactly the kind of bug RV/TA exists to find. The fix (`UpsertCenterMemberWithRole` atomic upsert) is now in production code AND tested.
6. **Raw Set-Cookie header parsing** — `TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes` parses the raw header instead of `rec.Result().Cookies()` to defeat stdlib's leading-dot Domain strip. The same defense from Story 1.5 carries forward correctly into Story 1.6.

## Coverage Note

Per RV scope, coverage mapping (AC → tests) is not scored here. Route to `/bmad-tea TR` for the Epic 1B traceability matrix. Story 1.6's per-AC test count from the TA summary suggests every AC has at least 2 test layers (service + handler), with R1/R6/R7 risk surfaces double-covered.

## Recommended Actions

| Priority | Action | Estimated effort |
|---|---|---|
| Optional | Apply W1 renames to 4 TA tests with AC mapping | 2 min |
| Optional | Hoist `testInviteTTL` constant to top of `accept_invite_atdd_test.go` (W2) | 2 min |
| Optional | Extract `seedCenterAOwner` helper in `accept_invite_atdd_test.go` (W3) | 5 min |
| Optional | Consolidate `seedInviteForHandler` + `seedInviteForInitTest` in handler package (W4) | 5 min |

All four are low-severity polish — none gate Story 1.6 done-status or the Epic 1B gate decision. Apply during a future cleanup pass or leave as-is.

## Next Recommended Workflow

- **`/bmad-tea TR`** — Phase 1 trace at the Epic 1B boundary (Stories 1.4 + 1.5 + 1.6). Builds the AC → test mapping matrix and assigns coverage grades. The output feeds the GATE decision.
- **`/bmad-tea GATE`** — final PASS/CONCERNS/FAIL for Story 1.6 individually, OR for the whole of Epic 1B. The Story 1.6 individual gate is straightforward (this RV report supports PASS); the Epic 1B gate consumes all three story trace + NFR reports.
- **Story 1.7a (`bmad-dev-story`)** — non-blocking for RV's outcome. Epic 1C frontend work can proceed in parallel with Epic 1B gate decisions.
