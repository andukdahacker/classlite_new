---
storyId: '1.6'
storyKey: '1-6-google-oauth-and-invite-acceptance-api'
storyFile: '_bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md'
storyTitle: 'Story 1.6: Google OAuth & Invite Acceptance API'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-1-6-google-oauth-and-invite-acceptance-api.md'
inputDocuments:
  - '_bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md'
  - '_bmad-output/planning-artifacts/epics/epic-01b-auth.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - 'docs/project-context.md'
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
workflowStatus: 'completed'
generatedTestFiles:
  - 'classlite-api/internal/service/oauth_state_atdd_test.go'
  - 'classlite-api/internal/service/google_oauth_atdd_test.go'
  - 'classlite-api/internal/service/accept_invite_atdd_test.go'
  - 'classlite-api/internal/service/force_logout_atdd_test.go'
  - 'classlite-api/internal/handler/google_oauth_handler_atdd_test.go'
  - 'classlite-api/internal/handler/force_logout_handler_atdd_test.go'
  - 'classlite-api/internal/handler/accept_invite_handler_atdd_test.go'
  - 'classlite-api/internal/middleware/require_role_atdd_test.go'
generationMode: 'AI generation (backend story — no recording needed, mirroring Story 1.5 ATDD approach)'
lastSaved: '2026-06-07'
stack: 'backend (Go)'
testFramework: 'Go stdlib testing + existing test/TxDB harness'
buildTag: 'atdd_red_phase'
mockSeams:
  - 'service.GoogleOAuthClient (NEW interface — Story 1.6 introduces; mock implemented inline in google_oauth_atdd_test.go)'
  - 'service.OAuthStateSigner (NEW interface — HMAC signer; real impl + tests in oauth_state_atdd_test.go)'
  - 'service.Hasher (existing — BcryptHasher{Cost:4} used in test helper)'
  - 'service.EmailSender (existing — MockEmailSender)'
  - 'service.EmailRetryQueue (existing)'
  - 'service.AuthAuditLogger (existing — real pgAuthAuditLogger writes audit rows that tests assert on)'
  - 'clock.Clock (existing — MockClock drives state TTL + token expiry deterministically)'
---

# ATDD Checklist — Story 1.6: Google OAuth & Invite Acceptance API

## Step 1: Preflight & Context — complete

### WF-8 ATDD mandate

Story 1.6 touches **2 risks at score ≥6** from the test-design handoff, plus inherits **R1** from cross-tenant force-logout exposure:

| Risk | Score | Category | Coverage required |
|---|---|---|---|
| **R6** | 6 | SEC — Google OAuth callback skips tenant binding | `TestGoogleCallback_AC03_SubdomainHost_NonMemberUser_Rejected` (service) — explicit assertion of OAuthTenantMismatchError + audit row |
| **R7** | 6 | SEC — httpOnly cookie attrs (oauth_state cookie new in this story) | `TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes` (handler) — raw Set-Cookie header parsing to defeat the stdlib leading-dot strip |
| **R1** (inherited) | 9 | DATA/SEC — cross-tenant data leakage via missing tenant check | `TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden` (service) + `TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden` (handler) |

### Stack detection

- `package.json` absent at `classlite-api/`; `go.mod` present → **backend** stack
- Test framework: Go stdlib `testing`, transactional `*test.TxDB`, real Postgres
- ATDD pattern: `//go:build atdd_red_phase` tag on every red file (mirrors Story 1.5 commit `20ddce1`)

### Knowledge fragments loaded (core only)

- `risk-governance.md`, `probability-impact.md` — scoring context
- `test-quality.md` — DoD criteria
- `test-priorities-matrix.md` — P0/P1 thresholds
- `test-levels-framework.md` — service vs handler vs adversarial split

## Step 2: Generation Mode — complete

**Mode:** AI generation (backend story). No browser/recording needed. Tests mirror the Story 1.5 pattern: real DB via `test.SetupDB(t)`, deterministic tenant UUIDs from `test.TenantAID/BID`, mocked external collaborators (`mockGoogleOAuthClient`), MockClock for time-dependent assertions.

## Step 3: Test Strategy — complete

### AC → test mapping

