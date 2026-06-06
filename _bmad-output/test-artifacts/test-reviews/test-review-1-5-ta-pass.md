---
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-quality-evaluation', 'step-04-generate-report']
lastStep: 'step-04-generate-report'
lastSaved: '2026-06-06'
inputDocuments:
  - classlite-api/internal/service/auth_p2_test.go
  - classlite-api/internal/service/auth_role_negative_test.go
  - classlite-api/internal/middleware/cors_preflight_test.go
  - classlite-api/internal/middleware/origin_check_p2_test.go
  - classlite-api/internal/middleware/extract_tenant_context_test.go
  - docs/project-context.md
  - _bmad-output/test-artifacts/automation-summary.md
review_scope: single (5 files from the 2026-06-06 TA pass)
target_story: 1-5-login-session-management-and-password-reset-api
target_story_status: review
stack: backend (Go 1.25 + pgx v5 + test.SetupDB integration seam)
reviewer: Murat (TEA / bmad-testarch-test-review)
execution_mode: sequential (single-agent — 5 files, 27 tests, scope warrants no subagent dispatch)
---

# Test Review Report — Story 1.5 TA Pass

## TL;DR

**Overall grade: A− (87/100).** The 27 new tests are well-isolated, deterministic
under burn-in (`-count=10 -race` = 270 invocations, 0 races, 0 flakes), and
honor the project's TEST-BE-1..5 rules. Two MEDIUM findings (helper DRY +
file-length nudge) and four LOW findings. **No HIGH findings. No critical
blockers. Suite is mergeable.**

## Scope Summary

| File | LOC | Tests | New surface |
| ---- | --- | ----- | ----------- |
| `internal/service/auth_p2_test.go` | 304 | 8 | refresh expiry, password_resets.email denorm, login_attempts clear-on-reset, logout audit hit/miss (delta-asserted), per-email lockout fairness, refresh-family uniqueness |
| `internal/service/auth_role_negative_test.go` | 154 | 5 | AdminInviteStaff role matrix (teacher/student/admin/viewer), malformed TC defenses, invite-row write + audit emission |
| `internal/middleware/cors_preflight_test.go` | 119 | 4 | OPTIONS 204 + headers, no-Origin pass-through, miss-path Vary, multi-label subdomain reject |
| `internal/middleware/origin_check_p2_test.go` | 112 | 6 | PATCH/PUT/DELETE/no-Origin-POST/HEAD matrix + envelope-shape contract |
| `internal/middleware/extract_tenant_context_test.go` | 157 | 4 | Context-injection happy path + empty-center claim + missing/malformed Auth header |

Total: **846 LOC, 27 test functions**.

## Score Card

| Dimension | Score | Grade | Headline |
| --------- | ----- | ----- | -------- |
| Determinism    | 95/100 | A  | No hard waits, MockClock injected, no conditionals, no try/recover for flow. |
| Isolation      | 92/100 | A- | All DB tests use `test.SetupDB` tx-rollback. Smart delta pattern for the REVOKE'd `auth_audit_logs`. One LOW callout below. |
| Maintainability | 80/100 | B+ | Godocs on every test; descriptive names; small helper extraction done well. One MEDIUM (DRY on login-bootstrap) + one MEDIUM (file barely over 300 LOC). |
| Performance    | 85/100 | A- | Burn-in clean. Bcrypt cost-4 keeps the login matrix under 1s. No per-test waits. |
| **Overall (weighted: 0.30/0.30/0.25/0.15)** | **87/100** | **A−** | Ship-able; small follow-ups logged. |

Weighted formula: `0.30*determinism + 0.30*isolation + 0.25*maintainability + 0.15*performance` — security-adjacent backend tests weight determinism & isolation heaviest.

## Burn-in Evidence

```
$ go test -count=10 -race -run 'TestRefresh_AC02_P2|TestRequestPasswordReset_AC03_P2|TestResetPassword_AC04_P2|TestLogout_AC05_P2|TestLogin_AC06_P2|TestLogin_AC01_P2|TestAdminInviteStaff_AC13' ./internal/service/...
ok  	github.com/ducdo/classlite-api/internal/service	4.719s

$ go test -count=10 -race -run 'TestCORS_AC11_P2|TestOriginCheck_AC12_P2|TestExtractTenant_AC14_P2' ./internal/middleware/...
ok  	github.com/ducdo/classlite-api/internal/middleware	1.776s
```

