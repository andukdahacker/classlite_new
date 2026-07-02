# Story 2-1: Completion Notes

_Implementation record for [`2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md`](./2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md). Status: review._

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) via `/bmad-dev-story 2-1` on 2026-07-02. Baseline commit `6b522c1`.

### Debug Log

- **sqlc row-type divergence.** Adding `persona` to the `users` table made sqlc generate bespoke `GetUserByIDRow` / `CreateUserRow` types instead of the shared `generated.User`, breaking ~9 callsites. Reordered the SELECT list so `persona` is LAST (matches User struct field order) and sqlc collapsed back to the shared type.
- **Google callback matrix collision.** `TestGoogleCallback_TenantBindingMatrix_CrossSubdomain` seeded a Carol user with two center memberships — impossible under Story 2.1's `idx_center_members_user_id` unique index. Removed Carol from the fixture with `FU-2-1-D` reference comment for the multi-center restoration path.
- **Audit validation ordering.** `logWithinTxCore` initially embedded validation inside the tx opener path — the `nopBeginner` regression tests pin the ordering: validation MUST happen BEFORE `Begin()` so caller-input errors don't churn the pool. Refactored to extract a `validateAuditInputs` helper called from both `Log()` and `LogWithinTx()`.
- **Postgres 25P02 on slug retry.** CenterService's slug retry re-INSERTed into an already-aborted tx (Postgres marks the tx aborted after any error until `ROLLBACK`). Wrapped each attempt in `SAVEPOINT slug_attempt` / `ROLLBACK TO`. Also fixed truncation: base slugs at exactly `slugMaxLen` dropped the appended suffix; now reserving room (`slugMaxLen - 1 - RandomSuffix`) before appending.
- **RLS on cleanup.** `PurgeUserAndOwnedCenters` initially ran against the `classlite_app` pool — RLS blocked `DELETE FROM center_members` / `audit_logs` without `SET LOCAL app.current_tenant_id`, silently leaking residue. Added a separate `classlite` superuser pool (`superuserPool(t)`) used only during cleanup. Tests themselves still run as `classlite_app` so RLS coverage stays real.
- **Concurrent-race test pollution.** `TestCenters_SlugCollisionRegeneration` used a shared const center name — after the first run the base slug already existed, so BOTH goroutines got suffixed slugs on subsequent runs. Fixed by embedding a per-run nonce in the center name.
- **`CreateUserOnPool` residue on partial failure.** ATDD tests registered `t.Cleanup(PurgeUserAndOwnedCenters)` AFTER calls that could `t.Fatal`. If the failure landed between the insert and the cleanup registration, the user row leaked forever. Refactored `CreateUserOnPool` to register `t.Cleanup` inline, right after the successful insert.

### Completion Notes

- **Task 0** — All five red-phase artifacts (from commit `6b522c1`) verified RED before green-phase pickup. Green-phase turned each RED signal (undefined symbols) 1:1 into the corresponding green code.
- **Task 1** — `api.yaml` extended with 4 operations + `EnvelopeMeta.serverTime` (AC preamble). No codegen here — deferred to Task 3.5 per WF-3.
- **Task 2** — Three migration pairs applied. Pre-flight audit clean. Up/down round-trip green.
- **Task 3** — sqlc queries: `UpdateUserPersona`, `GetUserPersona`, `CreateCenterFull`, `CountCenterMembersByUser`, `GetOnboardingProgressByUser`, `UpsertOnboardingProgress`. Single codegen run at the end (WF-3).
- **Task 4** — `model.OnboardingPayload` (typed JSONB with `schemaVersion` + `MigrateOnboardingPayload` forward-compat seam) + `model.NewID()` for tx-first-tenant-set pattern.
- **Task 5** — `TenantContext.EmailVerified` populated in `ExtractTenant` from the existing `GetUserByID` row (Winston-B1 = Amelia-B1 fold). `RequireVerifiedEmail` is a pure context-check middleware.
- **Task 6** — `OnboardingService` validates persona + currentStep, marshals through typed payload (strips unknown top-level fields), returns default state on `pgx.ErrNoRows`. J15 P1-P6 all green.
- **Task 7** — `CenterService` uses interface seams (`AuditLogger`, `accessTokenIssuer`). Tx flow: pre-gen UUID → BEGIN → pre-check → SET LOCAL → slug retry (SAVEPOINT) → center_members with constraint remap → LogWithinTx → COMMIT → MintAccessToken. `AuditService.LogWithinTx` sibling extracted, shared core does NOT re-run `SetTenantContext`. `MintAccessToken` shipped as free function + `AuthService` method.
- **Task 8** — `WriteEnvelope(w, status, clk, data)` emits `{data, meta.serverTime}`. Handlers use it. 16 KiB body cap.
- **Task 9** — 4 routes wired at `cmd/api/main.go` through AC8 chain (ExtractTenant → RequireVerifiedEmail → onboardingLimit 20/min IP-keyed → ErrorMapper → handler).
- **Task 10** — Six J15 patterns pass. `TestCenterMembers_UserUniqueViolation` green. `TestCenters_SlugCollisionRegeneration` under `SetupRawPool` green with per-run nonce name.
- **Task 11** — Onboarding handler ATDD suite (12 tests + AC10 3-subtest attack matrix + DOM-wide privacy ratchet) green. Center handler ATDD (7 tests including concurrent double-post + audit rollback via `brokenAuditLogger`) green.
- **Task 12** — OnboardingService + CenterService focused unit tests + Slug ATDD suite covering AC5b Vietnamese matrix.

