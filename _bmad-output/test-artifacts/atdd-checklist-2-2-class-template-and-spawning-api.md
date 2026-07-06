---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-red-phase
  - step-05-red-verification
lastStep: step-05-red-verification
lastSaved: 2026-07-03
storyId: 2.2
storyKey: 2-2-class-template-and-spawning-api
storyFile: _bmad-output/implementation-artifacts/2-2-class-template-and-spawning-api.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-2-2-class-template-and-spawning-api.md
generatedTestFiles:
  - classlite-api/internal/middleware/require_center_context_atdd_test.go
  - classlite-api/internal/test/class_templates_rls_test.go
  - classlite-api/internal/test/template_sessions_rls_test.go
  - classlite-api/internal/test/classes_rls_test.go
  - classlite-api/internal/service/class_atdd_test.go
  - classlite-api/internal/handler/template_handler_atdd_test.go
inputDocuments:
  - _bmad-output/implementation-artifacts/2-2-class-template-and-spawning-api.md
  - _bmad-output/project-context.md
  - docs/project-context.md
  - _bmad-output/test-artifacts/test-design/test-design-architecture.md
  - .claude/skills/bmad-tea/resources/knowledge/data-factories.md
  - .claude/skills/bmad-tea/resources/knowledge/test-quality.md
  - .claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md
  - .claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md
  - .claude/skills/bmad-tea/resources/knowledge/risk-governance.md
riskDischarge:
  - R1 (score=9): J15 6-pattern grid × 3 resource families + 5 named extensions = 23 RLS tests
---

# ATDD Checklist — Story 2-2 Class Template & Spawning API

**Owner:** Murat (Test Architect) — `/bmad-tea AT 2-2`
**Baseline:** commit `26c569b` (Story 2-1 done + TA P2/P3 backfill + AC6 hardening + RV MED fixes)
**Status:** RED phase specimens committed. Ready for `/bmad-dev-story 2-2` hand-off.
**WF-8 gate:** R1 score = 9 (from `test-design-architecture.md:122`) → ATDD is MANDATORY before backlog→in-progress.

## 1. Test strategy

Story 2.2 lands three new resource families (`class_templates`, `template_sessions`, `classes`) each with dual-scope (system-seed + tenant) or standard center-scoped RLS + a `BEFORE INSERT` trigger on `template_sessions`, plus the first invite-email SEND path in production. The R1 discharge protocol requires **J15 6-pattern grid × 3 = 18 tests** + **5 named extensions** (Murat-M-B1×3 on `template_sessions`, Murat-M-B2×2 on `class_templates`) = **23 RLS tests total**. Every AC gets a matching red specimen at the correct level per project-context test pyramid (TEST-BE-1..4):

| Layer | File | Justification |
|---|---|---|
| RLS (integration, real DB) | 3 × `internal/test/*_rls_test.go` | R1 discharge — DB policy behavior can only be proven at the DB layer. |
| Service (integration, real DB + injected seams) | `internal/service/class_atdd_test.go` | AC4 branch matrix + AC5 dedup/race + AC6 Founder + AC9 audit atomicity — business rules the handler-level test can't isolate cleanly. |
| Middleware (unit) | `internal/middleware/require_center_context_atdd_test.go` | AC8 middleware contract — pure context check, no DB. |
| Handler (integration, real middleware) | `internal/handler/template_handler_atdd_test.go` | AC1/AC2/AC3/AC8/AC11/AC12/AC13 — real chain, envelope, error routing, attack matrix. |

**Mock discipline (TEST-BE-4):** only `AuditLogger` + `InviteSender` are mocked — via constructor seams that mirror Story 2.1's `CenterService{audit AuditLogger, tokens accessTokenIssuer}` pattern. No `pgx` mocks; no store-interface stubs. `brokenAuditLogger` proves tx atomicity (AC9). `MockInviteSender` records `Enqueue` calls so branch-C behavior can be asserted.

## 2. AC → file matrix

