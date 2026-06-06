---
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-quality-evaluation
  - step-04-generate-report
lastStep: step-04-generate-report
lastSaved: '2026-06-06'
reviewer: Murat (Test Architect)
scope: directory
target: Story 1.5 ATDD red-phase contracts
execution_mode: sequential
inputDocuments:
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/test-priorities-matrix.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/api-testing-patterns.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/test-healing-patterns.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/risk-governance.md
  - .claude/skills/bmad-testarch-test-review/resources/knowledge/error-handling.md
  - _bmad-output/implementation-artifacts/1-5-login-session-management-and-password-reset-api.md
  - _bmad-output/planning-artifacts/epics/epic-01b-auth.md
  - _bmad-output/test-artifacts/test-design/classlite_new-handoff.md
files_reviewed:
  - classlite-api/internal/service/login_atdd_test.go
  - classlite-api/internal/service/refresh_atdd_test.go
  - classlite-api/internal/service/password_reset_atdd_test.go
  - classlite-api/internal/service/role_revalidation_atdd_test.go
  - classlite-api/internal/handler/login_handler_atdd_test.go
  - classlite-api/internal/handler/logout_handler_atdd_test.go
  - classlite-api/internal/middleware/auth_atdd_test.go
  - classlite-api/internal/middleware/cors_atdd_test.go
  - classlite-api/internal/middleware/origin_atdd_test.go
---

# Test Review — Story 1.5 ATDD Red-Phase Contracts

## Score Summary

| Dimension | Score | Notes |
|---|---|---|
| Determinism | 9 / 10 | MockClock used consistently; one race in `refresh_atdd_test.go` AC09. |
| Isolation | 8 / 10 | `test.SetupDB(t)` per test; cross-file shared helper creates a build-tag coupling. |
| Maintainability | 8 / 10 | All files <300 LOC; excellent comments; one large test bundles 4 behaviors. |
| Performance | 9 / 10 | No real sleeps; MockHasher avoids bcrypt cost; one async-worker drain missing. |
| **Overall** | **8.5 / 10** | Strong contracts. **3 critical fixes** before dev picks it up; the rest is impl-pass cleanup. |

Coverage scoring is intentionally excluded — re-run `bmad-testarch-trace` after dev to map ACs → tests.

## Top-Level Verdict

**CONCERNS, with 3 must-fix blockers identified.**

The contract is well-shaped — ATDD assertions clearly express the AC, the AT pass landed proper risk-anchored test IDs (R4/R5/R7/R8/R13/R15), and the test bodies follow Go testing idioms. But three issues will manifest as test failures *unrelated to the impl* and could send the dev down rabbit holes:

1. **C1** — concurrent goroutines share one pgx transaction → AC09 will deadlock or false-positive.
2. **C2** — query against `password_resets.email` before its migration ships → compile-time fine, runtime error during the very first AC03 test run.
3. **C3** — `DELETE FROM users` runs against a row with live `center_members` FK references → AC16 fails on FK violation before reaching its assertion.

All three are fixable in <1 hour and should be patched into the red-phase tests *before* dev removes any build tags. The remaining HIGH-priority items are loose contracts (substring matches, racy async assertions) that will surface as flake later if left alone.

## Critical Findings (Must Fix Before Dev)

### C1 — `refresh_atdd_test.go` AC09: pgx transaction shared across goroutines

**File:** `classlite-api/internal/service/refresh_atdd_test.go:142-194`
**Test:** `TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins`
**Severity:** CRITICAL — test will deadlock, panic, or pass for the wrong reason.

**The problem:**
```go
db := test.SetupDB(t)               // single TxDB wraps one transaction
...
for i := 0; i < concurrency; i++ {
    go func(idx int) {
        defer wg.Done()
        _, results[idx] = svc.RefreshTokens(context.Background(), first.RefreshToken)
        //                ^ two goroutines call this against the SAME pgx.Tx
    }(i)
}
```

`pgx.Tx` is NOT goroutine-safe (`https://pkg.go.dev/github.com/jackc/pgx/v5#Tx`). The test's intent — exercise the `DELETE ... RETURNING` row-lock that PostgreSQL provides — requires two *connections* on the same physical row, not two goroutines on the same logical transaction. With a shared Tx the queries either interleave unsafely (false-positive) or pgx returns "another query is already in progress" (test fails for the wrong reason).

**Fix options (rank-ordered):**

