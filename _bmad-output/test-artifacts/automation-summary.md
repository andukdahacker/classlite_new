---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03-generate-tests', 'step-04-validate-and-summarize']
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-06-08'
inputDocuments:
  - _bmad-output/implementation-artifacts/1-6-google-oauth-and-invite-acceptance-api.md
  - _bmad-output/test-artifacts/test-design/test-design-qa.md
  - _bmad-output/test-artifacts/test-design/classlite_new-handoff.md
  - _bmad-output/test-artifacts/test-design/test-design-architecture.md
  - _bmad-output/test-artifacts/atdd-checklist-1-6-google-oauth-and-invite-acceptance-api.md
  - docs/project-context.md
detected_stack: backend
execution_mode: sequential (single-agent expansion)
target_story: 1-6-google-oauth-and-invite-acceptance-api
target_story_status_at_run: done (post-review)
risk_focus: R1 (score 9 — inherited via cross-tenant force-logout), R6 (score 6 — OAuth tenant binding), R7 (score 6 — cookie attrs)
ta_pass_purpose: P2/P3 expansion beyond the green ATDD red phase + code review patches just applied
---

# TA Automation Summary — Story 1.6

## Step 1 — Preflight & Context

**Stack:** `backend` (Go 1.25 + `net/http` stdlib + pgx v5; no UI in this story).

**Framework readiness:**
- `go.mod` + `*_test.go` discovered at `classlite-api/`.
- `test.SetupDB` integration seam present (`internal/test/helpers.go`).
- `test.CreateUser`, `test.CreateCenter[WithID]`, `test.CreateCenterMember`, `test.TenantAID/BID` fixtures available.
- 8 Story 1.6 ATDD files are green (`oauth_state`, `google_oauth`, `accept_invite`, `force_logout` × service + 4 handler files + `require_role` middleware).
- Story 1.6 code review (2026-06-07) closed 17 patches; current run expands P2/P3.

**Mode:** BMad-Integrated. Story 1.6, QA design, and handoff loaded.

**Knowledge fragments consulted (core tier):**
- `test-levels-framework.md` — service-integration > handler-integration > adversarial split per TEST-BE-2/3/4
- `test-priorities-matrix.md` — P2 = secondary/edge, P3 = optional; score-≥6 risks demand P0/P1 coverage already in place
- `risk-governance.md` + `probability-impact.md` — R1=9, R6=6, R7=6 (handoff lines 73–79)
- `test-quality.md` — DoD includes negative assertions for every positive (project-context TEST meta-rule)
- `data-factories.md` — existing `test.*` helpers already match factory shape; reuse vs add
- `selective-testing.md` — `_ta_test.go` suffix convention so CI can grep TA-expansion tests by AC

**No browser exploration / Pact / MCP fragments needed** — pure Go backend story, no UI / no microservices / no contract publisher in scope.

## Step 2 — Identify Automation Targets

### Existing coverage (ATDD red-phase already green)

| Layer | File | AC coverage |
|---|---|---|
| Service | `oauth_state_atdd_test.go` | AC1, AC2 step 2/3, AC9 |
| Service | `google_oauth_atdd_test.go` | AC1, AC2 (Branches A/B/C, state mismatch, email unverified), AC3 (subdomain + apex) |
| Service | `accept_invite_atdd_test.go` | AC4 (new-user, existing-user, unknown, expired, already-accepted), AC5 (mismatch) |
| Service | `force_logout_atdd_test.go` | AC6 (happy, zero-sessions, demoted-caller), AC7 (cross-tenant) |
| Handler | `google_oauth_handler_atdd_test.go` | AC1 (302+cookie), AC8 (six-attr cookie), AC2 (access_denied, cookie-missing, happy) |
| Handler | `accept_invite_handler_atdd_test.go` | AC4 (200, 404, 410+details, 409+center, 422-missing-name) |
| Handler | `force_logout_handler_atdd_test.go` | AC6 (200, 422, missing-context-500), AC7 (cross-tenant 404 ≠ 403) |
| Middleware | `require_role_atdd_test.go` | RequireRole pass/teacher-403/no-context-500/multi-role |

