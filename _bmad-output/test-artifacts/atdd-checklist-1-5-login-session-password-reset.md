---
storyId: '1.5'
storyKey: '1-5-login-session-password-reset'
storyFile: '_bmad-output/planning-artifacts/epics/epic-01b-auth.md'
storyTitle: 'Story 1.5: Login, Session Management & Password Reset API'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-1-5-login-session-password-reset.md'
generatedTestFiles: []
inputDocuments:
  - '_bmad-output/planning-artifacts/epics/epic-01b-auth.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/blocker-resolutions-2026-06-04.md'
  - 'docs/project-context.md'
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
workflowStatus: 'completed'
generatedTestFiles:
  - 'classlite-api/internal/service/login_atdd_test.go'
  - 'classlite-api/internal/service/refresh_atdd_test.go'
  - 'classlite-api/internal/service/password_reset_atdd_test.go'
  - 'classlite-api/internal/service/role_revalidation_atdd_test.go'
  - 'classlite-api/internal/middleware/origin_atdd_test.go'
  - 'classlite-api/internal/middleware/auth_atdd_test.go'
  - 'classlite-api/internal/middleware/cors_atdd_test.go'
  - 'classlite-api/internal/handler/login_handler_atdd_test.go'
  - 'classlite-api/internal/handler/logout_handler_atdd_test.go'
  - 'classlite-api/cmd/api/signing_key_validation_atdd_test.go'
generationMode: 'AI generation (backend story — no recording needed)'
lastSaved: '2026-06-05'
stack: 'fullstack (backend-heavy story)'
testFramework: 'Go stdlib testing + testify (existing pattern from Story 1.3, 1.4)'
mockSeams:
  - 'AuthService.Hasher (already split: Hasher + MockHasher per Story 1.4)'
  - 'AuthService.EmailSender (already split: EmailSender + MockEmailSender per Story 1.2d)'
  - 'AuthService.EmailRetryQueue (Story 1.4)'
  - 'AuthService.Clock (Story 1.4 + Phase 0.1 shared clock package)'
  - 'AuthService.AuthAuditLogger (Story 1.3b)'
---

# ATDD Checklist — Story 1.5: Login, Session Management & Password Reset API

## Step 1: Preflight & Context — complete

### WF-8 ATDD mandate

Story 1.5 touches **6 risks at score ≥6** from the test-design handoff:

| Risk | Score | Category | Coverage required |
|---|---|---|---|
| **R4** | 6 | SEC | JWT center_id spoofing rejection |
| **R5** | 6 | SEC | Refresh token rotation + family-revocation on reuse |
| **R7** | 6 | SEC | Cookie HttpOnly + Secure + SameSite + Domain attributes in non-dev |
| **R8** | 6 | SEC | CORS allowlist (no wildcard with credentials) |
| **R13** | 6 | SEC | Rate-limit token bucket on auth endpoints |
| **R15** | 6 | SEC | Service-layer role re-validation from DB on mutating ops |

Per WF-8: **ATDD red tests are MANDATORY** for these. Story 1.5 cannot transition to `in-progress` until the red scaffolds exist on the branch.

### Acceptance criteria (consolidated from epic + risk register)

Core happy-path ACs:

1. **AC-1.5-01** — Valid login issues access (15 min) + refresh (7 d / 30 d Remember Me) tokens; refresh sets `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.classlite.app` cookie
2. **AC-1.5-02** — Refresh rotation: new access + new refresh; old refresh DELETED in same tx
3. **AC-1.5-03** — Password reset request: email sent (or silent on unknown email — no enumeration)
4. **AC-1.5-04** — Password reset apply: password updated, all refresh tokens for user invalidated, reset token consumed
5. **AC-1.5-05** — Logout: refresh token invalidated, cookie cleared

Risk-driven ACs (all P0 per WF-8 hard rule):