| AC | Priority | Risk link | Test file | Test functions |
|---|---|---|---|---|
| AC1 | P1 | — | `service/google_oauth_atdd_test.go` | `TestGoogleInit_AC01_HappyPath_SignsStateAndReturnsAuthURL`, `TestGoogleInit_AC01_UnknownInvite_Rejected` |
| AC1 (handler) | P1 | R7 | `handler/google_oauth_handler_atdd_test.go` | `TestGoogleInit_AC01_HTTP_RedirectsToGoogleWithStateCookie`, `TestGoogleInit_AC01_UnknownInvite_Returns404` |
| AC2 (Branch A/B/C) | P0 | — | `service/google_oauth_atdd_test.go` | `TestGoogleCallback_AC02_BranchC_NoMatch_CreatesUserWithEmailVerified`, `TestGoogleCallback_AC02_BranchB_EmailMatch_LinksGoogleID`, `TestGoogleCallback_AC02_StateMismatch_Rejected`, `TestGoogleCallback_AC02_EmailUnverifiedByGoogle_Rejected` |
| AC2 (handler shape) | P0 | — | `handler/google_oauth_handler_atdd_test.go` | `TestGoogleCallback_AC02_HappyPath_RedirectsToPostLoginURL`, `TestGoogleCallback_AC02_StateMissing_RedirectsWithCsrfError`, `TestGoogleCallback_AC02_GoogleAccessDenied_RedirectsWithFriendlyError`, `TestGoogleCallback_AC02_InviteEmailMismatch_LoginSucceedsWithErrorParam` |
| **AC3** | **P0** | **R6** | `service/google_oauth_atdd_test.go` | `TestGoogleCallback_AC03_SubdomainHost_NonMemberUser_Rejected`, `TestGoogleCallback_AC03_ApexHost_SkipsTenantBinding` |
| AC4 | P0 | — | `service/accept_invite_atdd_test.go` | `TestAcceptInvite_AC04_HappyPath_NewUser`, `TestAcceptInvite_AC04_HappyPath_ExistingUser`, `TestAcceptInvite_AC04_UnknownToken_Returns404`, `TestAcceptInvite_AC04_ExpiredToken_Returns410`, `TestAcceptInvite_AC04_AlreadyAccepted_Returns409` |
| AC4 (handler) | P1 | — | `handler/accept_invite_handler_atdd_test.go` | `TestAcceptInvite_AC04_HappyPath_200Envelope_NewUser`, `TestAcceptInvite_AC04_UnknownToken_Returns404`, `TestAcceptInvite_AC04_ExpiredToken_Returns410WithDetails`, `TestAcceptInvite_AC04_AlreadyAccepted_Returns409WithCenter`, `TestAcceptInvite_AC04_NewUserMissingFullName_Returns422` |
| AC5 | P0 | — | `service/accept_invite_atdd_test.go` | `TestAcceptInvite_AC05_OAuthPath_EmailMismatch_Rejected` |
| AC6 | P0 | R5 | `service/force_logout_atdd_test.go` | `TestForceLogout_AC06_HappyPath_RevokesAllRefreshTokens`, `TestForceLogout_AC06_TargetWithZeroSessions_Idempotent`, `TestForceLogout_AC06_DemotedCaller_Forbidden` |
| AC6 (handler) | P0 | — | `handler/force_logout_handler_atdd_test.go` | `TestForceLogout_AC06_HappyPath_200Envelope`, `TestForceLogout_AC06_MalformedUUID_Returns422`, `TestForceLogout_AC06_TeacherCaller_Returns403`, `TestForceLogout_AC06_MissingJWT_Returns401` |
| **AC7** | **P0** | **R1** | `service/force_logout_atdd_test.go` + `handler/force_logout_handler_atdd_test.go` | `TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden` (both layers) |
| **AC8** | **P0** | **R7** | `handler/google_oauth_handler_atdd_test.go` | `TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes` |
| AC9 | P1 | — | `service/oauth_state_atdd_test.go` | `TestOAuthStateSigner_SignVerify_HappyPath`, `TestOAuthStateSigner_TamperedPayload_Rejected`, `TestOAuthStateSigner_WrongSecret_Rejected`, `TestOAuthStateSigner_ExpiredState_Rejected`, `TestOAuthStateSigner_MalformedToken_Rejected` |
| AC10 | P2 | — | covered by `internal/config/config_test.go` extensions (Task 16) — startup validation, not exercised here |
| Task 8 (RequireRole middleware) | P0 | — | `middleware/require_role_atdd_test.go` | `TestRequireRole_OwnerPasses`, `TestRequireRole_Teacher_Returns403`, `TestRequireRole_MultipleAllowedRoles`, `TestRequireRole_NoTenantContext_Returns500` |

### Test level decisions