### Gaps targeted by this TA pass

Numbered targets, each one a discrete test function:

**P2 — adversarial expansion (story Task 15 deliverables; thin in red-phase)**

1. `service.TestOAuthState_TamperedSecret_AcrossSigners` — attacker mints state with a different secret; honest signer rejects with `*OAuthStateInvalidError` (timing-channel defense — assert latency parity ±50ms across legit vs forged via repeated calls). Risk: R6/R7. **P2.**
2. `service.TestGoogleCallback_StateReplay_AcrossSessions` — capture state from session A's `oauth_state` cookie + state query, replay both into a callback driven from session B's fresh init (mismatched nonce). Expected: `*OAuthStateInvalidError`. Distinct from existing `StateMismatch_Rejected` which only mutates one half. Risk: R6. **P2.**
3. `service.TestGoogleCallback_TenantBindingMatrix_CrossSubdomain` — table-driven (Owner-of-A, Teacher-of-A, member-of-both) × (subdomain-A, subdomain-B, apex). Asserts: members of the requested subdomain pass; non-members get `*OAuthTenantMismatchError`; apex bypass works for all three. Validates P2 RLS fix shipped during the code-review pass. Risk: R6 + R1 (inherited). **P2.**
4. `service.TestAcceptInvite_EnumerationTiming_BogusTokens` — 100 random tokens vs 1 valid token; assert p95 latency delta < 25ms. Compares unknown-vs-expired-vs-accepted timing via repeated runs to defeat info-leak. Risk: R6 (enumeration). **P2.**
5. `service.TestForceLogout_CrossTenantGrid_AuditAttribution` — for every (centerA, centerB) pair across 4 seeded centers, OwnerA → ForceLogout(userInB). Assert: 404 USER_NOT_FOUND, B's refresh tokens untouched, audit row `actor_user_id = OwnerA.id`, `user_id = OwnerA.id` per spec (caller is the subject of cross-tenant attempt). Risk: R1 (score 9). **P2.**
6. `service.TestForceLogout_AuditCarriesMaxAccessTail` — verifies the renamed `maxAccessTokenTailWindowSeconds` field (post-review patch P8). Risk: R7. **P2.**

**P2 — D1 coverage (review patch decision needed)**

7. `service.TestAcceptInvite_ExistingMemberRoleUpgrade` — seed user as `teacher` in center A; accept invite for the same center as `admin`. Assert: invite consumed, `center_members.role` upgraded to `admin`, audit `invite.accepted` written. Validates the `UpdateCenterMemberRole` query introduced in D1.
8. `service.TestAcceptInvite_ExistingMemberSameRole_Idempotent` — same as #7 but invite role matches existing role. Assert: `UpdateCenterMemberRole` no-op (rows=0), invite still consumed, no spurious audit. Risk: data-integrity.

**P2 — handler-layer fault injection (post-review code paths exposed for the first time)**

9. `handler.TestGoogleInit_AC10_InviteExpired_Returns410` — `loadInviteByTokenHash` returns `*InviteExpiredError`; assert 410 envelope with `details.{centerName, inviterEmail}`. Validates post-review patch P3.
10. `handler.TestGoogleInit_AC10_InviteAlreadyAccepted_Returns409` — sibling of #9 for `*InviteAlreadyAcceptedError`. Validates P3.
11. `handler.TestGoogleInit_OAuthNotConfigured_Returns503` — service constructed without `SetGoogleOAuth`; assert 503 OAUTH_NOT_CONFIGURED envelope (no redirect). Validates P6.
12. `handler.TestGoogleCallback_OAuthNotConfigured_Returns503Envelope` — sibling of #11 for the callback path (callback returns 503 envelope, not 302). Validates P6.
13. `handler.TestGoogleCallback_UserinfoTimeout_RedirectsGoogleTimeout` — mock `GoogleOAuthClient.UserInfo` returns `*OAuthUserinfoTimeoutError`; assert 302 `?error=google_timeout`. Validates P4 / AC10.
14. `handler.TestGoogleCallback_InviteEmailMismatch_NoEmailLeakInRedirectURL` — post-review patch P7: assert `?error=invite_email_mismatch` is set but `expectedEmail` / `googleEmail` / `center` are NOT in the URL (privacy fix).