1. **Best — drop the literal concurrency, simulate the race deterministically.** Add a `DeleteRefreshTokenByHash` raw-SQL call between Login and the first RefreshTokens call to simulate "another request just won the race". Then call `RefreshTokens` and assert it hits the reuse-detection path. The DB row-lock is already covered by the unit tests for `RotateRefreshToken`; this ATDD test is overspecifying the mechanism.

2. **Acceptable — use two real pool connections.** Replace the shared `TxDB` with a fresh `pgxpool.Pool` obtained from `test.NewRawPool(t)` (helper to add). Accept the trade-off that this single test can't use savepoint rollback isolation — clean up explicitly via `t.Cleanup(func() { db.Exec("DELETE FROM refresh_tokens WHERE user_id = $1", user.ID) })`.

3. **Not recommended — sleep between calls.** Adds a hard wait, violates the timing-debugging knowledge fragment.

**Why this matters:** This is the ONE test pinned to R5 (refresh-token reuse, score 6). Getting it wrong defeats the whole risk-mitigation rationale. The dev WILL spend hours debugging an "intermittent pgx error" before realizing the design flaw.

---

### C2 — `password_reset_atdd_test.go` AC03: queries `password_resets.email` before migration

**File:** `classlite-api/internal/service/password_reset_atdd_test.go:36-46`
**Test:** `TestRequestPasswordReset_AC03_UnknownEmail_SilentNoEnumeration`
**Severity:** CRITICAL — runtime error at the very first test run.

**The problem:**
```go
db.QueryRow(context.Background(),
    `SELECT COUNT(*) FROM password_resets WHERE email = $1`, "does-not-exist@example.com",
).Scan(&count)
```

The `password_resets` table (created by `migrations/20260601120000_create_auth_tables.up.sql:99-108`) has columns `(id, user_id, token, expires_at, used_at, created_at)` — **no `email` column**. The query returns `ERROR: column "email" does not exist`.

Story 1.5 Task 1 spec'd `migrations/20260606120200_add_password_reset_email.up.sql` to add the column. **The ordering hazard:** if the dev removes the build tag from `password_reset_atdd_test.go` *before* applying the migration, the test fails in a confusing way that looks like a service bug.

**Fix options:**

1. **Best — leave the test alone; add a Dev Note to Story 1.5 Task 1** (or fold into the existing migration-first ordering note at the top of the Tasks list) explicitly stating: "Migration `20260606120200` MUST be applied before any password-reset ATDD red tag is removed."

2. **Alternative — rewrite the test to not depend on the new column** (e.g., `SELECT COUNT(*) FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = $1`). Defers the column-add to a future story. **Not recommended** — the test design's intent to add the column is sound (forensic value), and the story file already specs the migration.

**My recommendation:** Option 1 — patch the story file with the explicit ordering callout. The migration is a 1-liner in the same commit that flips the tag.

---

### C3 — `auth_atdd_test.go` AC16: deletes user with live FK references

**File:** `classlite-api/internal/middleware/auth_atdd_test.go:91-131`
**Test:** `TestExtractTenant_AC16_ValidJWT_DeletedUser_Returns401`
**Severity:** CRITICAL — `DELETE FROM users` violates `center_members.user_id` FK; test fails before reaching its assertion.

**The problem:**
```go
_ = test.CreateCenterMember(t, db, user.ID, center.ID, "owner")
...
if _, err := db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID); err != nil {
    t.Fatalf("delete user: %v", err)
}
```

`center_members.user_id REFERENCES users (id)` (per `20260601120000_create_auth_tables.up.sql:45`). The schema does **not** define `ON DELETE CASCADE`. The raw DELETE will fail with `ERROR: update or delete on table "users" violates foreign key constraint`.

The test author's intent is clearly "what happens to the JWT when its user row is gone". To realize that scenario, the test must remove FK references first.

**Fix:**
```go
// Before DELETE FROM users:
if _, err := db.Exec(context.Background(),
    `DELETE FROM center_members WHERE user_id = $1`, user.ID); err != nil {
    t.Fatalf("clear center_members FK: %v", err)
}
if _, err := db.Exec(context.Background(),
    `DELETE FROM users WHERE id = $1`, user.ID); err != nil {
    t.Fatalf("delete user: %v", err)
}
```

This is the minimal fix and doesn't change the test's intent.

---

## High-Severity Findings (Should Fix Before Dev)

### H1 — `newAuthServiceWithClock` doesn't pass a JWTSigner; Login can't issue JWTs