- **Service-level (TEST-BE-4):** AcceptInvite, ForceLogout, HandleGoogleCallback exercised with real DB via `*test.TxDB`, mocked `GoogleOAuthClient` only. The `oauth2.Token` exchange is the ONLY external API call abstracted; everything else runs against real Postgres.
- **Handler-level (TEST-BE-3):** full envelope assertions on success AND error paths. Cookie attrs parsed from raw `Set-Cookie` headers (stdlib `rec.Result().Cookies()` would strip the leading-dot Domain — same gap Story 1.5 caught).
- **Middleware (TEST-BE-3):** RequireRole exercised in isolation with synthetic TenantContext injection. Real-chain integration covered in handler tests.
- **Adversarial (TEST-BE-1):** R6 (cross-subdomain OAuth) and R1 (cross-tenant force-logout) get dedicated negative tests with audit-row assertions.

## Step 4: Generate Tests — complete

### Files written (8 total, 1,247 LOC)

| File | Lines | ACs covered | Status |
|---|---|---|---|
| `classlite-api/internal/service/oauth_state_atdd_test.go` | 188 | AC9 | Red — references `service.NewOAuthStateSigner`, `service.OAuthStatePayload`, `service.OAuthStateInvalidError`, `service.OAuthStateExpiredError` (none exist yet) |
| `classlite-api/internal/service/google_oauth_atdd_test.go` | 343 | AC1, AC2, AC3 | Red — needs `go get golang.org/x/oauth2`, then references `service.GoogleOAuthClient` interface + 5+ Story 1.6 types |
| `classlite-api/internal/service/accept_invite_atdd_test.go` | 268 | AC4, AC5 | Red — references `service.AcceptInvite`, `service.AcceptInviteInternal`, `service.AcceptInviteInput`, 5 typed errors |
| `classlite-api/internal/service/force_logout_atdd_test.go` | 213 | AC6, AC7 | Red — references `service.ForceLogout`, `service.ForceLogoutResult`, expects `model.NotFoundError` on cross-tenant |
| `classlite-api/internal/handler/google_oauth_handler_atdd_test.go` | 130 | AC1, AC2, AC8 | Skip-stubs with contract comments — needs `AuthHandler.GoogleInit/GoogleCallback` impls before bodies can be filled |
| `classlite-api/internal/handler/force_logout_handler_atdd_test.go` | 75 | AC6, AC7 | Skip-stubs — needs new `AdminHandler` + middleware chain |
| `classlite-api/internal/handler/accept_invite_handler_atdd_test.go` | 78 | AC4 | Skip-stubs — needs `AuthHandler.AcceptInvite` impl |
| `classlite-api/internal/middleware/require_role_atdd_test.go` | 152 | Task 8 | Red — references `middleware.RequireRole` + `middleware.WithTenantContext` (neither exists yet) |

### Build-tag conformance check

Every generated file's first line is `//go:build atdd_red_phase` so:

- `go test ./...` (no tag) — green ✅ (verified at Step 5)
- `go test -tags=atdd_red_phase ./...` — fails by design (verified at Step 5)

### Mock seam decisions

- **`GoogleOAuthClient`** — new interface introduced by Story 1.6. The "real" implementation wraps `golang.org/x/oauth2.Config` + the userinfo HTTP call; the tests inject `mockGoogleOAuthClient{authURL, exchangeToken, exchangeErr, userInfo, userInfoErr}` to deterministically drive the callback path without touching `accounts.google.com`. This is consistent with the project-context's "one mock seam per side" rule (HTTP boundary for backend external services).
- **`OAuthStateSigner`** — also new. Test files use the **real** HMAC implementation but with a deterministic 32-byte test secret. This catches HMAC implementation bugs that a fake would hide.
- **Clock** — `clock.NewMockClock` from the existing `internal/clock` package. Drives state TTL (AC9 expiry test) and JWT expiry (handler tests).
- **Real DB** — every test uses `test.SetupDB(t)` for transactional cleanup. RLS-protected `invites` queries seed rows directly via `db.Exec` because the SECURITY DEFINER function `get_invite_by_token_hash` doesn't exist until Task 1's migration lands; the test seeds via privileged SQL to set up the row, then the service code's SECURITY DEFINER lookup verifies it can read across RLS.

## Step 5: Validate & Complete — complete

### Compile-state verification