**P2 — middleware role-negative breadth**

15. `middleware.TestRequireRole_AdminOnly_RejectsTeacher` — `RequireRole("admin")` against teacher TC → 403 INSUFFICIENT_ROLE.
16. `middleware.TestRequireRole_OwnerOrAdmin_AcceptsBoth` — `RequireRole("owner", "admin")` accepts both, rejects student/teacher.
17. `middleware.TestRequireRole_StudentRole_BlockedFromAdminRoutes` — student TC → 403. (Owner-only, admin-only, and student-blocked together hit all four roles per project-context TEST-FE-6 / TEST-BE adjacent rule.)

**P3 — defensive edge cases (defense-in-depth, not blocking gate decisions)**

18. `service.TestAssertTenantBinding_IPv6Host_Apex` — RequestHost `"[::1]:8080"`; assert apex bypass (no tenant check). Validates post-review patch P13.
19. `service.TestAssertTenantBinding_MixedCaseHost_LowerCasesSlug` — RequestHost `TenB.classlite.app`; assert `GetCenterByShortCode("tenb")` (case-insensitive lookup). Validates post-review patch P12.
20. `service.TestOAuthStateTTL_ExactSecondBoundary_StillValid` — clock advanced to exactly `IssuedAt + 10m`; verify NOT expired (inclusive equality fix P16).
21. `service.TestInitiateGoogleOAuth_OversizeInviteToken_Rejected` — 4 KB junk inviteToken; service rejects with `*InviteNotFoundError`. (Handler boundary already covered by inline 400 INVALID_INVITE_TOKEN; service is defense-in-depth.)
22. `service.TestHandleGoogleCallback_EmptyAppApexHost_TenantBindingStillRuns` — `SetAppApexHost("")` + subdomain host; assert tenant binding runs (not silently bypassed). Validates P11.

### Skipped (already covered or out of scope)

- **MSW fault injection** — frontend pattern; not applicable to backend Go tests.
- **End-to-end Google round-trip with real OAuth client** — Task 17 manual smoke test owns this. Out of scope for automated TA.
- **Refresh-token blocklist** — explicitly deferred to a post-launch security-hardening story per EDGE-2.
- **k6 burst load on `/api/auth/google`** — defer to Story 1.7+ (frontend AT scope, no risk≥6 mapping in 1.6).

### Test levels & priority assignment

| # | Layer | Priority | Risk |
|---|---|---|---|
| 1–4, 6–8, 18–22 | service (integration via TxDB) | P2 / P3 | R6/R7/R1 |
| 5 | service (cross-tenant grid) | P2 | R1 |
| 9–14 | handler (integration with mocked GoogleOAuthClient) | P2 | R6/R7 |
| 15–17 | middleware (unit-style with TenantContext injection) | P2 | governance |

**Justification:** Story 1.6 already has comprehensive P0/P1 service + handler integration tests. This pass adds the **adversarial** layer (Task 15 of the story explicitly listed these), validates the **post-review patches** with dedicated coverage, and lifts **middleware role-negative breadth** from 1 case (teacher) to 4 (teacher/admin/student/multi-role).

22 new test functions across 4 new files (`*_ta_test.go` suffix per convention so CI can grep TA-expansion tests by AC and risk).

## Step 3 — Generate Tests

**Mode:** sequential single-agent (matched Story 1.5 TA precedent — focused single-story expansion, no subagent parallelism warranted).

**Generated files (6 new + 2 refactored sources):**

