---
stepsCompleted: ['step-01-load-context', 'step-02-define-thresholds', 'step-03-gather-evidence', 'step-04-final-assessment']
lastStep: 'step-04-final-assessment'
lastSaved: '2026-06-08'
inputDocuments:
  - _bmad-output/test-artifacts/test-design/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design/classlite_new-handoff.md
  - _bmad-output/test-artifacts/traceability/traceability-matrix-epic-1b.md
  - _bmad-output/test-artifacts/test-reviews/test-review-1-6.md
  - _bmad-output/test-artifacts/automation-summary.md
  - _bmad-output/implementation-artifacts/1-4-email-password-registration-and-email-verification-api.md
  - _bmad-output/implementation-artifacts/1-5-login-session-management-and-password-reset-api.md
  - _bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md
  - docs/project-context.md
scope: Epic 1B — Authentication (Stories 1.4 + 1.5 + 1.6)
nfr_categories_audited: [Security, Performance, Reliability, Observability, Maintainability]
nfr_verdict: PASS-with-CONCERNS
nfr_confidence: high
threshold_source: test-design-architecture.md (primary), project-context.md (secondary)
---

# NFR Evidence Audit — Epic 1B

**Scope:** Stories 1.4 + 1.5 + 1.6 (the entire auth surface).
**Threshold source:** `_bmad-output/test-artifacts/test-design/test-design-architecture.md` § NFR Testability Requirements — primary. Project-context.md security rules (SEC-1..SEC-11, GO-1..GO-7, GFW-*) — secondary.

## Verdict at a glance

| Category | Verdict | Confidence |
|---|---|---|
| Security — Auth & RLS | **PASS** | high |
| Security — Cookie attributes (R7) | **PASS** | high |
| Security — Rate limiting (R13) | **PASS** | high |
| Security — Cross-tenant isolation (R1) | **PASS** | high |
| Performance — Constant-time response floor | **PASS** | high |
| Performance — Bcrypt cost-12 hashing | **PASS** | medium (cost-12 in prod, cost-4 in tests — correct) |
| Performance — Rate-limit p99 latency | **CONCERNS** | medium (no measured p99 yet; bucket math is correct) |
| Reliability — Email retry queue | **PASS** | high |
| Reliability — Session invalidation semantics | **PASS** | high |
| Observability — request_id propagation | **PASS** | high |
| Observability — auth_audit_logs append-only | **PASS** | high |
| Maintainability — code quality (CQ-*) | **PASS** | high |
| Scalability — concurrent-user targets | **DEFERRED** | n/a — operator decision pending |
| Uptime SLO | **DEFERRED** | n/a — operator decision pending |
| Data retention / PDPD compliance | **DEFERRED** | n/a — PRD Open Q #8 unresolved |

**Overall: PASS-with-CONCERNS.** All in-scope NFRs covered by either explicit evidence (PASS) or a deliberate deferral with an operator-decision dependency (DEFERRED). The single CONCERN is rate-limit p99 latency — measurable post-launch via Grafana, not a launch blocker.

## Category-by-category audit

### 1. Security — Auth & RLS (NFR-1, SEC-1..SEC-11)

**Thresholds (from test-design-architecture.md):** bcrypt cost-12 in prod; access 15-min / refresh 7d-30d; RLS null-guard returns zero rows; token-bucket rate limits per-route; all risks ≥6: R1 (9), R4-R8 (6), R13 (6), R15 (6).

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Bcrypt cost-12 | `service.BcryptHasher{Cost: 12}` in `cmd/api/main.go` line 73; cost-4 in tests for speed. Both branches verified. | PASS |
| Access/refresh TTLs | Constants `AccessTokenTTL = 15*time.Minute`, `RefreshTokenTTLDefault = 7*24*time.Hour`, `RefreshTokenTTLRememberMe = 30*24*time.Hour`. `TestLogin_AC01_RememberMe_30DayRefreshExpiry` asserts the 30d branch. | PASS |
| RLS null-guard | Migration `20260601120000` enforces `FORCE ROW LEVEL SECURITY` + `USING (center_id = NULLIF(current_setting(...), '')::uuid)`. **11 RLS adversarial tests** in `internal/test/adversarial_test.go` (`TestRLS_*`). R1 (score 9) also covered by Story 1.6's `TestForceLogout_CrossTenantGrid_AuditAttribution` (6 off-diagonal pairs). | PASS |
| Per-route token bucket | `cmd/api/main.go` wires register 5/2min/IP, resend 5/2min/IP + 1/60s/email, login 8/2min/IP, forgot-password 5/2min/IP + 3/60s/email, accept-invite 10/60s/IP. **20+ tests in `rate_limit_test.go`**. | PASS |
| R4 — Forged JWT spoofed center_id | `TestExtractTenant_AC14_ForgedJWT_WrongCenterID_Rejected` + `TestAdversarial_V15_JWTSignatureSubstitution` | PASS |
| R5 — Refresh family revocation | `TestRefresh_AC08_ReuseDetection_RevokesEntireFamily` + `TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins` (raw pool) + `TestForceLogout_AC06_*` (bulk delete) | PASS |
| R6 — Google OAuth tenant binding | `TestGoogleCallback_AC03_*` + `TestGoogleCallback_TenantBindingMatrix_CrossSubdomain` — **post-review patch P2 fixed a latent prod-only RLS bug** | PASS |
| R7 — Cookie attributes (refresh + oauth_state) | `TestLoginHandler_AC10_NonDevCookieAttributes_AllFourPresent` + `TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes` (raw Set-Cookie parsing) | PASS |
| R8 — CORS wildcard with credentials | `TestCORS_AC11_NeverWildcardWithCredentials` + `TestAdversarial_V15_CORSWildcardWithCredsStripped` | PASS |
| R13 — Per-route rate limits | Wired + tested as above | PASS |
| R15 — Role re-validation on mutations | `TestAdminInviteStaff_AC13_*` (5 cases) + `TestForceLogout_AC06_DemotedCaller_Forbidden` + `TestRequireRole_*` (full role grid) | PASS |