**Files:** `service/login_atdd_test.go:204-216` (helper) + every caller in `refresh_atdd_test.go`, `password_reset_atdd_test.go`, `role_revalidation_atdd_test.go`.

The factory line 215:
```go
return service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, testVerifyURLBase, c)
```

does NOT inject a `JWTSigner`. But every Login test asserts `result.AccessToken != ""` — that token MUST be signed. The dev has two clean choices, and the ATDD test does not pin which one:

1. **Default-init inside the constructor** — `NewAuthServiceWithClock` constructs a default `NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), c)` when no signer is passed. Quick + matches the test as-written. Risk: silently uses a hard-coded test secret in any code path that calls the constructor without overriding.

2. **Extend the helper signature** — change the test helper to inject `service.NewJWTSignerWithClock(...)` and update all four callsites in the same impl-pass commit.

**Recommendation:** Option 2. Modifying a test helper to add a fixture parameter is a test infrastructure change (not an assertion change) and is permitted per the ATDD contract. Document the change in the story file Task 6 so the dev doesn't think they're violating the ATDD contract.

### H2 — `password_reset_atdd_test.go` AC03 email-count assertion is a race

**File:** `service/password_reset_atdd_test.go:73-77`

```go
if sender.Count() != 1 {
    t.Fatalf("expected 1 email send, got %d", sender.Count())
}
```

The impl uses fire-and-forget email via `EmailRetryQueue.Enqueue` (per Story 1.4 pattern). `MockEmailSender.Count()` increments inside the worker goroutine. The test asserts the count synchronously after the service call returns — **the worker may not have run yet**. Result: intermittent test failure under CI load.

**Fix:** Use the existing `drainQueueOnce(t, queue, sender, want int)` helper from `auth_test.go:37`. The factory `newAuthServiceWithSenderAccess` already returns the queue at position 4 — just call drain before the assertion:

```go
svc, _, sender, queue := newAuthServiceWithSenderAccess(t, db, mockClock)
... // request reset
drainQueueOnce(t, queue, sender, 1)   // sync barrier, returns when worker processed 1 email
if sender.Count() != 1 { ... }
```

### H3 — `password_reset_atdd_test.go` AC04 happy-path bundles 4 distinct behaviors

**File:** `service/password_reset_atdd_test.go:85-154` (69 lines, one test)

The single test asserts:
1. Refresh tokens deleted (lines 122-131)
2. New password works (lines 134-138)
3. Old password rejected (lines 141-146)
4. Reset token cannot be reused (lines 149-153)

When this test fails, the message is "ResetPassword: ..." — no signal which of the 4 invariants broke. Better failure attribution requires splitting:

- `TestResetPassword_AC04_InvalidatesAllRefreshTokens`
- `TestResetPassword_AC04_NewPasswordWorks`
- `TestResetPassword_AC04_OldPasswordRejected`
- `TestResetPassword_AC04_TokenCannotBeReused`

Each test reuses the same fixture (4 lines of seeding). Not a blocker — but the impl pass should refactor.

### H4 — `auth_atdd_test.go` AC14 queries `auth_audit_logs.event` before column rename

**File:** `middleware/auth_atdd_test.go:78`

```go
db.QueryRow(context.Background(),
    `SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'invalid_tenant_claim' AND user_id = $1`,
    user.ID,
).Scan(&attemptCount)
```

Same ordering hazard as C2. The column is currently `action` (Story 1.4); Story 1.5 Task 5 renames it to `event`. **Dev must apply migration `20260606120300_rename_auth_audit_action_to_event` AND patch every existing Story 1.4 callsite (3 in `auth.go`, 2 in `auth_test.go`, 6 in `auth_audit_test.go`) in the same commit as the tag-flip on this file.**

The story file already calls this out under Task 5. The fix is to make the ordering crisper in the story Tasks (Task 1 migrations → Task 5 rename callsites → ONLY THEN remove build tags).

### H5 — `cors_atdd_test.go` `NewCORS(cfg)` constructor doesn't exist yet

Expected red-phase state. Story Task 12 specifies the refactor. **No action required from the test pass.**

### H6 — `origin_atdd_test.go` substring-match on error code is too loose

**File:** `middleware/origin_atdd_test.go:70`

```go
if got := rec.Body.String(); !strings.Contains(got, "ORIGIN_NOT_ALLOWED") {
    t.Fatalf("expected error code ORIGIN_NOT_ALLOWED in body, got %q", got)
}
```