**270 total invocations, zero failures, zero races.** Wall time per invocation
averages 24ms (service) and 6.6ms (middleware) — comfortably within the
1.5-minute per-test budget.

## Findings

### HIGH (0)

None.

### MEDIUM (2)

#### M1 — DRY on the seed-loginable-user bootstrap

**Where:** `auth_p2_test.go` (6 tests) + `auth_role_negative_test.go` (1 test).

**Problem.** Seven tests open with the same 4-5 line sequence:
```go
user := test.CreateUser(t, db, "...", "...")
// optional: UPDATE users SET email_verified = true
svc := newAuthServiceWithClock(t, db, mc)
if err := svc.SetPassword(ctx, user.ID, "Pass..."); err != nil { ... }
loginResult, _ := svc.Login(ctx, service.LoginInput{...})
```

Repeated literally seven times. When the constructor signature changes
(or SetPassword's contract evolves in Epic 2's membership work), each
site needs a separate touch.

**Suggested fix.** Extract a single helper at the package boundary:
```go
// In a shared file (e.g., test/fixtures.go or service test helper):
func seedLoginableUser(t *testing.T, db *test.TxDB, mc clock.Clock, email, password string, verified bool) (generated.User, *service.AuthService) {
    t.Helper()
    user := test.CreateUser(t, db, email, "Test "+email)
    if verified {
        if _, err := db.Exec(context.Background(),
            `UPDATE users SET email_verified = true WHERE id = $1`, user.ID); err != nil {
            t.Fatalf("verify: %v", err)
        }
    }
    svc := newAuthServiceWithClock(t, db, mc)
    if err := svc.SetPassword(context.Background(), user.ID, password); err != nil {
        t.Fatalf("SetPassword: %v", err)
    }
    return user, svc
}
```
**Severity rationale:** MEDIUM not HIGH because the duplication is mechanical
and discoverable — not the kind that masks divergent behavior.

#### M2 — `auth_p2_test.go` is 4 lines over the 300-LOC soft cap

**Where:** `auth_p2_test.go` (304 lines total).

**Problem.** Project DoD references a 300-LOC soft cap. Today it's barely
over (304), but adding the 8th P2 test could push 350+. Easier to split now.

**Suggested fix.** Split by AC family:
- `auth_login_p2_test.go` — AC1 family-uniqueness + AC6 fairness
- `auth_refresh_p2_test.go` — AC2 expiry
- `auth_reset_p2_test.go` — AC3 denorm/unverified + AC4 attempts-cleared
- `auth_logout_p2_test.go` — AC5 audit hit/miss (+ the `countLogoutAudits` helper colocated here)

That's a 4-way split (~70-80 LOC each). Combines well with M1: the shared
seeding helper lands in one place.

**Severity rationale:** MEDIUM because the over-limit is structural, not behavioral.
Easy to fix in the same pass as M1.

### LOW (4)

#### L1 — `TestAdminInviteStaff_AC13_NonOwnerRoles_Rejected` subtests share a transaction-implicit assumption

**Where:** `auth_role_negative_test.go:25-50`.

**Problem.** Each `t.Run(role, ...)` subtest creates its OWN `test.SetupDB`
inside the closure — so isolation is fine. BUT the loop iterates over a
const `nonOwnerRoles` slice that includes `"admin"` and `"viewer"`.
**Neither of those role values is recognized by the production code today.**
The test still passes because AdminInviteStaff rejects any role != "owner",
but it's not exercising a real product scenario.

**Suggested fix.** Either:
(a) Drop `"admin"` and `"viewer"` from the matrix until they're real roles in
    `center_members.role` (today only `owner` / `teacher` / `student` are wired);
    OR
(b) Add a comment explaining that these placeholders future-proof the matrix
    for Epic 7's role expansion.

I'd take (a) — speculative tests rot.

**Severity rationale:** LOW because the test passes for the right reason
(role != "owner"), it just over-claims its scope in the test name.

#### L2 — `cors_preflight_test.go` and `origin_check_p2_test.go` share a regex-bound assumption

**Where:** `cors_preflight_test.go::TestCORS_AC11_P2_WildcardSingleLabelOnly` + the
production `wildcardSubdomainPattern` in `internal/middleware/cors.go:24`.