6. **AC-1.5-06 (R13)** — Lockout: 5 failed logins in 10 min → 6th attempt returns 423 with Retry-After
7. **AC-1.5-07 (R13)** — Lockout clears after 15 min of timer
8. **AC-1.5-08 (R5)** — Refresh reuse detection: stolen-token replay revokes the entire family
9. **AC-1.5-09 (R5)** — Concurrent refresh race: two parallel calls with same old token → exactly one succeeds, the loser revokes the family
10. **AC-1.5-10 (R7)** — `Set-Cookie` in non-dev env carries all four attributes
11. **AC-1.5-11 (R8)** — CORS allowlist matches `https://classlite.app`, `https://my.classlite.app`, `https://{slug}.classlite.app`; never `*` with credentials; `Vary: Origin` always emitted
12. **AC-1.5-12 (R8 defense)** — Origin header check on POST/PUT/DELETE/PATCH rejects with 403 ORIGIN_NOT_ALLOWED if mismatch
13. **AC-1.5-13 (R15)** — Mutating service call re-fetches role from DB; demoted teacher's mutation rejected with 403 INSUFFICIENT_ROLE even with valid JWT
14. **AC-1.5-14 (R4)** — Forged JWT (valid signature, spoofed `center_id`) rejected with 403 INVALID_TENANT_CLAIM + audit log entry

Failure-path ACs (per epic):

15. **AC-1.5-15** — JWT signing key < 256 bits OR missing → API refuses to start with clear error
16. **AC-1.5-16** — Valid JWT signature but deleted user_id → 401 (not 500)

### Loaded knowledge fragments

- `risk-governance.md`, `probability-impact.md` (P0 rule: score ≥6 → MITIGATE, score = 9 → BLOCK)
- `test-levels-framework.md` (Go integration with real DB in tx = correct level for these tests)
- `test-priorities-matrix.md`
- `test-quality.md` (no hard waits; deterministic via MockClock; <300 LOC per test)

### Test infrastructure available (Phase 0 + Story 1.3/1.4 inheritance)

- `internal/test/helpers.go::SetupDB(t)` — tx-wrapped, auto-rollback
- `internal/test/fixtures.go` — `TenantAID`, `TenantBID`, `CreateUser`, `CreateCenter`, `CreateCenterWithID`, `CreateCenterMember`
- `internal/clock` — `RealClock`, `MockClock` with `Advance(d)`/`Set(t)` (Phase 0.1)
- `internal/test/workers/harness.go` — worker tenant harness (Phase 0.2 — not used in Story 1.5 directly but available)
- `internal/service/hasher.go` + `hasher_mock.go` — `MockHasher` for fast tests
- `internal/service/email_mock.go` — `MockEmailSender` records sends
- Story 1.4's `auth_test.go` and `auth_handler_test.go` — copy these patterns for Story 1.5

### Affected files (planned)

| New / Modified | File | Purpose |
|---|---|---|
| Modify | `internal/service/auth.go` | Add `Login`, `RefreshTokens`, `RequestPasswordReset`, `ResetPassword`, `Logout` methods |
| Modify | `internal/handler/auth_handler.go` | Add `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/logout` |
| New | `internal/middleware/auth.go` | JWT extraction + `extractTenant` middleware (already partial via tenant claim check) |
| New | `internal/middleware/origin.go` | Origin header validation for mutating routes |
| Modify | `internal/middleware/cors.go` | Tighten allowlist; add `Vary: Origin`; assert no wildcard with credentials |
| Modify | `internal/middleware/rate_limit.go` | Per-account `(IP, email)` keying for login |
| New migration | `migrations/202606XXXXXXXX_add_refresh_token_family_id.up.sql` | Add `family_id` column for reuse detection |
| New | `internal/service/jwt.go` (or extend auth.go) | JWT signing + validation with `center_id` re-validation |
| New tests | `internal/service/login_test.go`, `internal/service/refresh_test.go`, `internal/service/password_reset_test.go` | Service-layer integration |
| New tests | `internal/handler/login_handler_test.go`, `internal/handler/refresh_handler_test.go`, `internal/handler/password_reset_handler_test.go`, `internal/handler/logout_handler_test.go` | Handler integration |
| New tests | `internal/middleware/origin_test.go`, `internal/middleware/auth_test.go`, `internal/middleware/cors_test.go` (extend) | Middleware integration |
| New tests | `cmd/api/main_signing_key_test.go` | Startup-time signing key validation |

