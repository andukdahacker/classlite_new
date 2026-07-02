---
storyId: '2.1'
storyKey: '2-1-onboarding-api-persona-selection-center-setup-and-save-resume'
storyFile: '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
storyTitle: 'Story 2.1: Onboarding API — Persona Selection, Center Setup & Save/Resume'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
inputDocuments:
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/planning-artifacts/epics/epic-02.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/pre-epic-2-blockers-2026-06-30.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go'
  - 'classlite-api/internal/test/adversarial_test.go'
  - 'classlite-api/tools/tenantcheck/tenantcheck.go'
stepsCompleted:
  ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
workflowStatus: 'red-verified-ready-for-dev-story'
generatedTestFiles:
  - 'classlite-api/internal/handler/onboarding_handler_atdd_test.go'
  - 'classlite-api/internal/handler/center_handler_atdd_test.go'
  - 'classlite-api/internal/middleware/require_verified_email_atdd_test.go'
  - 'classlite-api/internal/service/slug_atdd_test.go'
  - 'classlite-api/internal/test/onboarding_progress_rls_test.go'
generationMode: 'AI generation (backend story — no browser recording, mirrors Story 1-5/1-6 ATDD pattern)'
lastSaved: '2026-07-01'
stack: 'backend (Go)'
testFramework: 'Go stdlib testing + existing test/TxDB harness + test.SetupRawPool for concurrency tests'
buildTag: 'atdd_red_phase'
mockSeams:
  - 'service.AuditLogger (NEW interface — Story 2.1 introduces via CenterService constructor; brokenAuditLogger fixture inline for AC6 atomicity test)'
  - 'service.accessTokenIssuer (NEW package-private interface — Story 2.1 introduces at CenterService constructor; production wires *AuthService.MintAccessToken)'
  - 'clock.Clock (existing — MockClock drives audit_logs timestamp determinism)'
  - 'model.TenantContext.EmailVerified (NEW field — Story 2.1 Task 5.0 adds; ExtractTenant populates from existing GetUserByID row at auth.go:59)'
---

# ATDD Checklist — Story 2.1: Onboarding API — Persona, Center Setup & Save/Resume

## Step 1: Preflight & Context — complete

### WF-8 ATDD mandate

Story 2.1 owns **R1 at score 9** — the highest-severity risk in the register. WF-8 says: **MUST have ATDD red tests on the branch before transitioning `ready-for-dev → in-progress`.** R1 mitigation infrastructure (tenantcheck analyzer + J15 grid template) already shipped at commit `2e49d4e`; this ATDD run lands the red-phase evidence Amelia will turn green.

| Risk | Score | Category | Red specimen |
|---|---|---|---|
| **R1** | **9** | DATA/SEC — cross-tenant/user data leakage via missing filter | `internal/test/onboarding_progress_rls_test.go` (six named patterns P1–P6, P4 documented N/A) + `internal/handler/onboarding_handler_atdd_test.go` (three attack-vector subtests per AC10) |
| **R18** (inherited) | 4 | DATA — bulk CSV partial-success orphans | N/A this story — 2.7 owns bulk import |

### Stack detection

- Monorepo is fullstack (Go API + Astro landing + React dashboard). **Story 2.1 is backend-only** — no UI, no E2E, no Playwright.
- `classlite-api/go.mod` present → **backend** effective stack for this story.
- Test framework: Go stdlib `testing`, transactional `*test.TxDB` (helpers.go:86), real Postgres, `test.SetupRawPool(t)` (helpers.go:78) for concurrent tests.
- ATDD pattern: `//go:build atdd_red_phase` tag on every red-phase `*_atdd_test.go` file (mirrors Story 1-5 commit `20ddce1` + Story 1-6 pattern at `internal/service/google_oauth_atdd_test.go`).

### Knowledge fragments loaded (core + backend only)

Skipped Playwright/Pact/UI fragments — Go backend story with no service-contract layer this story.

- `test-quality.md` — DoD, isolation rules, green criteria
- `test-priorities-matrix.md` — P0/P1 thresholds
- `test-levels-framework.md` — service vs handler vs adversarial-integration split
- `test-healing-patterns.md` — flake-detection patterns
- `data-factories.md` — factory patterns (already in `internal/test/fixtures.go`)