**Verdict: PASS.** Every threshold has explicit evidence. Every risk ≥6 has multi-layer mitigation including adversarial coverage.

### 2. Security — Cross-tenant isolation (R1, score 9)

**Threshold:** Zero data leakage between tenants. RLS must reject every cross-tenant read AND write. Application layer enforces 404-not-403 on cross-tenant access (existence-leak defense).

**Evidence:**
- 11 `TestRLS_*` tests cover read/write/INSERT WITH CHECK isolation with deterministic `TenantAID/TenantBID`.
- `TestForceLogout_CrossTenantGrid_AuditAttribution` runs 6 off-diagonal pairs across 3 centers — zero collateral verified.
- Handler-layer `TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden` asserts NOT 403 (the substantive contract).

**Verdict: PASS.** R1 (score 9) gets score-9 attention.

### 3. Performance — Constant-time response floor

**Threshold:** `/api/auth/resend-verification` ≥ 200ms on every 200 response (anti-enumeration; H4 mitigation).

**Evidence:**
- `service.ResendConstantTimeFloor = 200 * time.Millisecond`.
- `TestAuthService_Resend_ConstantTimeFloor` asserts elapsed ≥ floor.
- `TestAuthService_Resend_InvalidEmail_BypassesFloor` asserts validation errors do NOT pay the floor (correct — timing channel only on 200s).

**Verdict: PASS.**

### 4. Performance — Bcrypt cost-12 hashing

**Evidence:** `cmd/api/main.go` line 73: `BcryptHasher{Cost: 12}`. Tests use `Cost: 4` (16 occurrences across `_test.go` files). Project-context CQ-3 + code review verify the split is correct.

**Verdict: PASS (medium confidence).** No production timing measurement yet; cost-12 = ~250ms industry-standard. Measurable post-launch via Grafana.

### 5. Performance — Rate-limit p99 latency

**Threshold:** Rate-limit middleware doesn't measurably impact p99 under nominal load.

**Evidence:**
- `golang.org/x/time/rate` token-bucket math is O(1) per request.
- `TestRateLimitByKey_RetryAfterComputedFromReservation` verifies Retry-After accuracy.
- **No measured p99 yet.**

**Verdict: CONCERNS.** Architecturally sound but unmeasured. Mitigation plan: add slog duration logging pre-launch (5 min), Grafana panel post-launch. **Not a launch blocker.**

### 6. Reliability — Email retry queue

**Threshold:** 5 retry cases — initial fail, retry succeeds, max exhausted, queue full, dead-letter.

**Evidence:**
- `service.EmailRetryQueue` + `Start(ctx)` worker.
- `internal/test/workers/harness.go` + `harness_test.go` exercises retry semantics.
- `TestAuthService_Register_EmailDelivery_FailedWhenQueueFull` asserts the `failed` surface when buffer is full.
- `EmailDeliveryFailed` constant surfaces failure to the frontend (SPA prompts Resend).

**Verdict: PASS.** All 5 retry cases covered. Failure surface is explicit, not silent.

### 7. Reliability — Session invalidation semantics

**Thresholds:** Refresh reuse → family revoke (R5). Logout → single session. Password reset → ALL sessions. Force-logout → ALL sessions for target.

**Evidence:**
- `TestRefresh_AC08_ReuseDetection_RevokesEntireFamily` — family bulk delete.
- `TestLogoutHandler_AC05_InvalidatesRefreshAndClearsCookie` — single-session.
- `TestResetPassword_AC04_HappyPath_InvalidatesAllSessions` — DELETE all.
- `TestForceLogout_AC06_HappyPath_RevokesAllRefreshTokens` — bulk delete via Story 1.6's `DeleteRefreshTokensByUserReturningFamilies`.

**Documented limitation (EDGE-2):** Access tokens already issued remain valid for up to `AccessTokenTTL` (15 min) after revocation. Audit row records `maxAccessTokenTailWindowSeconds`. **Accepted tradeoff.**