## Step 2: Generation Mode — complete

**Mode: AI generation.** Story 1.5 is pure Go backend; no browser/UI work in scope. Tests target service + handler + middleware layers using existing `test.SetupDB(t)` pattern. No recording needed.

## Step 3: Test Strategy — complete

### Test level + priority map

| AC | Description | Level | Priority | Risk | Test file |
|---|---|---|---|---|---|
| 1.5-01 | Valid login → tokens + cookie shape | Service-integration | **P0** | R7 | `service/login_test.go` |
| 1.5-02 | Refresh rotation: new tokens + old deleted in same tx | Service-integration | **P0** | R5 | `service/refresh_test.go` |
| 1.5-03 | Password reset request: silent on unknown email | Service-integration | **P0** | enum-defense | `service/password_reset_test.go` |
| 1.5-04 | Password reset apply: password updated + all sessions invalidated + token consumed | Service-integration | **P0** | — | `service/password_reset_test.go` |
| 1.5-05 | Logout: refresh token invalidated + cookie cleared | Handler-integration | **P1** | — | `handler/logout_handler_test.go` |
| 1.5-06 | Lockout: 5 fails in 10 min → 423 + Retry-After | Service-integration | **P0** | **R13** | `service/login_test.go` |
| 1.5-07 | Lockout clears after 15 min (MockClock time-travel) | Service-integration | **P0** | **R13** | `service/login_test.go` |
| 1.5-08 | Refresh reuse detection: revoke family on reuse | Service-integration | **P0** | **R5** | `service/refresh_test.go` |
| 1.5-09 | Concurrent refresh race: exactly one wins | Service-integration | **P0** | **R5** | `service/refresh_test.go` |
| 1.5-10 | Cookie HttpOnly+Secure+SameSite+Domain in non-dev | Handler-integration | **P0** | **R7** | `handler/login_handler_test.go` |
| 1.5-11 | CORS allowlist + Vary: Origin + no `*` with credentials | Middleware-integration | **P0** | **R8** | `middleware/cors_test.go` (extend) |
| 1.5-12 | Origin header check on mutating routes | Middleware-integration | **P0** | **R8** | `middleware/origin_test.go` |
| 1.5-13 | Service-layer role re-val from DB | Service-integration | **P0** | **R15** | `service/role_revalidation_test.go` |
| 1.5-14 | Forged JWT center_id rejected by extractTenant | Middleware-integration | **P0** | **R4** | `middleware/auth_test.go` |
| 1.5-15 | JWT signing key validation at startup | Unit | **P1** | — | `cmd/api/signing_key_validation_test.go` |
| 1.5-16 | Valid JWT for deleted user → 401 not 500 | Middleware-integration | **P1** | — | `middleware/auth_test.go` |

**No duplicate coverage:** Service-level tests assert business rules (token rotation, lockout state machine, role re-val). Handler-level tests assert HTTP shape (cookie attrs, envelope). Middleware-level tests assert request guards (CORS, Origin, JWT extract). No AC is tested at two levels.

### Red phase guarantee

Every test below references types, methods, and endpoints that **do not yet exist** in the codebase:
- `service.AuthService.Login`, `RefreshTokens`, `RequestPasswordReset`, `ResetPassword`, `Logout`
- `service.AuthService.LoginLockout` (or equivalent internal state machine)
- `POST /api/auth/login`, `/refresh`, `/forgot-password`, `/reset-password`, `/logout` handlers
- `middleware.OriginCheck`, `middleware.ExtractTenant`
- `service.JWTConfig` startup validation

All tests will FAIL until Story 1.5 implementation lands. Dev runs them, sees red, implements until green.