### Pragmatic deviations from spec

1. **Google callback matrix test's Carol case removed** under v1 one-center-per-user unique index (FU-2-1-D restore path documented in the test file).
2. **`test.PurgeUserAndOwnedCenters` uses a superuser cleanup pool** for RLS bypass — a cleanup-only escape hatch. Real tests still run as `classlite_app`.
3. **Slug retry uses SAVEPOINT boundaries** per attempt to survive Postgres 25P02 after per-attempt unique-violation. Novel idiom in this codebase.
4. **Task 12 unit tests use `SetupDB` rather than mocked store interface** — Dev Notes §2 AuthDB-reuse debt acknowledged. TEST-BE-4 posture applied at handler layer where the mock seams (`brokenAuditLogger` + `MockAccessTokenIssuer`) are meaningful.

### Implementation Plan (summary)

Executed in story-task order: Task 0 verify → 1 api.yaml → 2 migrations → 3 sqlc + codegen → 4 model → 5 middleware → 6 OnboardingService → 7 CenterService + slug + LogWithinTx + MintAccessToken → 8 handlers → 9 wiring → 10 J15 + slug collision race → 11 handler ATDD suites (added test helpers along the way) → 12 focused service unit tests.

## File List

### Added

- `classlite-api/migrations/20260702120000_add_users_persona.{up,down}.sql`
- `classlite-api/migrations/20260702120100_create_onboarding_progress.{up,down}.sql`
- `classlite-api/migrations/20260702120200_add_center_members_user_unique.{up,down}.sql`
- `classlite-api/internal/store/queries/onboarding_progress.sql`
- `classlite-api/internal/model/onboarding_payload.go`
- `classlite-api/internal/model/id.go`
- `classlite-api/internal/middleware/require_verified_email.go`
- `classlite-api/internal/service/onboarding.go`
- `classlite-api/internal/service/onboarding_test.go`
- `classlite-api/internal/service/center.go`
- `classlite-api/internal/service/center_test.go`
- `classlite-api/internal/service/slug.go`
- `classlite-api/internal/service/mint_access_token_test.go`
- `classlite-api/internal/handler/onboarding_handler.go`
- `classlite-api/internal/handler/center_handler.go`
- `classlite-api/internal/test/story_2_1_helpers.go`
- `classlite-api/internal/test/centers_slug_collision_race_test.go`

### Modified

- `classlite-api/api.yaml` — 4 new operations + envelopes + `EnvelopeMeta`
- `classlite-api/internal/store/queries/users.sql` — added `UpdateUserPersona`, `GetUserPersona`; reordered SELECT columns to keep `generated.User` shared
- `classlite-api/internal/store/queries/centers.sql` — added `CreateCenterFull`
- `classlite-api/internal/store/queries/center_members.sql` — added `CountCenterMembersByUser`
- `classlite-api/internal/store/generated/*` — regenerated (never hand-edit)
- `classlite-api/internal/model/tenant.go` — added `EmailVerified bool`
- `classlite-api/internal/middleware/auth.go` — populates `TenantContext.EmailVerified`
- `classlite-api/internal/middleware/require_verified_email_atdd_test.go` — build tag removed
- `classlite-api/internal/middleware/extract_tenant_context_test.go` — added 2 EmailVerified tests
- `classlite-api/internal/service/audit.go` — extracted `LogWithinTx` + shared `logWithinTxCore`
- `classlite-api/internal/service/auth_login.go` — added `MintAccessToken` (free func + method); added `clock` import
- `classlite-api/internal/service/auth_google_ta_test.go` — Carol multi-center fixture removed (FU-2-1-D restore path)
- `classlite-api/internal/service/slug_atdd_test.go` — build tag removed
- `classlite-api/internal/handler/response.go` — added `WriteEnvelope` + `EnvelopeWithMeta`
- `classlite-api/internal/handler/onboarding_handler_atdd_test.go` — build tag removed
- `classlite-api/internal/handler/center_handler_atdd_test.go` — build tag removed
- `classlite-api/internal/test/onboarding_progress_rls_test.go` — `errorsAs` shim now delegates to stdlib
- `classlite-api/cmd/api/main.go` — wired 4 new routes + `AuditService` instance
- `classlite-web/src/lib/api/client.ts` — regenerated

### Deleted

_None._