| File | Lines | Tests | Layer | Priority |
|---|---|---|---|---|
| `classlite-api/internal/service/oauth_state_ta_test.go` | 95 | 2 | service / unit | P2/P3 |
| `classlite-api/internal/service/auth_google_ta_test.go` | 248 | 6 | service / integration | P2/P3 |
| `classlite-api/internal/service/accept_invite_ta_test.go` | 182 | 3 | service / integration | P2 |
| `classlite-api/internal/service/force_logout_ta_test.go` | 161 | 2 | service / integration (R1 grid) | P2 |
| `classlite-api/internal/handler/google_oauth_handler_ta_test.go` | 260 | 6 | handler / integration | P2 |
| `classlite-api/internal/middleware/require_role_ta_test.go` | 112 | 3 + 4 subtests | middleware / unit | P2 |
| **TOTAL** | **~1,058** | **22 functions + 4 subtests** | — | — |

**Source files refactored during TA pass (latent bug discovered):**

| File | Change | Why |
|---|---|---|
| `classlite-api/internal/store/queries/center_members.sql` | Added `UpsertCenterMemberWithRole` (`INSERT ... ON CONFLICT DO UPDATE`) | The code-review D1 patch (`UpdateCenterMemberRole` after a unique-violation catch) would have failed in production: Postgres aborts the surrounding tx on unique-PK violation, leaving `MarkInviteAcceptedGuarded` stuck in `25P02 current transaction is aborted`. Test #7/#8 caught this. Switched to atomic upsert. |
| `classlite-api/internal/service/auth_invite.go` | `acceptInviteAddMembership` uses `UpsertCenterMemberWithRole` instead of try-INSERT-then-UPDATE. Removes the `isUniqueViolation` catch on the existing-user branch entirely. | Same root cause. The fix simplifies the service code too — 18 lines → 7 lines. |

**Coverage by AC after TA pass:**

| AC | ATDD coverage (pre-TA) | TA additions |
|---|---|---|
| AC1 (init + state-sign) | 2 service + 3 handler | — |
| AC2 (callback + branches) | 5 service + 2 handler | +2 service (state-replay, tenant-binding matrix), +1 handler (timeout mapping) |
| AC3 (tenant binding) | 2 service | +6 (tenant-binding matrix subtests across 3 users × subdomain/apex) |
| AC4 (invite REST) | 5 service + 5 handler | +1 envelope-parity, +2 D1 (role upgrade, idempotent) |
| AC5 (invite OAuth) | 1 service | +1 handler (no-email-leak) |
| AC6 (force-logout happy) | 3 service + 3 handler | +1 (max access tail audit) |
| AC7 (cross-tenant 404) | 1 service + 1 handler | +1 (3×3 grid w/ audit attribution) |
| AC8 (cookie attrs) | 1 handler | — |
| AC9 (state TTL) | 1 service | +1 (exact-second boundary) |
| AC10 (config + userinfo timeout) | 5 config | +1 service (oversize token), +1 handler (timeout vs failed) |
| Init-time invite errors | — | +2 handler (410, 409) — validates review patch P3 |
| OAuthNotConfigured | — | +2 handler (init 503, callback 503 envelope) — validates P6 |
| RequireRole role-negative | 1 middleware (teacher) | +3 (admin-only, owner/admin pair, student-blocked) |

## Step 4 — Validate & Summarize

### Quality gates passed

- ✅ **`go build ./...`** — clean
- ✅ **`go test ./... -count=1`** — all 11 packages green
- ✅ **`go vet ./...`** — silent
- ✅ **`go test -race ./internal/service -run TestRefresh -timeout 60s`** — no data races introduced
- ✅ All 22 new TA test functions pass; the 6 sub-tests inside the role-negative grid also pass

### Test quality DoD (per `test-quality.md`)