A substring match passes if the body contains the literal string ANYWHERE — even if the JSON shape is wrong. Per GFW-5 the envelope must be `{"error": {"code": "...", "message": "...", "requestId": "...", "details": null}}`. Test should parse the JSON and assert the structured shape:

```go
var env struct {
    Error struct{ Code, Message, RequestID string; Details any } `json:"error"`
}
if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
    t.Fatalf("decode envelope: %v", err)
}
if env.Error.Code != "ORIGIN_NOT_ALLOWED" {
    t.Fatalf("error.code: expected ORIGIN_NOT_ALLOWED, got %q", env.Error.Code)
}
```

Same pattern recommended for the AC14 error assertion in `auth_atdd_test.go:70` (currently substring on `INVALID_TENANT_CLAIM`).

## Medium-Severity Findings (Impl Pass Cleanup)

### M1 — Cross-file helper coupling locks tag-removal into a group operation

`newAuthServiceWithClock` is defined in `service/login_atdd_test.go:204` and called from `refresh_atdd_test.go:42`, `password_reset_atdd_test.go` (via `newAuthServiceWithSenderAccess` at line 168), and `role_revalidation_atdd_test.go:45`. All four files share one `//go:build atdd_red_phase` tag space — if you remove the tag from refresh but not login, refresh doesn't compile.

Same coupling exists for `newAuthHandlerService` in `login_handler_atdd_test.go:141`, called from `logout_handler_atdd_test.go:25`.

**Fix:** Document in the story Task 20 ("Regression check + ATDD activation") that tags must be removed in groups: `{login + refresh + password_reset + role_revalidation}` together, and `{login_handler + logout_handler}` together. The middleware files are independent.

### M2 — `role_revalidation_atdd_test.go` raw DB mutations rely on stale tenant context

**File:** `service/role_revalidation_atdd_test.go:60,97`

```go
if _, err := db.Exec(context.Background(),
    `UPDATE center_members SET role = 'teacher' WHERE user_id = $1 AND center_id = $2`,
    owner.ID, center.ID,
); err != nil { ... }
```

`center_members` is RLS-protected. Line 42 sets `test.TenantContext(t, db, center.ID)` before any mutation. Because everything runs in one shared `TxDB` transaction, that `SET LOCAL app.current_tenant_id` persists across calls — the UPDATE *should* run against the right tenant.

But the dependence on a 50-line-earlier `TenantContext` call is fragile. If the dev later reorders setup or adds a `RESET app.current_tenant_id`, the UPDATE silently writes 0 rows (RLS filters), the role stays "owner", `AdminInviteStaff` succeeds, and the test fails with a misleading "expected ForbiddenError" message that points the dev at the service layer instead of the test setup.

**Fix:** Add an explicit `test.TenantContext(t, db, center.ID)` immediately before each raw mutation, OR add a guard:
```go
result, err := db.Exec(...)
if rowsAffected, _ := result.RowsAffected(); rowsAffected == 0 {
    t.Fatal("RLS filtered the demotion UPDATE — set tenant context first")
}
```

### M3 — `login_atdd_test.go` AC1/AC6/AC7 redundantly create a center

**File:** `service/login_atdd_test.go:52,92,121,170`

Each test calls `test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")`. The center is never referenced after creation. `Login` is a non-tenant operation. This is dead setup (likely copy/paste from `role_revalidation_atdd_test.go`).

**Fix:** Remove the four `CreateCenterWithID` calls. Shaves 4 lines per test and removes a false implication that Login touches tenant context.

### M4 — `login_handler_atdd_test.go` envelope check uses brittle substring search

**File:** `handler/login_handler_atdd_test.go:136`

```go
if strings.Contains(rec.Body.String(), "refresh") {
    t.Error("response body must NOT contain refresh token (it lives in httpOnly cookie only)")
}
```

This fires if ANY future field name contains "refresh" (e.g., `refreshedAt`, a "Refresh your subscription" string in a copy block).

**Fix:** Parse the JSON envelope and explicitly assert the `data.refreshToken` field is absent:
```go
var raw map[string]any
_ = json.NewDecoder(rec.Body).Decode(&raw)
data, _ := raw["data"].(map[string]any)
if _, present := data["refreshToken"]; present {
    t.Error("response body must NOT contain refreshToken (it lives in httpOnly cookie only)")
}
```

### M5 — `login_handler_atdd_test.go` uses `NewAuthService` not `NewAuthServiceWithClock`

**File:** `handler/login_handler_atdd_test.go:150`

```go
return service.NewAuthService(db, hasher, sender, auditLogger, queue, "https://my.classlite.app/verify-email")
```