| AC | Requirement | Red-phase file(s) | Test count |
|---|---|---|---|
| AC1 | GET /api/templates dual-scope + 500 SEED_INCOMPLETE + 401/403 | `template_handler_atdd_test.go` | 4 |
| AC1b | 5 fixed-UUID system seeds visible to all tenants | `class_templates_rls_test.go` (Extension 1) | 1 |
| AC2 | POST /api/templates single-tx + validation matrix + 403 | `template_handler_atdd_test.go` | 4 |
| AC3 | POST /api/templates/{id}/spawn all-or-nothing + response shape | `template_handler_atdd_test.go` + `class_atdd_test.go` | 4 (handler) + 4 (service branch matrix) |
| AC4 | Teacher resolution — Branch A/B/C/D + explicit ordering | `class_atdd_test.go` | 4 branch tests + Murat-M-B3 post-accept test |
| AC4b | Self-invite blocked (Sally-B4 belt) | `class_atdd_test.go` | 1 |
| AC5 | Invite dedup within payload + race retry-and-reuse | `class_atdd_test.go` | 2 |
| AC6 | Founder auto-assign on classes[0] | `class_atdd_test.go` + `template_handler_atdd_test.go` | 1 (service) + 1 (handler) |
| AC7 | RLS 4 policies per table (SELECT/INSERT/UPDATE/DELETE with WITH CHECK) | 3 × `*_rls_test.go` | Covered inside the J15 grid |
| AC8 | Middleware chain `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → onboardingLimit` | `require_center_context_atdd_test.go` + `template_handler_atdd_test.go` | 3 (unit) + covered by AC1/AC2 negatives |
| AC9 | Audit atomicity — brokenAuditLogger rolls back N classes + invites | `class_atdd_test.go` | 1 |
| AC10 | J15 6-pattern × 3 families + 5 named extensions | 3 × `*_rls_test.go` | 23 total (see §4) |
| AC11 | Attack matrix (body_center / template_from_other / header_center_spoof) | `template_handler_atdd_test.go` | 3 subtests |
| AC12 | Envelope shape `{data, meta}` / `{error: {code, message, requestId, details}}` | `template_handler_atdd_test.go` | 1 focused + assertion in every happy path |
| AC13 | Error code catalog — 10 codes wired to wizard router | `template_handler_atdd_test.go` + `require_center_context_atdd_test.go` | Assertions embedded in each negative test |

## 3. Files generated (this run)

```
classlite-api/internal/middleware/require_center_context_atdd_test.go
classlite-api/internal/test/class_templates_rls_test.go
classlite-api/internal/test/template_sessions_rls_test.go
classlite-api/internal/test/classes_rls_test.go
classlite-api/internal/service/class_atdd_test.go
classlite-api/internal/handler/template_handler_atdd_test.go
```

**Naming note:** Story Task 0.1 lists the ClassService red file as `class_test_TA.go`, which conflicts with the codebase's `_atdd_test.go` (ATDD red-phase) vs `_ta_test.go` (post-dev TA expansion) convention (see `internal/service/google_oauth_atdd_test.go` + `google_oauth_ta_test.go`). Applied convention over story-file typo — file is generated as `class_atdd_test.go`. Story owner (John) may want to fold this into a story amendment.

## 4. J15 grid × 3 resource families — 23 tests

### `class_templates_rls_test.go` (8 tests)

- `TestRLS_ClassTemplate_CrossTenantRead`
- `TestRLS_ClassTemplate_CrossTenantInsert` — also asserts user cannot INSERT with `center_id = NULL`
- `TestRLS_ClassTemplate_CrossTenantWrite`
- `TestRLS_ClassTemplate_CrossTenantDelete`
- `TestRLS_ClassTemplate_NullTenant`
- `TestRLS_ClassTemplate_UnsetTenant`
- `TestRLS_ClassTemplate_SystemSeedsVisibleToAllTenants` **(Ext 1 — Sally-S1 raised threshold to ≥5)**
- `TestRLS_ClassTemplate_UserCannotInsertSystemScopeRow` **(Ext 2 — Murat-M-B2, WITH CHECK guard)**