### Existing test infrastructure (verified pre-flight)

- `internal/test/helpers.go:86` — `SetupDB(t)` transaction harness
- `internal/test/helpers.go:78` — `SetupRawPool(t)` raw-pool harness (for concurrent tests per Murat-B3)
- `internal/test/helpers.go:120` — `TenantContext(t, db, centerID)` — sets SET LOCAL
- `internal/test/fixtures.go:13-14` — `TenantAID` / `TenantBID` deterministic UUIDs
- `internal/test/fixtures.go:18` — `CreateUser(t, db, email, fullName)`
- `internal/test/fixtures.go:33/49` — `CreateCenter` / `CreateCenterWithID`
- `internal/test/fixtures.go:73` — `CreateCenterMember`
- `internal/test/adversarial_test.go:20-35` — `resetTenantContext` / `resetTenantContextToDefault` helpers for NullTenant/UnsetTenant patterns
- `internal/test/_TEMPLATE_rls_test.go` — build-excluded J15 template shipped 2026-07-01
- `internal/service/auth.go:686` — `isUniqueViolation(err) bool` — reused by CenterService for slug collision + user-unique remap
- `internal/service/refresh_atdd_test.go:235` — canonical concurrent-write ATDD pattern (Story 1.5 refresh-token rotation)
- `internal/handler/auth_handler_test.go` — reference for `NewTestServer(pool)` handler-integration pattern (TEST-BE-3)

## Step 2: Generation Mode — complete

**Mode:** AI generation, sequential (no subagent split — backend-only, no browser). Follows Story 1-5/1-6 precedent: real DB via `test.SetupDB(t)` / `SetupRawPool(t)`, deterministic tenant UUIDs, mocked collaborator interfaces (`AuditLogger`, `accessTokenIssuer`), no Playwright, no MSW.

Every red file carries `//go:build atdd_red_phase` at line 1 so `go test ./...` skips them by default and the red suite runs via `go test -tags atdd_red_phase ./...`. Amelia removes the tag one file at a time during green-phase (mirrors 1-5/1-6 flow).

## Step 3: Test Strategy — complete

### AC → red-phase file mapping