The handler tests don't currently assert time-dependent cookie attributes (e.g., `MaxAge` calc would surface real-time flakiness), so this is latent. But for consistency with the service ATDD tests AND to allow future cookie `MaxAge` assertions, the handler helper should also use `NewAuthServiceWithClock` with a fixed MockClock.

### M6 — `cors_atdd_test.go` "never wildcard with credentials" test is permissive

**File:** `middleware/cors_atdd_test.go:81-107`

The test passes if the impl drops the wildcard, OR drops credentials, OR panics at startup. The story file recommends "drop wildcard + slog.Error". The test allows ANY correct impl — fine for an ATDD test, but the implementer should consciously pick one. **Action: surface the recommendation in a comment inside the test or in a Dev Note.**

### M7 — `role_revalidation_atdd_test.go` sanity assertion is weak

**File:** `service/role_revalidation_atdd_test.go:55`

```go
if err := svc.AdminInviteStaff(context.Background(), tc, "newteacher@example.com", "teacher"); err != nil {
    t.Fatalf("pre-demotion AdminInviteStaff: expected success, got %v", err)
}
```

The "owner can invite" sanity check only asserts `err == nil`. A no-op impl (returns nil, writes nothing) passes. The story file says `AdminInviteStaff` writes to `invites`. **Fix:** add a follow-up `SELECT COUNT(*) FROM invites WHERE center_id = ...` assertion = 1. Locks the contract that the method actually does something.

### M8 — `refresh_atdd_test.go` hashOf helper doesn't pin the hash encoding

**File:** `service/refresh_atdd_test.go:201-204`

`service.HashRefreshToken(raw)` is called for the count query. The test passes as long as the impl uses the same fn it exposes. A silent algorithm change (SHA-256 → BLAKE3) breaks no test. **Fix:** add one unit test in `service/jwt_test.go` (or a new `service/refresh_hash_test.go`) asserting `HashRefreshToken("known-input") == "<known-sha256-hex>"`. Locks the hash contract.

## Low-Severity Findings

- **L1** — `uuidToString` helper is duplicated across `middleware/auth_atdd_test.go:134` and `service/role_revalidation_atdd_test.go:115`. Different packages = duplication is allowed. Minor MAINT — could move to `test/helpers.go` later.
- **L2** — `password_reset_atdd_test.go::newAuthServiceWithSenderAccess` returns 4 values; callers only use 3. Trim signature.
- **L3** — `login_atdd_test.go::TestLogin_AC07` (line 178-183) uses `for i := 0; i < 5` with `_, _ = ...`, inconsistent with AC06's `for i := 1; i <= 5` + explicit error assertion. Style nit.
- **L4** — `cors_atdd_test.go::TestCORS_AC11_AllowlistMatch_*` (line 53) uses `strings.Contains(got, "Origin")` for the `Vary` header — correct because `Vary` may have multiple comma-separated values. Documenting as expected, not a finding.
- **L5** — Several tests use `t.Fatal`/`t.Fatalf` after `t.Errorf` — first failure stops the test, hiding later assertion failures. Standard Go practice; mentioning so reviewers don't expect richer failure reports.
- **L6** — No `t.Cleanup` calls anywhere. Correct — tx rollback via `test.SetupDB(t)` handles cleanup. Documenting as expected.

## Coverage Gaps (Route to `bmad-testarch-trace`)

Coverage scoring is out of scope here, but a few gaps deserve a note for the future `TR` pass:

1. **AC4's `login_attempts` cleanup on successful reset** — uncovered. Should assert "locked-out user can log in immediately after password reset".
2. **AC10 cookie attributes on `/api/auth/refresh` and `/api/auth/logout`** — only Login is covered. AC10 says "any Set-Cookie from login/refresh/logout".
3. **AC12 PUT/DELETE/PATCH paths** — Origin check test only exercises POST. The middleware spec'd to fire on all four mutating methods.
4. **AC11 preflight OPTIONS** — the existing CORS middleware returns 204 for OPTIONS; the new `NewCORS` should preserve this. Not asserted.
5. **AC15 (JWT secret length validation)** — config-test concern per Task 14 of the story, not an ATDD candidate. Story file correctly routes this to `config_test.go`.

Defer (1)–(4) to the `bmad-testarch-automate` (TA) pass *after* dev. They're P2 expansions, not red-phase blockers.

## Recommendations

### Pre-dev (do now)