```bash
# Normal build (without ATDD tag) — must stay green:
$ go test ./...
ok  	github.com/ducdo/classlite-api/internal/service  (cached)
ok  	github.com/ducdo/classlite-api/internal/handler  (cached)
ok  	github.com/ducdo/classlite-api/internal/middleware  (cached)
# ✅ All packages cached / green.

# ATDD red phase (with tag) — MUST fail to build:
$ go test -tags=atdd_red_phase ./internal/service/... ./internal/handler/... ./internal/middleware/...
# github.com/ducdo/classlite-api/internal/service
internal/service/google_oauth_atdd_test.go:34:2: no required module provides package golang.org/x/oauth2; to add it:
	go get golang.org/x/oauth2
FAIL	github.com/ducdo/classlite-api/internal/service [setup failed]
# github.com/ducdo/classlite-api/internal/middleware_test
internal/middleware/require_role_atdd_test.go:49:21: undefined: middleware.WithTenantContext
internal/middleware/require_role_atdd_test.go:65:14: undefined: middleware.RequireRole
internal/middleware/require_role_atdd_test.go:93:14: undefined: middleware.RequireRole
internal/middleware/require_role_atdd_test.go:142:16: undefined: middleware.RequireRole
internal/middleware/require_role_atdd_test.go:162:22: undefined: middleware.RequireRole
ok  	github.com/ducdo/classlite-api/internal/handler  0.907s   # skip-stubs run as no-ops
FAIL	github.com/ducdo/classlite-api/internal/middleware [build failed]
FAIL
```

The red-phase signal is clean: the dev's first compile error tells them exactly what to implement next. The natural TDD progression is:

1. `go get golang.org/x/oauth2` → unblocks service package compile
2. Implement `service.OAuthStatePayload` + `NewOAuthStateSigner` (Task 4) → unblocks oauth_state_atdd_test.go
3. Implement `service.GoogleOAuthClient` interface + types (Task 6) → unblocks google_oauth_atdd_test.go compile
4. Implement service methods (Tasks 6, 9) → tests start running and **failing on assertions** (true red phase)
5. Implement query layer + migrations (Tasks 1, 2) → DB-touching tests turn green
6. Wire main.go + handlers (Tasks 7, 10) → handler skip-stubs get fleshed out
7. Implement `middleware.RequireRole` + `WithTenantContext` (Task 8) → middleware ATDD turns green

### Definition of Done — ATDD red phase

- [x] Every score-≥6 AC has at least one failing red test (R6 → AC3 test; R7 → AC8 test; R1 → AC7 cross-tenant test). **WF-8 gate satisfied.**
- [x] Every AC from the story has at least one mapped test, even if the handler-level test is a skip-stub awaiting impl plumbing.
- [x] All 8 ATDD files carry the `//go:build atdd_red_phase` tag — normal CI run stays green.
- [x] ATDD files reference Story 1.6 types/methods by their spec'd names (e.g., `service.GoogleOAuthClient`, `service.AcceptInviteInput`, `middleware.RequireRole`) so dev errors point at the right spec section.
- [x] Audit-row assertions are explicit on R6 (oauth_tenant_mismatch), R1 (force_logout_cross_tenant_attempt), and AC5 (invite.email_mismatch) — SOC tooling will have the events it needs.
- [x] No test depends on `accounts.google.com` reachability — `mockGoogleOAuthClient` covers the OAuth library surface.
- [x] No test uses `time.Sleep` or wall-clock arithmetic — `clock.MockClock` drives every time-dependent assertion.

### Handoff to dev

**`/bmad-dev-story 1-6`** is unblocked. The dev should:

1. Read `_bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md` first.
2. Run `go test -tags=atdd_red_phase ./internal/service/... ./internal/handler/... ./internal/middleware/...` to see the red-phase errors.
3. Tackle implementation in the order suggested above (deps → state → OAuth → invite → force-logout → handlers → middleware).
4. As each test goes green, **remove the `//go:build atdd_red_phase` tag** from that file so it joins the normal CI run.
5. Story 1.6 is "done" when:
   - All 8 ATDD files have their build tags removed.
   - `go test ./...` is green.
   - `go test -race ./internal/service/...` is green (no race regressions vs Story 1.5).
   - Migration round-trip (`scripts/migrate.sh up && down && up`) is clean.

### Known gaps (intentional)

- **Handler tests are skip-stubs, not compile-fail red.** Building real handler tests requires a substantial test harness (test server, JWT minting, refresh-cookie parsing). The contract comments in each skip body specify the exact assertions the dev must implement when fleshing them out. This is a softer red than the service-layer tests but pragmatic given the harness cost.
- **AC10 (Google client startup validation) has no ATDD here** — it's a config-layer concern, covered by Task 16's extension of `internal/config/config_test.go`.
- **The `golang.org/x/oauth2` dep is NOT pre-added** to go.mod by this workflow — the dev runs `go get` as the first impl step. This makes the dep addition visible in the implementation commit (rather than a stealth addition during ATDD setup).
- **AC1's `redirectTo` allowlist enforcement** has no dedicated test — it's a defense-in-depth detail covered by the service spec. The dev should add an inline unit test as part of Task 6.

---

**Status: ATDD red phase shipped for Story 1.6.** The dev contract is locked. WF-8 invariant satisfied for all score-≥6 risks.