### `template_sessions_rls_test.go` (9 tests)

- `TestRLS_TemplateSession_CrossTenantRead`
- `TestRLS_TemplateSession_CrossTenantInsert`
- `TestRLS_TemplateSession_CrossTenantWrite` (title UPDATE — trigger fires only on `UPDATE OF template_id`)
- `TestRLS_TemplateSession_CrossTenantDelete`
- `TestRLS_TemplateSession_NullTenant`
- `TestRLS_TemplateSession_UnsetTenant`
- `TestRLS_TemplateSession_TriggerReconcilesToParentTenancy` **(Ext 1 — trigger positive path)**
- `TestRLS_TemplateSession_ParentTenantMismatchRejectedByWithCheck` **(Ext 2 — Murat-M-B1 load-bearing)**
- `TestRLS_TemplateSession_UserCannotPlantSessionUnderSystemSeed` **(Ext 3 — R1 dual-scope negative)**

### `classes_rls_test.go` (6 tests)

Standard center-scoped RLS, no dual-scope, no trigger. Six J15 patterns only.

- `TestRLS_Class_CrossTenantRead`
- `TestRLS_Class_CrossTenantInsert`
- `TestRLS_Class_CrossTenantWrite`
- `TestRLS_Class_CrossTenantDelete`
- `TestRLS_Class_NullTenant`
- `TestRLS_Class_UnsetTenant`

## 5. Green-phase helpers Amelia must land (Task 11.6)

`internal/test/story_2_2_helpers.go` — mirrors `story_2_1_helpers.go` shape. Referenced symbols (compile-fail markers in the ATDD files):

| Symbol | Purpose |
|---|---|
| `NewTestServerFor2_2ForUser(t, db, userID) http.Handler` | Wires the Story 2.2 route chain (ExtractTenant → onboardingLimit → RequireVerifiedEmail → RequireCenterContext → handler) with a pre-signed access token for `userID`. Sibling to `NewTestServerForUser` in `story_2_1_helpers.go`. |
| `NewTestServerFor2_2Unauthenticated(t, db) http.Handler` | Same chain without a Bearer token — proves 401. |
| `CreateCenterForOwner(t, pool, userID) pgtype.UUID` | INSERT `centers` + `center_members(role='owner')`. Returns center id. Uses `t.Cleanup` for residue. |
| `CreateClassTemplate(t, pool, centerID, name) pgtype.UUID` | INSERT `class_templates` under tenant context. Returns template id. |
| `SeedCenterForUser(t, db, userID) pgtype.UUID` | TxDB-scoped variant of `CreateCenterForOwner` used in negative-path handler tests. |
| `AddCenterMember(t, pool, centerID, userID, role)` | INSERT `center_members` row. |
| `SeedActiveInvite(t, pool, centerID, email, inviterID)` | INSERT active `invites` row (accepted_at NULL) to test Branch B > C precedence + race retry-and-reuse. |
| `SeedAcceptedInvite(t, pool, centerID, email, inviterID, acceptedByID)` | INSERT already-accepted invite for Murat-M-B3 post-accept re-invite test. |
| `SetUserPersonaOnPool(t, pool, userID, persona)` | Raw-pool version of `SetUserPersona` for spawn tests. |
| `NewPGUUIDFromString(s) pgtype.UUID` | Small util for constructing pgtype.UUID from a UUID string in tests. |

`test.PurgeUserAndOwnedCenters` cascade must extend to `class_templates` + `template_sessions` + `classes` — verify FK `ON DELETE CASCADE` from `centers.id` handles the full chain (see Story Task 2.6 audit).

## 6. Green-phase service seams Amelia must expose (Task 7.1)

For `service_test` to compile once green code lands, the following types + functions must exist at these exact shapes:

```go
// internal/service/class.go
type InviteSender interface {
    Enqueue(job EmailJob) (accepted bool)  // matches service.EmailRetryQueue
}

type SpawnClassInput struct {
    CohortName   string
    StartDate    string  // "2006-01-02"
    TeacherEmail *string // nil / empty → Branch D (or founder auto-assign for classes[0])
}

type SpawnInput struct {
    Classes []SpawnClassInput
}

type SpawnedClass struct {
    ID                      string
    Name                    string
    StartDate               string
    TeacherID               *uuid.UUID
    TeacherEmail            *string
    PendingTeacherEmail     *string
    TeacherStatus           string // "assigned" | "invited" | "unassigned"
    TeacherAssignmentReason string // "explicit_self" | "explicit_member" | "founder_auto" | "invited" | "unassigned"
}

type SpawnInviteEntry struct {
    Email                string
    ClassIndices         []int
    Enqueued             bool
    ReusedExistingInvite bool
    ExpiresAt            string
}

type SpawnResult struct {
    Classes     []SpawnedClass
    Invites     []SpawnInviteEntry
    InvitesSent int // count of newly-created rows that were also enqueued=true
}

func NewClassService(db AuthDB, audit AuditLogger, inviter InviteSender, clk clock.Clock) *ClassService

func (s *ClassService) Spawn(
    ctx context.Context, tc model.TenantContext,
    userID uuid.UUID, templateID uuid.UUID,
    input SpawnInput,
) (*SpawnResult, error)
```

The `AuditLogger` interface reuses Story 2.1's `service.AuditLogger` (defined in `center.go`). The compile-time assertion `var _ service.AuditLogger = (*brokenAuditLogger)(nil)` in `class_atdd_test.go` locks that reuse.

## 7. RED verification transcript

Ran `go vet ./...` + a targeted `go test` at commit `26c569b` (pre-Amelia). Expected compile-fails and DB-relation-missing errors surface across all four packages:

```
$ go vet ./...
# github.com/ducdo/classlite-api/internal/middleware_test
vet: internal/middleware/require_center_context_atdd_test.go:41:22: undefined: middleware.RequireCenterContext
# github.com/ducdo/classlite-api/internal/service_test
vet: internal/service/class_atdd_test.go:83:15: undefined: service.InviteSender
# github.com/ducdo/classlite-api/internal/handler_test
vet: internal/handler/template_handler_atdd_test.go:40:19: undefined: test.CreateCenterForOwner
```

```
$ go test -run '^TestRLS_ClassTemplate' ./internal/test/
--- FAIL: TestRLS_ClassTemplate_CrossTenantRead
    class_templates_rls_test.go:67: ERROR: relation "class_templates" does not exist (SQLSTATE 42P01)
--- FAIL: TestRLS_ClassTemplate_CrossTenantWrite
--- FAIL: TestRLS_ClassTemplate_CrossTenantDelete
--- FAIL: TestRLS_ClassTemplate_NullTenant
--- FAIL: TestRLS_ClassTemplate_UnsetTenant
--- FAIL: TestRLS_ClassTemplate_SystemSeedsVisibleToAllTenants
FAIL
```

**Interpretation:** compile-fails at every extension point (middleware/service/handler) prove the green-phase symbols are absent; RLS relation-missing errors prove the migrations haven't run. Both are load-bearing red-phase signals — Amelia turns these green Task-by-Task per §8.

**Known false-positive caveat:** `TestRLS_ClassTemplate_CrossTenantInsert` and `TestRLS_ClassTemplate_UserCannotInsertSystemScopeRow` both assert `err != nil` on the INSERT. When the relation doesn't exist yet, `err` is non-nil for the wrong reason ("relation does not exist" vs the desired "WITH CHECK violation"). These two tests will only differentiate correct-vs-broken behavior AFTER migrations land. Documented so Amelia doesn't rely on them alone during Task 2 — she should run the full RLS suite after Task 2.6 (migrate down/up round-trip) to confirm the WITH CHECK checks actually catch the intended violations. Same caveat for `template_sessions_rls_test.go`'s Insert + parent-mismatch + system-seed-plant tests.