1. **Patch C1, C2, C3 directly in the red-phase test files.** All three are <30 LOC fixes.
   - C1: rewrite AC09 to simulate the race deterministically (single-goroutine + raw DELETE between Login and RefreshTokens).
   - C2: leave the test, add an explicit Dev Note in Story 1.5 Tasks ordering: "Migration `20260606120200` MUST be applied before `password_reset_atdd_test.go` build tag is removed."
   - C3: insert `DELETE FROM center_members WHERE user_id = $1` before the user DELETE in AC16.

2. **Resolve H1 (JWT signer factory) by editing the story file.** Pick Option 2 (extend the helper to inject the signer) — that change is permitted as test infrastructure, not assertion modification. Update Story 1.5 Task 6 to spell out the exact helper-signature change so the dev doesn't have to interpret it.

3. **Patch H2 (async drain) in `password_reset_atdd_test.go`.** Replace the synchronous count check with `drainQueueOnce(t, queue, sender, 1)`. Three-line change.

### During dev

4. **Apply H4 (`event` rename) atomically.** The story file already specs this in Task 5 — just lift the ordering note into Task 20 (regression check) so the dev sees it as a hard prerequisite to removing the `middleware/auth_atdd_test.go` build tag.

5. **Pick `cors_atdd_test.go` M6 impl decision.** Document in code "// drop wildcard from active allowlist + slog.Error on construction" so the impl matches the story recommendation, not just one of three acceptable options.

### Post-dev (TA pass)

6. **Run `bmad-testarch-automate` to backfill coverage gaps 1–4 above** as P2 tests.
7. **Add the `HashRefreshToken` algorithm-pinning unit test** (M8). One line in the impl, prevents silent algorithm drift.

### Long-term (next story or refactor)

8. **Hoist `uuidToString` to `internal/test/helpers.go`** when a third copy lands.

## Coverage Boundary Note

This review scores test **quality** (determinism, isolation, maintainability, performance, security depth). It does NOT score **coverage** — AC-to-test mapping is the job of `bmad-testarch-trace` (TR). After dev turns these tests green AND the recommended TA pass backfills the four gaps above, run TR to generate the formal coverage matrix and the per-epic gate decision.

## Next Recommended Workflow

1. **Right now:** patch C1, C2, C3 in the red-phase files. Update story Task 6 with the H1 resolution.
2. **After dev:** run `bmad-testarch-automate` (`TA`) to add the AC4/AC10/AC11/AC12 coverage gaps.
3. **After TA:** run `bmad-testarch-trace` (`TR`) — Phase 1 builds the AC↔test matrix; Phase 2 issues the PASS/CONCERNS/FAIL gate decision for the epic.
4. **Before merging Epic 1B to main:** run `bmad-testarch-nfr` (`NR`) to audit the NFR evidence (R7 cookie attributes, R13 lockout proof, R5 reuse-detection proof).

---

## Patch Status (applied 2026-06-06)

- ✅ **C1 patched** — `service/refresh_atdd_test.go` AC09 rewritten as `TestRefresh_AC09_LostRaceTreatedAsReuse`. Single-threaded simulation of the lost-race path: winner rotates → loser arrives with the now-deleted token → service detects family sibling and revokes. Dead `CreateCenterWithID` setup also removed from AC02 + AC08. `sync` import dropped. Rationale captured in test docstring — concurrent multi-connection verification is deferred to a future `test.SetupRawDB(t)` helper in the TA pass.
- ✅ **C2 patched** — Story file `1-5-...md` updated with HARD ORDERING block at the top of `## Tasks / Subtasks`. The block makes the migration-before-tag-removal sequence rigid (apply migrations → rename callsites → `sqlc generate` → THEN remove build tags). The red-phase test file is unchanged per recommendation.
- ✅ **C3 patched** — `middleware/auth_atdd_test.go::TestExtractTenant_AC16_ValidJWT_DeletedUser_Returns401` now deletes the `center_members` row before the `users` row, with an inline comment explaining the FK constraint.

**Verification:** `go vet -tags=atdd_red_phase ./internal/service/ ./internal/middleware/` reports only the expected red-phase signals (`svc.SetPassword undefined`, `undefined: service.NewJWTSigner` — both spec'd in story Tasks 4 + 6). No new compile errors introduced.

The remaining HIGH items (H1 JWT signer factory, H2 async drain race, H4 column-rename ordering, H6 envelope assertion) are still open — H4 is now partially mitigated by the HARD ORDERING block in C2's patch. H1/H2/H6 should be patched during the dev pass.