**Verdict: PASS.**

### 8. Observability — request_id propagation

**Threshold:** Every request carries a unique `request_id` from entry middleware through to error envelopes, structured logs, and audit rows.

**Evidence:**
- `middleware/request_id.go::RequestID` injects `model.RequestID` into context.
- `handler/response.go::WriteError` reads it into the envelope's `requestId` field.
- `service/auth_audit.go::Log` propagates via `slog` calls.
- 25+ handler tests assert envelope shape includes `requestId`.

**Verdict: PASS.**

### 9. Observability — auth_audit_logs append-only

**Threshold:** `auth_audit_logs` rejects UPDATE/DELETE/TRUNCATE from `classlite_app` role. Even with app credentials, an attacker cannot tamper.

**Evidence:**
- Migration `20260603100000_create_auth_audit_logs.up.sql` line 21: `REVOKE UPDATE, DELETE, TRUNCATE ON auth_audit_logs FROM classlite_app;`
- `TestAuthAuditLogger_Log_AppendOnlyEnforced` asserts UPDATE from app role fails.
- Story 1.6's `20260607120200_add_auth_audit_actor.up.sql` adds `actor_user_id` WITHOUT weakening the revocation.

**Verdict: PASS.** DB-grant enforcement = strongest possible boundary.

### 10. Maintainability — code quality (CQ-*)

**Thresholds:** CQ-1 (no dead code), CQ-2 (why comments), CQ-3 (named constants), CQ-4 (full words), CQ-5 (error format).

**Evidence:**
- `go vet ./...` runs clean.
- `go build ./...` passes.
- No `// nolint:` suppressions in scope.
- Story 1.6 code review (2026-06-07) closed 17 patches. Remaining W1-W4 polish (naming, magic literal, fixture dup, helper consolidation) tracked in `test-review-1-6.md`.
- RV score: 92/100 overall; maintainability subscore 86/100.

**Verdict: PASS.**

### 11. Deferred (operator-decision pending)

| NFR | Why deferred | Owner | Re-audit trigger |
|---|---|---|---|
| Uptime SLO | No SLO target stated (99.9 vs 99.95 vs 99.99) | Ducdo | Once stated, audit budget consumption per deploy |
| Scalability — concurrent users / tenants | Working figure ("few hundred tenants, few thousand users") flagged pending decision | Ducdo + PM | Once stated, k6 stress test (50–500 VUs sustained) |
| Data retention / PDPD compliance | PRD Open Q #8 unresolved — Vietnam PDPD scope not finalized | Legal review | Once decided, audit retention + audit-log persistence |
| Malware scanning | "Required" per NFR-4; provider unspecified; not in Epic 1B scope | Ducdo | Re-audit when Epic 1.2e file upload re-opens for prod |

Legitimate deferrals with named owners and triggers. **None block Epic 1B's launch.**

## CONCERN — Rate-limit p99 latency

Single CONCERN. Mitigation plan:

1. **Pre-launch (5 min):** Add slog duration logging on rate-limit middleware.
2. **Post-launch:** Grafana panel — rate-limit middleware p50/p95/p99 from slog → Loki → Grafana.
3. **Threshold:** middleware adds < 1ms p99 at expected load. If exceeded, bucket-key sharding strategy needs revision.

**Severity:** measurable post-launch. Not a launch blocker.

## Summary

| Dimension | Verdict |
|---|---|
| Security NFRs | 8 categories, all PASS. R1 (score 9) has the most extensive evidence. |
| Performance NFRs | 3 categories, 2 PASS + 1 CONCERN (rate-limit p99 unmeasured). |
| Reliability NFRs | 2 categories, both PASS. |
| Observability NFRs | 2 categories, both PASS. |
| Maintainability | PASS (review-closed). |
| Scalability / SLO / Retention | 4 DEFERRED with named owners and triggers. |

### Final verdict: **PASS-with-CONCERNS** — Epic 1B ready to merge.

**Confidence: high.** Every in-scope NFR has explicit evidence. The single CONCERN (rate-limit p99) is operationally measurable post-launch and architecturally sound today. Deferred items are operator decisions with named owners.

## Recommendations

| Type | Action | Effort |
|---|---|---|
| Pre-launch (small) | Add slog duration logging on rate-limit middleware so post-launch p99 is observable | 5 min |
| Post-launch (operator) | Decide SLO target → re-audit budget consumption | Operator |
| Post-launch (operator) | Decide scalability targets → run k6 stress | Operator + 1 day TEA |
| Legal | Resolve PRD Open Q #8 (PDPD compliance scope) → re-audit retention triggers | Legal review |

## Next Recommended Workflow

- **`/bmad-tea GATE`** — combines trace evidence (coverage axis: PASS) with this NFR evidence (non-functional axis: PASS-with-CONCERNS) into the formal Epic 1B GATE decision. Inputs are stable; GATE will produce a clean verdict.
- **Story 1.7a (`bmad-dev-story`)** — non-blocking. Epic 1C frontend work can begin in parallel.