## 8. Green-phase task ordering (Amelia — post-hand-off)

Follows Story §Dev Notes → Green-phase order:

1. **Task 2 (migrations)** — five migration pairs land. RLS tests immediately go from red (relation missing) to real red (RLS assertions failing) → all green if policies + trigger + CHECK constraints are correct.
2. **Task 4 (RequireCenterContext middleware)** — 3 middleware unit tests turn green.
3. **Task 5 (DTOs)** — `model.CreateTemplateInput`, `SpawnInput`, etc. compile.
4. **Task 3 (sqlc queries) + Task 3.6 codegen** — service tests still red until `NewClassService` lands.
5. **Task 6 (TemplateService)** — `List` / `Create` service methods; handler tests for AC1/AC2 partially unblock.
6. **Task 7 (ClassService)** — `Spawn` transactional flow; unblocks `class_atdd_test.go` full matrix.
7. **Task 8 (handlers)** — `template_handler.go` implements the three endpoints; unblocks handler ATDD suite.
8. **Task 9 (main.go wiring)** — routes go live; handler tests turn green.
9. **Task 10 (J15 named extensions)** — story reserves these as R1 discharge; they're already in the RLS files shipped here.
10. **Task 11 (helper landing)** — `story_2_2_helpers.go` per §5 above; without it, handler + service ATDD tests fail to build even after §6 lands.
11. **Task 12 (service unit expansion)** — POST-dev TA-time work (delegated to `/bmad-tea TA 2-2`); NOT this red-phase deliverable.

## 9. Preservation checklist (for Amelia + code-reviewer)

Do NOT alter these test assertions during green-phase — they encode the ACs literally:

- `teacherAssignmentReason` enum values (5 strings). Any drift breaks Sally-B1 fold + wizard error routing.
- `AC13 error code catalog` — assertions on `AUTHENTICATION_REQUIRED` (AC13 pin uses this — but see Story 2.1 uses `AUTH_REQUIRED`; if Amelia lands `AUTH_REQUIRED` here instead, story owner must reconcile the AC13 table or the test). **Current ATDD file uses AC13's spelling. If green-phase adopts Story 2.1's `AUTH_REQUIRED`, update this file to match.**
- `AC3 response shape` — `invitesSent = count(newly-created && enqueued)`. If the meaning drifts, the wizard's s04/s06 done screen lies.
- `AC5 race retry-and-reuse` — `reusedExistingInvite=true, enqueued=false`. Locking this pair together protects against a regression where a race resends the invite email to a teacher who already got one.
- `AC9 audit atomicity` — brokenAuditLogger MUST cascade a full rollback (classes + invites + audit). If any of the three tables shows residue, the tx wasn't tight enough.
- `AC1b ≥5 system seeds` — do NOT relax to ≥4 (Sally-S1 fifth seed Academic Reading 6.5 closes the Vietnamese Reading-standalone gap per the story amendments).

## 10. Post-green loop — `/bmad-tea RV 2-2` and `/bmad-tea TA 2-2`

- **`/bmad-tea RV 2-2`** — after green phase runs against the full ATDD suite for hard-wait / hidden-assertion / flake-risk sweep. Sibling to Story 2.1's `RV` run at commit `ffa512b`.
- **`/bmad-tea TA 2-2`** — expands P2/P3 scenarios per Task 12 (validation matrix widen, MSW-analog HTTP negatives, additional Founder-persona edge cases like `X-Center-ID` on header spoof combined with body attack). Ships the `TestClassService_Spawn_InviteEnqueueBufferFullSucceedsBestEffort` variant with a real InProcessRetryQueue if desired.

## 11. Hand-off

Story `ready-for-dev`. Amelia:

```
/bmad-dev-story 2-2
```

Turn compile-fail → real-fail → green Task by Task. If any AC turns green in a way this checklist didn't specify, amend the checklist first before writing the fix — the checklist is the load-bearing R1 record.