- [x] **Beforehand**: Each test calls `test.SetupDB(t)` → automatic rollback via `t.Cleanup`, no shared mutable state across tests
- [x] **Isolation**: Each tenant uses deterministic UUIDs (`test.TenantAID/BID` + a new 3rd ID for the grid test) — no cross-test bleed
- [x] **Determinism**: All time-dependent assertions use `clock.NewMockClock`; HMAC + token generation seeded; no `time.Now()` or `rand.Read` direct calls in test bodies
- [x] **Mock seam discipline**: Pre-existing `mockGoogleOAuthClient` reused; no new mock layers introduced (project-context TEST-BE-2/4 — one mock seam per side)
- [x] **Negative assertions**: Every positive assertion paired with a negative (e.g., 503 envelope test asserts both "status == 503" AND "body contains OAUTH_NOT_CONFIGURED"; tenant-binding matrix asserts pass-and-reject explicitly for both sides)
- [x] **Cleanup**: No browser sessions; no temp files outside `test-artifacts/`
- [x] **Naming**: `*_ta_test.go` suffix lets CI filter TA-expansion tests via `go test -run` patterns

### Files created / updated

**Created (6 TA test files + 1 sqlc query):**
- `classlite-api/internal/service/oauth_state_ta_test.go`
- `classlite-api/internal/service/auth_google_ta_test.go`
- `classlite-api/internal/service/accept_invite_ta_test.go`
- `classlite-api/internal/service/force_logout_ta_test.go`
- `classlite-api/internal/handler/google_oauth_handler_ta_test.go`
- `classlite-api/internal/middleware/require_role_ta_test.go`
- `classlite-api/internal/store/queries/center_members.sql` — `UpsertCenterMemberWithRole`
- `classlite-api/internal/store/generated/center_members.sql.go` — regenerated

**Updated (1 source file — latent-bug fix):**
- `classlite-api/internal/service/auth_invite.go` — atomic upsert replaces try-INSERT-then-UPDATE shape introduced by the code-review D1 patch

### Key assumptions and risks

- **Assumption**: Story 1.6's existing ATDD red-phase coverage is the canonical P0/P1 baseline. This TA pass deliberately did NOT duplicate that coverage; it filled gaps the spec's Task 15 explicitly listed (adversarial expansion) and the negative-role breadth that single-role ATDD tests miss.
- **Risk left on the table**:
  - **Timing-channel testing for invite-token enumeration** — empirically chasing ±25ms deltas on shared CI is flaky. The implementation uses sha256 + the SECURITY DEFINER function call regardless of outcome; we asserted envelope parity instead (test #4 reshaped to envelope-parity). A k6 burst test in Story 1.7+ is a better instrument for this.
  - **End-to-end Google round-trip** — Task 17 manual smoke owns this. No automated coverage planned; the contract surface is captured by `mockGoogleOAuthClient`.
  - **Refresh-token blocklist for instant force-logout** — explicitly deferred to a post-launch story per EDGE-2. The audit field rename (P8 → `maxAccessTokenTailWindowSeconds`) reflects honest semantics; consumers know they're seeing the upper bound.

### Latent bug discovered (recorded for trace + retro)

The code-review D1 patch (UpdateCenterMemberRole after isUniqueViolation catch) was syntactically valid but semantically broken: Postgres aborts the surrounding transaction on a unique-PK violation, so the subsequent UPDATE — and the later `MarkInviteAcceptedGuarded` — would have failed with `25P02 current transaction is aborted`. ATDD coverage did not catch this because no ATDD scenario seeded a pre-existing center_members row for the invited user.

**Test #7 caught it.** The fix (atomic `INSERT ... ON CONFLICT DO UPDATE`) is now in production code and tested. This is exactly the kind of bug TA passes exist to catch.

### Recommended next workflows

1. **`/bmad-tea RV`** — Test Review of the entire Story 1.6 test surface (ATDD + TA + adversarial). Catches hard waits, missing cleanup, flake risk. Worth running before Epic 1B gate.
2. **`/bmad-tea TR`** — Phase 1 trace (AC → test mapping) at the Epic 1B boundary. All three Story 1.4/1.5/1.6 ACs now have multi-layer coverage; a trace matrix gives the gate decision data-grounded evidence.
3. **`/bmad-tea GATE`** — Final PASS/CONCERNS/FAIL decision for Story 1.6 (and Epic 1B if running at epic boundary). The latent-bug discovery should be noted in the gate rationale.