| AC | Priority | Risk link | Red file | Test functions (RED against current code) |
|---|---|---|---|---|
| AC1 (persona persistence) | P1 | — | `handler/onboarding_handler_atdd_test.go` | `TestSetPersona_AC01_ValidValue_Persists`, `TestSetPersona_AC01_UnknownPersona_Returns422`, `TestSetPersona_AC01_Idempotent_BrowserBack`, `TestSetPersona_AC01_NoAuth_Returns401`, `TestSetPersona_AC01_UnverifiedEmail_Returns403` |
| AC2 (center creation) | **P0** | R1 | `handler/center_handler_atdd_test.go` | `TestCreateCenter_AC02_HappyPath_ReturnsOwnerRoleAndToken`, `TestCreateCenter_AC02_SequentialDoublePost_Returns409UserAlreadyHasCenter`, `TestCreateCenter_AC02_ConcurrentDoublePost_BothReturn409NotOne500`, `TestCreateCenter_AC02_UnverifiedEmail_Returns403`, `TestCreateCenter_AC02_ValidationError_Returns422`, `TestCreateCenter_AC02_ResponseIncludesFreshAccessToken` |
| AC3 (progress upsert) | P1 | — | `handler/onboarding_handler_atdd_test.go` | `TestPutProgress_AC03_UpsertsRow`, `TestPutProgress_AC03_UnknownStep_Returns422`, `TestPutProgress_AC03_ReturnsUpdatedAt` |
| AC4 (progress read + persona) | P1 | — | `handler/onboarding_handler_atdd_test.go` | `TestGetProgress_AC04_ExistingRow_ReturnsPayload`, `TestGetProgress_AC04_NoRow_ReturnsDefaultStateNot404`, `TestGetProgress_AC04_JoinsPersonaFromUsers` |
| AC5b (VN slug canonical set) | P1 | — | `service/slug_atdd_test.go` | `TestSlugify_AC05b_CanonicalVietnameseSet` (table-driven — 7 entries) |
| AC6 (audit atomicity) | **P0** | — | `handler/center_handler_atdd_test.go` | `TestCreateCenter_AC06_AuditFailure_RollsBackWholeTx`, `TestCreateCenter_AC06_ExactJsonbShape_BeforeNullAfterPopulated` |
| AC7 (no RLS + service isolation) | **P0** | R1 | `test/onboarding_progress_rls_test.go` | (covered by AC9's six patterns — see below) |
| AC8 (middleware chain) | P1 | — | `middleware/require_verified_email_atdd_test.go` + `handler/onboarding_handler_atdd_test.go` | `TestRequireVerifiedEmail_AC08_VerifiedContext_Passes`, `TestRequireVerifiedEmail_AC08_UnverifiedContext_Returns403`, `TestRequireVerifiedEmail_AC08_MissingContext_Returns500`, `TestOnboardingChain_AC08_UnverifiedUser_Rejected` (integration through full chain) |
| AC9 (J15 grid, R1 discharge) | **P0** | R1 | `test/onboarding_progress_rls_test.go` | `TestOnboardingProgress_P1_ServiceForgetsUserIDFilter`, `TestOnboardingProgress_P2_ServiceTrustsPayloadUserIDInsert`, `TestOnboardingProgress_P3_ServiceTrustsPayloadUserIDUpdate`, `TestOnboardingProgress_P4_DeleteNotApplicable` (documented no-op), `TestOnboardingProgress_P5_NoAuthContextRejects`, `TestOnboardingProgress_P6_DefaultStateFromPgxErrNoRowsDoesNotLeakPrior` |
| AC10 (cross-user attack vectors) | **P0** | R1 | `handler/onboarding_handler_atdd_test.go` | `TestGetProgress_AC10/attack_vector_url_param_override`, `.../attack_vector_body_field_override`, `.../attack_vector_header_spoof`, `TestGetProgress_AC10_DomWidePrivacyRatchet_UserARowNotInUserBResponse` |

### Test-level split per project-context TEST-BE-1..5

- **Store integration + adversarial** → `internal/test/onboarding_progress_rls_test.go` (real DB, transactional, tenant contexts).
- **Service unit** → deferred to green-phase (`internal/service/onboarding_test.go` etc.) — ATDD red covers acceptance-level intent; unit tests are dev's own TDD loop.
- **Handler integration** → `_atdd_test.go` in handler dir uses `test.NewTestServer(pool)`-shaped harness through real middleware (TEST-BE-3).
- **Middleware ATDD** → `_atdd_test.go` in middleware dir mirrors `require_role_atdd_test.go` pattern.

### Priority rationale

- **P0** = R1-linked (AC2, AC6, AC7, AC9, AC10) — all block epic gate PASS.
- **P1** = happy/negative acceptance surface (AC1, AC3, AC4, AC5b, AC8) — MUST-have for green.
- No P2/P3 red specimens this run — those come from `/bmad-tea TA` post-green-phase per WF-8.

### Red-phase files to generate

1. `classlite-api/internal/handler/onboarding_handler_atdd_test.go` — 13 tests across AC1/AC3/AC4/AC10
2. `classlite-api/internal/handler/center_handler_atdd_test.go` — 8 tests across AC2/AC6
3. `classlite-api/internal/middleware/require_verified_email_atdd_test.go` — 3 tests for Task 5.1
4. `classlite-api/internal/service/slug_atdd_test.go` — 1 table-driven test for AC5b
5. `classlite-api/internal/test/onboarding_progress_rls_test.go` — 6 named J15 patterns (no build tag — meant to be permanent from day 1, mirrors `audit_logs_rls_test.go` pattern)

**Total: 5 files, ~31 test functions.**

### Red verification method

Since implementation doesn't exist, every red file MUST fail either:
- **Compile-fail** — references to `handler.NewOnboardingHandler`, `handler.NewCenterHandler`, `service.NewOnboardingService`, `service.NewCenterService`, `service.Slugify`, `middleware.RequireVerifiedEmail`, `model.NewID`, etc. don't resolve → build error is the red signal
- **Assertion-fail** — for any file that happens to compile (e.g. `onboarding_progress_rls_test.go` uses only existing generated types), tests fail at runtime because the schema migrations haven't run

Amelia turns each file green by (a) implementing the referenced identifier, (b) removing the build tag, (c) confirming test passes.

## Step 4: Red-phase specimens — COMPLETE ✅

### Files generated (5 files, ~34 test functions)

| File | Test count | AC coverage | RED signal |
|---|---|---|---|
| `classlite-api/internal/handler/onboarding_handler_atdd_test.go` | 13 tests + 4 subtests | AC1, AC3, AC4, AC8, AC10 | `handler.NewOnboardingHandler` + fixture helpers undefined |
| `classlite-api/internal/handler/center_handler_atdd_test.go` | 8 tests | AC2, AC6 | `handler.NewCenterHandler`, `service.NewCenterService`, `service.AuditLogger`, `service.MintAccessToken` undefined |
| `classlite-api/internal/middleware/require_verified_email_atdd_test.go` | 3 tests | AC8 | `middleware.RequireVerifiedEmail` undefined + `model.TenantContext.EmailVerified` field missing |
| `classlite-api/internal/service/slug_atdd_test.go` | 3 tests (1 table-driven with 10 rows) | AC5b | `service.Slugify`, `service.RandomSuffix` undefined |
| `classlite-api/internal/test/onboarding_progress_rls_test.go` | 7 tests (P1-P6 + center_members uniqueness) | AC7, AC9 (R1 discharge) | `service.OnboardingService`, sqlc-generated `UpsertOnboardingProgress`, `GetOnboardingProgressByUser` undefined |

Total: **~34 red-phase Test* functions** across 5 files.

## Step 5: RED verification — COMPLETE ✅

### Verification commands (2026-07-01)

```bash
# 1. Baseline: without build tag, existing suite still compiles clean.
cd classlite-api && go build ./...
# → exit 0, no output

# 2. J15 grid RED (no build tag — permanent-from-day-1 per AC9).
go test -count=1 ./internal/test/...
# → BUILD FAILED — 6 undefined symbols in onboarding_progress_rls_test.go:
#      service.OnboardingService, service.NewOnboardingService,
#      generated.Queries.GetOnboardingProgressByUser,
#      generated.Queries.UpsertOnboardingProgress,
#      generated.UpsertOnboardingProgressParams,
#      service.UpsertProgressInput
#    ✅ This is the R1-discharge RED signal.

# 3. Build-tagged ATDD files RED — compile-only.
go test -tags atdd_red_phase -run NONE ./internal/handler/... ./internal/middleware/... ./internal/service/...
# → BUILD FAILED — 14 undefined identifiers across 4 test files:
#      handler.NewOnboardingHandler, handler.NewCenterHandler,
#      service.NewOnboardingService, service.NewCenterService,
#      service.AuditLogger, service.MintAccessToken,
#      service.Slugify, service.RandomSuffix,
#      middleware.RequireVerifiedEmail,
#      model.TenantContext.EmailVerified (field missing),
#      + ~13 test fixture helpers not yet exposed on the test package
#        (MarkUserEmailVerified, NewTestServerForUser, SeedOnboardingProgress,
#         SetUserPersona, VerifyAccessToken, LatestAuditLogForUser,
#         CreateUserOnPool, MarkUserEmailVerifiedOnPool,
#         NewTestServerForUserOnPool, PurgeUserAndOwnedCenters,
#         CountRows, MockAccessTokenIssuer, RealClock)
#    ✅ RED signal for AC1/2/3/4/5b/6/8/10.
```

### RED signal → green-phase task mapping

Each undefined symbol maps 1:1 to a Task in the story. Green-phase order Amelia should follow:

| Undefined symbol / field | Story task | File to create/edit |
|---|---|---|
| `model.TenantContext.EmailVerified` field | Task 5.0 | `internal/model/tenant.go` |
| `middleware.RequireVerifiedEmail` | Task 5.1 | `internal/middleware/require_verified_email.go` |
| `service.Slugify` + `service.RandomSuffix` | Task 7.4 | `internal/service/slug.go` |
| `service.AuditLogger` interface | Task 7.1 (define) + Task 7.5 (implement via LogWithinTx) | `internal/service/center.go` + `internal/service/audit.go` |
| `service.MintAccessToken` | Task 7.6 | `internal/service/auth.go` |
| `service.NewOnboardingService` / `OnboardingService` / `UpsertProgressInput` | Task 6.1 | `internal/service/onboarding.go` |
| `service.NewCenterService` / `CreateCenterInput` | Task 7.1 | `internal/service/center.go` |
| `handler.NewOnboardingHandler` | Task 8.1 | `internal/handler/onboarding_handler.go` |
| `handler.NewCenterHandler` | Task 8.2 | `internal/handler/center_handler.go` |
| sqlc: `UpsertOnboardingProgress`, `GetOnboardingProgressByUser` | Tasks 3.3 + 3.5 | `internal/store/queries/onboarding_progress.sql` + `codegen.sh` |
| Test fixture helpers (~13 undefined) | Green-phase — add to `internal/test/fixtures.go` + `helpers.go` as each test is activated | `internal/test/fixtures.go`, `helpers.go` |

The 13 undefined fixture helpers are the story's **implicit test-harness surface** — Amelia expands `internal/test/fixtures.go` incrementally as each RED test is turned green. Not a scope-creep concern: each fixture is a 5–15 line addition, and the test file's requirement of them documents the harness contract inline.

## Handoff to Amelia — sequence

1. ✅ Red suite committed as its own commit (Amelia can rebase-clean).
2. ✅ `atdd-checklist-2-1-*.md` frontmatter updated with 5 generated file paths.
3. ⏳ Amelia updates story's Dev Notes → add pointer to this checklist + generated file list.
4. ⏳ Amelia runs `/bmad-dev-story 2-1` — story flips `ready-for-dev → in-progress`, baseline commit preserved.
5. ⏳ Green-phase workflow: implement Task 5.0 first (unblocks all middleware tests), then Task 7.4 (unblocks slug tests), then Tasks 3.1–3.5 (unblocks sqlc + J15 grid), then Task 6/7 (services), then Task 8 (handlers). Wire routes last (Task 9).
6. ⏳ Each Test* function goes from RED → GREEN one at a time. Amelia removes `//go:build atdd_red_phase` tag from a file only when all its tests pass.
7. ⏳ Post-green: `/bmad-tea TA 2-1` to expand P2/P3 coverage + role-negative + MSW fault injection (per WF-8 stage 3).
8. ⏳ Post-green: `/bmad-tea RV 2-1` for hard-wait / flake-risk review (WF-8 stage 4).
9. ⏳ Epic gate (post-Epic-2): `/bmad-tea TR` + `NR` + `GATE` for merge decision.

## Notes

- **No `test.skip()` used** — that pattern is JS/Playwright. In Go, the `//go:build atdd_red_phase` tag is the equivalent per-file skip mechanism (mirrors Story 1-5/1-6 precedent).
- **`onboarding_progress_rls_test.go` has NO build tag** — per AC9 it is permanent from day 1, mirroring `audit_logs_rls_test.go`. It compile-fails today; once Amelia lands Task 6.1 + Task 3.3, it will run every CI cycle.
- The AC10 attack-vector test file is designed with real cross-tenant seed data + a byte-level ratchet so a service-layer bug returning victim's data (via query-string param, body override, or spoofed header) fails visibly. The ratchet mirrors Story 1.9c's REST-path DOM-wide pattern.
- The **AC6 audit atomicity test** relies on `brokenAuditLogger` — a compile-time assertion `var _ service.AuditLogger = (*brokenAuditLogger)(nil)` locks the interface shape. If Amelia defines `AuditLogger` with a different method signature, this compile-fails first. That's intentional: the interface IS the acceptance contract.
- **P4-Delete (N/A)** is documented as a passing no-op test with two `t.Log` calls. Epic-gate reviewer uses that file's presence as R1 discharge evidence per AC9.


## Handoff to `/bmad-dev-story 2-1`

When all 5 files land + verified red:

1. Commit red suite to branch as its own atomic commit (Amelia can rebase-clean if desired).
2. Update `generatedTestFiles` frontmatter with final paths.
3. Add ATDD Artifacts section pointer in the story's Dev Notes.
4. Sprint-status: 2-1 remains `ready-for-dev` (ATDD red is a pre-in-progress gate, not a status change).
5. Amelia runs `/bmad-dev-story 2-1` — story flips to `in-progress`, dev turns tests green one by one.