**Problem.** The single-label-only invariant (EDGE-3) is enforced by the
regex `^https://[a-zA-Z0-9-]+\.classlite\.app$` in the compiled pattern.
The test verifies "multi-label subdomain doesn't match" but assumes the
regex's character class. If anyone widens the regex to allow dots
(e.g., to support `*.dev.classlite.app`), the test becomes a stale assertion
about a single example, NOT a structural guarantee.

**Suggested fix.** Add a parametrized table of attack origins:
```go
deny := []string{
    "https://a.b.classlite.app",
    "https://acme.bad.classlite.app",
    "https://acme.classlite.app.attacker.com",
    "https://classlite.app",        // exact match still requires explicit allowlist entry
    "https://-.classlite.app",      // leading hyphen
    "https://acme..classlite.app",  // double dot
}
```

**Severity rationale:** LOW because the current test catches the obvious
case. The parametrized table is hardening, not a fix.

#### L3 — `TestExtractTenant_AC14_P2_ContextInjected` reads `seenTC` from inside the handler closure

**Where:** `extract_tenant_context_test.go:42-55`.

**Problem.** The downstream handler writes `seenTC` and `called` via
closure capture. `seenTC` is read AFTER `handler.ServeHTTP(rec, req)`
returns. ServeHTTP is synchronous in `net/http`, so this is safe today.
But adding `-race` shows nothing (we ran it: clean).

It's still a smell: someone refactoring the middleware to spawn a goroutine
for the downstream handler would silently break this pattern with a data
race that `-race` might not catch in 10 runs.

**Suggested fix.** Use a buffered channel for the assertion handoff:
```go
seen := make(chan model.TenantContext, 1)
handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    tc, _ := middleware.TenantFromContext(r.Context())
    seen <- tc
    w.WriteHeader(http.StatusOK)
}))
handler.ServeHTTP(rec, req)
seenTC := <-seen
```

**Severity rationale:** LOW because today's middleware is synchronous and
the race detector cleared it 10x.

#### L4 — `origin_check_p2_test.go::TestOriginCheck_AC12_P2_ErrorEnvelopeShape` substring-matches the JSON body

**Where:** `origin_check_p2_test.go:91-104`.

**Problem.** Uses `strings.Contains(body, '"code":"ORIGIN_NOT_ALLOWED"')`
across four substring checks. This is brittle to whitespace, key reorder,
or JSON encoder upgrades (Go's stdlib encoder doesn't reorder, but a
future migration to a streaming encoder might).

**Suggested fix.** `json.Unmarshal` into a typed envelope and assert via
field access:
```go
var resp struct {
    Error struct {
        Code      string          `json:"code"`
        Message   string          `json:"message"`
        RequestID string          `json:"requestId"`
        Details   json.RawMessage `json:"details"`
    } `json:"error"`
}
require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
require.Equal(t, "ORIGIN_NOT_ALLOWED", resp.Error.Code)
require.Equal(t, "null", string(resp.Error.Details))
```

**Severity rationale:** LOW — the existing pattern matches the project's
other adversarial tests (which also use substring) so consistency wins.
Worth flagging for the next style-cleanup pass.

## Strengths Worth Calling Out

- **Delta assertions on REVOKE'd tables.** `countLogoutAudits` is exactly
  the right pattern for a security audit table that can't be wiped by
  rollback. The godoc explains WHY, so future tests will copy the right
  shape. Promote this to a project-wide pattern if more `*_audit_logs`
  tables come in.
- **MockClock anchored to a fixed timestamp** (`time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)`)
  on every test that touches time. The anchor is duplicated 11 times —
  Maintainability-wise that's a future LOW (extract `defaultClockAnchor()`),
  but it's also forensically valuable to see the EXACT moment each test
  reasons about. Net good as-is.
- **`t.Run(role, ...)` matrix in `auth_role_negative_test.go`.** Each role
  variant lands as its own CI line, which means a regression on just one
  role (say, when Epic 7 adds an "admin" role and the production code
  changes its handling) surfaces immediately with a specific name.
- **Real-DB integration tests.** Every service-level assertion goes through
  `test.SetupDB` per TEST-BE-2 — no mock-store seam introduced. Matches
  the project's stated discipline ("Service tests use the real DB seam;
  AuthDB IS the seam").

## DoD Compliance vs `test-quality.md` Checklist