### Test infrastructure dependencies

- `internal/clock` (Phase 0.1) — `MockClock` for lockout timer + token expiry tests
- `internal/test/helpers.go` — `SetupDB(t)`, `TenantContext`
- `internal/test/fixtures.go` — `TenantAID`, `CreateUser`, `CreateCenter`, `CreateCenterMember`
- `internal/service/hasher_mock.go` — `MockHasher` (bypass bcrypt cost-12 in tests)
- `internal/service/email_mock.go` — `MockEmailSender` records sends

## Step 4: Red-Phase Generation — complete

10 scaffold files written. Build tag `//go:build atdd_red_phase` keeps them OUT of the normal `go test` run so the suite stays green during ATDD.

### Verification

```bash
# Normal build — must stay green:
cd classlite-api && go test ./...
# → all packages OK

# ATDD red-phase build — must FAIL with undefined symbols:
go test -tags=atdd_red_phase ./...
# → "undefined: service.Login", "undefined: middleware.ExtractTenant", etc.
```

### Generated files

| File | Tests | ACs | Risks |
|---|---|---|---|
| `internal/service/login_atdd_test.go` | 4 | 01, 06, 07 | R7, R13 |
| `internal/service/refresh_atdd_test.go` | 3 | 02, 08, 09 | R5 |
| `internal/service/password_reset_atdd_test.go` | 3 | 03, 04 | enum-defense |
| `internal/service/role_revalidation_atdd_test.go` | 2 | 13 | R15 |
| `internal/middleware/origin_atdd_test.go` | 4 | 12 | R8 |
| `internal/middleware/auth_atdd_test.go` | 2 | 14, 16 | R4 |
| `internal/middleware/cors_atdd_test.go` | 4 | 11 | R8 / SEC-5 |
| `internal/handler/login_handler_atdd_test.go` | 2 | 01, 10 | R7 |
| `internal/handler/logout_handler_atdd_test.go` | 1 | 05 | — |
| `cmd/api/signing_key_validation_atdd_test.go` | 4 | 15 | — |
| **Total** | **29 tests** | **all 16 ACs** | **R4, R5, R7, R8, R13, R15** |

## Step 5: Implementation Checklist for `/bmad-dev-story`

### How dev runs ATDD

For each AC, the dev:
1. Run `go test -tags=atdd_red_phase ./internal/<pkg>/...` — read the undefined-symbol errors as the to-do list.
2. Add the missing struct / method / function with a minimal signature.
3. Re-run with the tag — file now compiles; tests run and FAIL on assertions.
4. Implement business logic until the tests pass.
5. When the entire AC's tests are green, remove `//go:build atdd_red_phase` from the file so the tests run in the normal suite.
6. Run `go test ./...` (no tag) — must still be green.

### Implementation order (recommended)

#### Wave 1 — Type / interface foundations (~2 hours)

| Symbol | File | Purpose |
|---|---|---|
| `service.LoginInput` (struct) | `service/auth.go` | Login request shape |
| `service.LoginResult` (struct) | `service/auth.go` | AccessToken/RefreshToken/expiries |
| `service.InvalidCredentialsError` | `service/errors.go` (new) | Mapped to 401 |
| `service.AccountLockedError` | `service/errors.go` | Mapped to 423 with Retry-After |
| `service.TokenReuseDetectedError` | `service/errors.go` | Mapped to 401 forcing re-login |
| `service.ResetTokenConsumedError` | `service/errors.go` | Mapped to 410 Gone |
| `service.ForbiddenError` | `service/errors.go` | Mapped to 403 INSUFFICIENT_ROLE |
| `service.AccessClaims` (struct) | `service/jwt.go` (new) | JWT claims: UserID, CenterID, Role |
| `service.NewJWTSigner` | `service/jwt.go` | Constructor with key validation |
| `service.HashRefreshToken` | `service/jwt.go` | Canonical hashing scheme |
| `service.NewAuthServiceWithClock` | `service/auth.go` | Extended constructor accepting `clock.Clock` |
| `handler.CookieConfig` (struct) | `handler/auth_handler.go` | Domain / Secure / SameSite |
| `middleware.CORSConfig` (struct) | `middleware/cors.go` | Wraps existing CORS state |
| `middleware.NewCORS` | `middleware/cors.go` | Constructor taking CORSConfig |