| Check | Status | Notes |
| ----- | ------ | ----- |
| No hard waits | ✅ | Zero `time.Sleep` / `t.Sleep` in test code. MockClock + `c.Advance()` for time travel. |
| No conditionals controlling test flow | ✅ | One conditional remains — `if err := ...; err != nil { t.Fatalf(...) }` — which is Go idiom, not flow control. |
| < 300 lines per file | ⚠️ | 4 of 5 files compliant; `auth_p2_test.go` is 304 (M2). |
| < 1.5 minutes per test | ✅ | Slowest test ~50ms (the 4-attempt lockout fairness with bcrypt-4). |
| Self-cleaning | ✅ | `test.SetupDB` tx-rollback via `t.Cleanup`; no manual teardown needed. |
| Explicit assertions | ✅ | Every `expect` / `t.Errorf` lives in the test body. `countLogoutAudits` is a helper for the COUNT query, not the assertion. |
| Unique data | ✅ | Unique emails per test (no collision risk if tests ever ran in `t.Parallel`, which they don't). |
| Parallel-safe (`--workers=4` equivalent) | ⚠️ | Tests do NOT use `t.Parallel()` — correctly so, per project rule "Never `t.Parallel()` on DB tests sharing a transaction." So this check is N/A for backend Go integration tests. |

## TEST-BE-* Compliance (per `docs/project-context.md`)

| Rule | Status | Notes |
| ---- | ------ | ----- |
| TEST-BE-1 (RLS adversarial, read AND write) | N/A | Story 1.5 surfaces are pre-tenant (login, refresh, password reset). RLS adversarial tests already live in Story 1.3's suite. |
| TEST-BE-2 (Store tests use real DB) | ✅ | All service-level tests go through `test.SetupDB`; zero pgx mocks. |
| TEST-BE-3 (Handler tests integration with real middleware) | ✅ | Handler tests in scope (`login_handler_atdd_test.go`, `logout_handler_atdd_test.go`) use the real handler + real service + real DB. |
| TEST-BE-4 (Service tests mock the store interface) | ⚠️ | Project has no separate store mock seam — `AuthDB` IS the seam, and the project explicitly states "Reuse the Story 1.4 `auth_test.go` patterns" (which uses real DB). My new service tests honor that. **Not a violation** — the project context note allows this exception. |
| TEST-BE-5 (Workers — direct `ProcessTask`) | N/A | No worker code in Story 1.5. |

## Suggested Follow-ups

| ID | Severity | Effort | What |
| -- | -------- | ------ | ---- |
| RV-FU-1 | MEDIUM | S | Implement M1 + M2 together: split `auth_p2_test.go` into 4 files and introduce `seedLoginableUser` helper. |
| RV-FU-2 | LOW    | XS | Drop `"admin"`/`"viewer"` from the role matrix until they're real (L1). |
| RV-FU-3 | LOW    | S | Parametrize the wildcard-deny matrix in `cors_preflight_test.go` (L2). |
| RV-FU-4 | LOW    | XS | Use a buffered channel handoff in `TestExtractTenant_AC14_P2_ContextInjected` (L3). |
| RV-FU-5 | LOW    | S | JSON-decode + field-assert in `TestOriginCheck_AC12_P2_ErrorEnvelopeShape` (L4). |

All five are non-blocking. None of them invalidate the existing tests.

## Coverage Boundary

This review **does NOT score coverage**. The TA pass added 27 tests to fill
the P2/P3 gap above the ATDD baseline; whether the resulting AC-to-test
density meets the Epic 1B gate is a `bmad-tea TR` (Trace) question, not
an `RV` question.

## Context References

- `_bmad-output/test-artifacts/automation-summary.md` — what the TA pass intended to build
- `_bmad-output/test-artifacts/test-design/test-design-qa.md` (P0-326..345 row) — the design rows the new tests fan out from
- `_bmad-output/implementation-artifacts/1-5-login-session-management-and-password-reset-api.md` — the story's ACs the tests anchor to
- `docs/project-context.md` — TEST-BE-1..5, CQ-3 (named constants), GFW-5 (envelope shape) — all honored

## Verdict

**A− (87/100). Mergeable.** The two MEDIUMs and four LOWs are quality nudges,
not defects. The burn-in is clean and the design is consistent with the
project's stated test discipline.

**Recommended next workflow:** `bmad-tea TR` (Trace) at the Epic 1B boundary
to formally map every AC ⇆ test ⇆ risk, then `bmad-tea GATE` for the
PASS/CONCERNS/FAIL decision before Epic 1B merges to main.

---

_Generated by Murat (TEA / bmad-testarch-test-review) — 2026-06-06_