#### Wave 2 — Database migrations (~30 min)

| Migration | Tables / columns added |
|---|---|
| `add_refresh_token_family_id.up.sql` | `refresh_tokens.family_id uuid NOT NULL` (R5 reuse detection) |
| `add_password_resets.up.sql` | `password_resets (token, user_id, email, expires_at, consumed_at)` |
| `add_login_failures.up.sql` | Track recent failures per `(user_id, ip)` for lockout |

#### Wave 3 — Service methods (~1 day)

1. `AuthService.SetPassword(ctx, userID, password)` — bcrypt hash + UPDATE users
2. `AuthService.Login(ctx, LoginInput) (LoginResult, error)` — drives AC-01, AC-06, AC-07
3. `AuthService.RefreshTokens(ctx, refreshToken) (LoginResult, error)` — drives AC-02, AC-08, AC-09
4. `AuthService.RequestPasswordReset(ctx, email)` — drives AC-03
5. `AuthService.ResetPassword(ctx, token, newPassword)` — drives AC-04
6. `AuthService.Logout(ctx, refreshToken)` — drives AC-05
7. `AuthService.AdminInviteStaff(ctx, tc, email, role)` — drives AC-13 (re-fetches role from DB)

#### Wave 4 — Middleware (~4 hours)

1. `middleware.NewOriginCheck(allowedOrigins) func(http.Handler) http.Handler` — drives AC-12
2. `middleware.NewCORS(CORSConfig) func(http.Handler) http.Handler` — extend existing; drives AC-11
3. `middleware.ExtractTenant(db, jwtSigner) func(http.Handler) http.Handler` — drives AC-14, AC-16

#### Wave 5 — Handlers (~4 hours)

1. `handler.NewAuthHandler(svc, cookieCfg)` — constructor wiring
2. `handler.AuthHandler.Login` — drives AC-01, AC-10
3. `handler.AuthHandler.Refresh` — drives AC-02
4. `handler.AuthHandler.ForgotPassword` / `ResetPassword` — drives AC-03, AC-04
5. `handler.AuthHandler.Logout` — drives AC-05

#### Wave 6 — Startup validation (~30 min)

1. `cmd/api/validateSigningKey([]byte) error` — drives AC-15; called from `main.go`

### Activation order

Remove `//go:build atdd_red_phase` from a file ONLY when every test in it is green under the tag. Once removed, the tests run in the normal suite and must stay green forever.

### Definition of Done for Story 1.5

- [ ] All 29 ATDD tests passing under normal `go test ./...` (build tag removed)
- [ ] All 6 score-≥6 risks (R4, R5, R7, R8, R13, R15) have linked test evidence
- [ ] `golangci-lint run` clean
- [ ] Migration up + down + up cycle preserves data
- [ ] No regressions in shipped Story 1.1–1.4 tests
- [ ] Handler integration test asserts full envelope shape (TEST-BE-3)
- [ ] Service-layer tests use `MockHasher` (no bcrypt cost-12 in unit tests)
- [ ] Manual smoke: real login via curl against staging produces correct Set-Cookie headers
- [ ] `/bmad-tea TA` run produces expanded P2/P3 coverage
- [ ] `/bmad-tea RV` audit clean (no hard waits, no hidden assertions, <300 LOC per test)

### After Story 1.5 (per WF-8)

- `/bmad-tea TA` to expand to P2/P3 + edge cases
- `/bmad-tea RV` quality audit
- At Epic 1B boundary: `/bmad-tea TR` traceability + `/bmad-tea NR` NFR audit + `/bmad-tea GATE`
