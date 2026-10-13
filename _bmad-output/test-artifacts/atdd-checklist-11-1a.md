---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-10-12'
storyId: '11.1a'
storyKey: '11-1a'
storyFile: '_bmad-output/implementation-artifacts/11-1a-seed-fixtures-and-test-tenant-isolation.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-1a.md'
generatedTestFiles:
  - 'classlite-api/internal/test/seed_determinism_atdd_test.go'
  - 'classlite-api/internal/test/seed_synthetic_confession_atdd_test.go'
  - 'classlite-api/internal/test/seed_reset_atdd_test.go'
  - 'classlite-api/internal/test/seed_credentials_atdd_test.go'
  - 'classlite-api/internal/test/seed_destructive_guard_atdd_test.go'
  - 'classlite-api/internal/test/testmain_lifecycle_atdd_test.go'
  - 'classlite-api/internal/test/seed_committed_isolation_behavioral_test.go'
  - 'classlite-api/internal/test/rawpool_concurrency_behavioral_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-1a-seed-fixtures-and-test-tenant-isolation.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/fixtures.go'
  - '.claude/skills/bmad-tea/resources/knowledge/data-factories.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-quality.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md'
---

# ATDD Red-Phase Checklist — Story 11-1a: Seed Data, Fixtures & Test-Tenant Isolation

## Step 1 — Preflight & Context

### Stack & framework
- **Detected stack:** `backend` (Go). Repo is fullstack, but 11-1a is verification infrastructure with **no browser surface** — DD11 mandates Go red-phase, not Playwright-on-Playwright.
- **Test config present:** `classlite-api/go.mod`, `*_test.go` throughout `internal/`, established `//go:build atdd_red_phase` convention (70+ tagged files).
- **TEA flags:** `test_stack_type=auto`→backend; `tea_use_playwright_utils=true` (N/A here); `tea_use_pactjs_utils=false`; `tea_pact_mcp=none`.

### Prerequisites (all met)
- ✅ Story `ready-for-dev` with 8 BDD acceptance criteria (AC1–AC8).
- ✅ Backend test config exists.
- ✅ Dev environment available.

### WF-8 gate status
- **TRIPPED.** Risk register (`test-design-architecture.md:236-237`) confirms:
  - **R-11-4** (DATA/SEC) — seed/test data reaching staging/prod — **score 6**.
  - **R-11-5** (DATA/SEC) — cross-tenant leak via committed raw-pool helpers under parallel workers — **score 6**.
- Per WF-8 hard rule: ATDD red tests MUST be on the branch before the story transitions to `in-progress`.

### Red-phase convention (repo-ratified, `reference_atdd_red_convention`)
- **Compile-fail / import-fail red**, NOT `test.skip()` (a skipped test is inert, not red).
- Go: `//go:build atdd_red_phase`. `go build/test ./...` stays GREEN (files excluded); `go test -tags=atdd_red_phase ./...` FAILS TO COMPILE on not-yet-existing seams.
- **DD11 exception for AC2:** AC2's isolation red is **BEHAVIORAL** — it must compile + RUN and go RED against today's leaky committed raw-pool baseline (proving the assertion has teeth), then GREEN after AC7's refactor. A compile-fail red there would never execute the isolation assertion and prove nothing.
- Every file carries a `SEAMS (dev, green phase)` header block naming the one place to reconcile.

### Real test surface (project-context fixture names are aspirational — build against THIS)
- `internal/test/helpers.go`: `SetupDB(t) *TxDB` (BEGIN + `SET LOCAL ROLE classlite_app` + auto-rollback — residue-free, **do not touch**); `SetupRawPool(t) *pgxpool.Pool` (shared committed pool — the leak surface); `TenantContext(t, *TxDB, pgtype.UUID)`; `UUIDString`.
- `internal/test/fixtures.go`: `TenantAID`/`TenantBID` (`…0001`/`…0002`); `CreateUser`, `CreateCenter`, `CreateCenterWithID`, `CreateCenterMember`.
- **Net-new seams (do not exist yet):** `cmd/seed`, `internal/seed`, `TestMain` in `internal/test`, role-grant migration pair, `docs/product/screens.yaml`, s-ID lint `.mjs`, `TEST_DATABASE_URL`.

### AC → priority → red-mode map (provisional, finalized in Step 2)
| AC | Theme | Priority | Red mode |
|---|---|---|---|
| AC1 | Deterministic idempotent seed (content-hash + golden digest) | P0 (data integrity) | compile-fail `atdd_red_phase` |
| AC2 | Cross-tenant isolation on committed path (R-11-5) | P0 (security) | **BEHAVIORAL** (compiles+runs, red vs leaky baseline) |
| AC3 | Per-tenant reset leaves others byte-identical | P1 | compile-fail `atdd_red_phase` |
| AC4 | credentials.json + screens.yaml + s-ID lint | P2 | compile-fail (Go emit) + lint harness assertion |
| AC5 | Resource budget + positive-proof destructive guard (R-11-4) | P0 (security/data) | compile-fail `atdd_red_phase` |
| AC6 | TestMain lifecycle, non-superuser migrate, replay resolved | P1 | compile-fail `atdd_red_phase` |
| AC7 | Raw-pool helpers refactored + multi-conn `-race` concurrency (R-11-5) | P0 (security) | **BEHAVIORAL** concurrency red |
| AC8 | Synthetic data structurally confesses (minors/VN) | P1 (compliance) | compile-fail `atdd_red_phase` |

## Step 2 — Generation Mode
- **Mode: AI Generation** (backend stack → recording skipped by rule §2; ACs clear; source-code surface already analyzed).
- Recording N/A — no browser surface in 11-1a (DD11).

## Step 3 — Test Strategy

### Levels (backend)
All scenarios land at Go **unit** (pure transforms, guard logic) or **integration** (real DB in tx or committed pool, RLS, migrations) + one **Node lint harness** (s-ID lint). **No E2E** (DD11). The tx-rollback `SetupDB` path proves RLS-*policy* correctness; the committed `SetupRawPool` path is the surface R-11-5 actually broke and where the behavioral reds live.

### Honest-teeth design note for the behavioral reds (AC2, AC7)
RLS already filters committed rows by `app.current_tenant_id`, so "B-scoped connection sees A's rows" is **not** red today and is **not** the real defect. The real R-11-5 defect is **committed residue in shared `classlite_dev` under no-reset / parallel workers**. The behavioral reds therefore assert:
1. **Clean-slate invariant** — the DB holds zero pre-existing seed/synthetic rows at entry and leaves zero at exit (RED today: raw-pool helpers commit with hand-maintained cascades and no TRUNCATE/reset → residue persists; GREEN after AC7 tenant-scoped-commit + disposable `classlite_test`).
2. **Multi-connection `-race` isolation** — N goroutines on N pool connections, committed A/B seeds, `go test -race`: no cross-tenant read, no data race, deterministic teardown (RED today: helper/harness absent + residue; GREEN after refactor).
Each negative pairs a **positive control** (A sees its own sentinel) so an empty-for-everyone false pass is caught (test-priorities P0 rule: negative + positive).

### Planned seams (net-new API the reds pin — the ONE reconciliation surface)
| Seam | Planned contract | Consumed by |
|---|---|---|
| `internal/seed` pkg | `seed.Run(ctx, pool, Options) (*Result, error)` — idempotent, store-layer-only, per-tenant `SetTenantContext` window | AC1 |
| `seed.ContentHash(ctx, pool) (string, error)` | canonical deterministic serialization of seeded rows, **excluding** bcrypt hashes + server-default timestamps | AC1, AC3 |
| `seed.GoldenDigest` (const) | committed golden content-hash | AC1 |
| `seed.CenterAID` / `seed.CenterBID` | deterministic tenant UUIDs, **must equal** `test.TenantAID`/`TenantBID` | AC1, AC2 |
| `seed.Reset(ctx, pool, centerID) error` | per-center superuser cascade, other tenants byte-identical | AC3 |
| `seed.DestructiveReset(ctx, pool, DestructiveOptions) error` | positive-proof guard: db-name==`classlite_test` AND sentinel object AND opt-in; else non-zero abort | AC5 |
| `seed.WriteCredentials(result, path) error` + `seed.CredentialsEntry{Role,Email,Password,CenterShortCode,CenterID}` | emits `tests/e2e/.auth/credentials.json` | AC4 |
| `seed.SyntheticMarker` / `seed.SyntheticEmailDomain` (`@example.test`) | in-data confession sentinel + non-natural-person identity scheme | AC8 |
| `test.TestMain` + `test.EnsureTestDB()` | `TestMain`-owned ensure-DB + `migrate up` as non-superuser role against `classlite_test` via `TEST_DATABASE_URL`; throwaway `classlite_dev` replay fix | AC6 |
| role-grant migration pair | `CREATE ROLE IF NOT EXISTS` (cluster-guard) + `EXECUTE format('GRANT CONNECT ON DATABASE %I …', current_database())` | AC6 |
| `scripts/screens-lint.mjs` + `docs/product/screens.yaml` | bidirectional shape/referential-integrity + enum lint over `s\d{2}[a-z]?` | AC4 |

### AC → scenarios → level → priority → red mode

**AC1 — Deterministic idempotent seed (P0, data integrity) — compile-fail `atdd_red_phase`**
- `TestSeed_ContentHashStableAndMatchesGolden` (integration): run `seed.Run` twice on fresh DB → `hash1==hash2==seed.GoldenDigest`; non-deterministic columns excluded. Negative: a second run creates **no** duplicate rows (ON CONFLICT path), not just equal counts.
- `TestSeed_CoversAllRolesAndEpics1to8` (integration): owner/admin/teacher/≥2 students per center; classes active+ended; enrollments; exercises ×4 skills; assignments; submissions ×4 attempt types; ≥1 released grade w/ IELTS band; attendance; files. Positive presence assertions + a negative (no chapter 6/7 Epic-9/10 entities — that's 11-1b).
- `TestSeed_NoLiveExternalDeps` (unit/integration): speaking submission references a seeded R2 key via the **mock** object store; `seed.Run` requires no R2/Gemini client. Store-layer-only — assert no domain event / audit / email / job side-effect row is produced (DD1 guard: query `audit_logs`/notifications empty for the seeded centers).

**AC2 — Cross-tenant isolation, COMMITTED path (P0, security) — BEHAVIORAL red (no build tag)**
- `TestCommittedPath_CleanSlateInvariant` (integration, behavioral): asserts zero pre-existing seed/synthetic rows at entry across the 5 8-4a tables; commits A sentinels; asserts a fresh B-scoped connection sees **zero A rows** across `classes, center_members(+users), exercises, assignments, files` in **both directions** + **positive B control**; asserts clean at exit. The students/`users` path is proven via a join gated by `center_members.center_id` (users is GLOBAL/no-RLS). **RED today** (residue persists, no reset); GREEN after AC7.
- Documented as the **teeth evidence** per DD11 — this one must be observed RED in Step 4, not assumed.

**AC3 — Per-tenant reset (P1) — compile-fail `atdd_red_phase`**
- `TestReset_LeavesOtherTenantByteIdentical` (integration): seed A+B, record `seed.ContentHash` scoped per center, `seed.Reset(B's center absent → A)`; assert A gone **and** B's content hash unchanged. Subject to DD13 guard (reset refuses non-disposable target).

**AC4 — credentials.json + screens.yaml + s-ID lint (P2) — mixed red**
- `TestSeed_EmitsCredentialsJSON` (integration, `atdd_red_phase`): `seed.WriteCredentials` emits one `{role,email,password,centerShortCode,centerId}` per seeded role; path is `tests/e2e/.auth/credentials.json`; distinct from `.playwright/auth.json`; `.auth/` is gitignored (assert `.gitignore` entry).
- `TestScreensLint_BidirectionalAndShape` (Node harness red): the `.mjs` lint + `docs/product/screens.yaml` don't exist → harness invocation fails. When built: fails on any `s\d{2}[a-z]?` token under docs/_bmad-output/web/api with no manifest entry AND any entry unreachable from a doc; validates enums (`implementation_status`/`provenance`) + `last-verified` shape; **never rewrites** the 86 story files; one entry per s00–s87 + `s10a` (89 entries).

**AC5 — Resource budget + positive-proof destructive guard (P0, security) — compile-fail `atdd_red_phase`**
- `TestDestructiveReset_RefusesWithoutAllThreeProofs` (integration): table-driven — missing db-name proof / missing sentinel object / missing opt-in each → **non-zero error, no deletion**; all three present on a disposable target → proceeds. Asserts it is NOT prod-shape-URL detection (a "local-looking" URL without sentinel is still refused).
- Resource-budget doc (AC5 prose) verified by a cheap presence assertion in the lint/CI, not a Go test — noted as a dev checklist item, not a red test.

**AC6 — TestMain lifecycle (P1) — compile-fail `atdd_red_phase`**
- `TestTestMain_MigratesAsNonSuperuserAgainstTestDB` (integration): after `TestMain`, connect to `classlite_test`, assert `current_database()=='classlite_test'`, assert the migration role is **NOT** superuser (`rolsuper=false`), assert schema migrated. Seam: `test.TestMain`/`test.EnsureTestDB`.
- `TestRoleGrantMigration_IsDBAgnostic` (integration): the new migration uses `current_database()` GRANT + cluster-guarded `CREATE ROLE`; replay on a fresh DB does not error on the immutable `classlite_dev` GRANT (throwaway-DB resolution present). Assert `SetupDB` tx-rollback is unchanged (regression guard: a known `SetupDB` test still passes).

**AC7 — Raw-pool refactor + multi-conn concurrency (P0, security) — BEHAVIORAL red**
- `TestRawPool_Inventory_AllClassifiedAndNoRawCommit` (integration/meta): a committed classification table exists (`rollback|tenant-scoped-commit|raw-commit`) and **zero** helpers remain `raw-commit` into shared `classlite_dev`. Red today (un-refactored helpers commit raw).
- `TestRawPool_NoCrossTenantLeakUnderConcurrency` (integration, `-race`, behavioral): N goroutines, N pool connections, committed A/B seeds; assert no cross-tenant read under parallel load + no data race + deterministic teardown (no residue). The failure mode a single-tx test structurally cannot exercise. **RED today**, GREEN after refactor.
- `prePurgeHooks` retired/minimized — asserted by the clean-slate invariant (AC2) passing without the hand-maintained cascade.

**AC8 — Synthetic confession (P1, compliance) — compile-fail `atdd_red_phase`**
- `TestSeed_SyntheticDataStructurallyConfesses` (integration): a **raw DB query** (not a source comment) can distinguish seed rows (sentinel marker / `SEED_FAKE_` identifier) from real; seeded student emails end `@example.test`, names/DOBs are sentinel, never a plausible VN minor identity shape. Negative: no seeded student carries a natural-person-shaped identity.

### Red-phase confirmation
- **Compile-fail reds** (AC1, AC3, AC4-creds, AC5, AC6, AC8): behind `//go:build atdd_red_phase`. `go test ./...` stays GREEN; `go test -tags=atdd_red_phase ./...` FAILS TO COMPILE on the planned seams above. Every compile error must map to a documented missing seam — none against an existing helper.
- **Behavioral reds** (AC2, AC7): no build tag; compile + run; must be **observed RED** against baseline `6a4eb4d` in Step 4 (clean-slate / concurrency-residue), GREEN after AC7 refactor + disposable `classlite_test`.
- **Lint red** (AC4-lint): the `.mjs` + `screens.yaml` absent → harness fails; documented as missing-artifact red.

## Step 4 / 4c — Generation & Aggregation

**Convention override (vs the skill's `test.skip()` + API/E2E-subagent machinery):** per `reference_atdd_red_convention` + DD11, this repo's red is **compile-fail / behavioral**, not `test.skip()`. Generated directly in **sequential** mode (not `/tmp/*.json` subagents) so the Go binds to the real `internal/test` surface. No placeholder assertions — every assertion encodes expected behavior. No new fixtures — existing helpers (`SetupRawPool`, `SuperuserPool`, `CountRows`, `TenantAID/BID`) reused.

### Generated files (8)
**Compile-fail reds** (`//go:build atdd_red_phase`, `package test`, import the greenfield `internal/seed`):
1. `seed_determinism_atdd_test.go` — AC1 (content-hash + golden digest; coverage Epics 1–8; store-only no-side-effects).
2. `seed_synthetic_confession_atdd_test.go` — AC8 (in-data marker; non-natural-person `@example.test` identities).
3. `seed_reset_atdd_test.go` — AC3 (per-tenant reset; B byte-identical).
4. `seed_credentials_atdd_test.go` — AC4 (`credentials.json` shape/roles/path; `.auth/` gitignored).
5. `seed_destructive_guard_atdd_test.go` — AC5 (positive-proof 3-gate, table-driven; not prod-shape detection).
6. `testmain_lifecycle_atdd_test.go` — AC6 (`classlite_test`, non-superuser migrate, schema migrated).

**Behavioral reds** (`//go:build atdd_red_phase_behavioral`, existing helpers only):
7. `seed_committed_isolation_behavioral_test.go` — AC2.
8. `rawpool_concurrency_behavioral_test.go` — AC7.

### Verification (observed, baseline 6a4eb4d, live container `classlite_new-postgres-1`)
| Check | Command | Result |
|---|---|---|
| Default build green (quarantine) | `go build ./... && go vet ./internal/test/` | ✅ exit 0 |
| Compile-fail reds RED | `go vet -tags=atdd_red_phase ./internal/test/` | 🔴 compile-fail on `internal/seed` (documented seam) |
| Behavioral reds compile | `go vet -tags=atdd_red_phase_behavioral ./internal/test/` | ✅ exit 0 |
| AC2 teeth RED | `go test -tags=atdd_red_phase_behavioral -run TestCommittedPath` | 🔴 `RunsAgainstDisposableDB` FAIL (`classlite_dev`); 🟢 `CrossTenantReadIsolation` PASS (lock) |
| AC7 teeth RED under -race | `go test -tags=atdd_red_phase_behavioral -race -run TestRawPoolConcurrency` | 🔴 `RunsAgainstDisposableDB` FAIL; 🟢 `NoCrossTenantLeakUnderParallelLoad` PASS (lock) |

**Honest teeth note:** cross-tenant RLS read isolation on the committed path already HOLDS today (null-guard `NULLIF(current_setting('app.current_tenant_id', true),'')::uuid` → unset denies all; B-scope sees only B). So those assertions are **green-from-day-one regression locks**, not teeth. The genuine R-11-5 teeth is the **disposable-DB** assertion (committed path on shared `classlite_dev` → RED; flips GREEN when AC6/DD16 provisions per-run `classlite_test`). `centers` is the tenant root (not `center_id`-scoped) — locks assert against `classes` (one of the five 8-4a tables).

### AC → red coverage
| AC | Risk | Red mechanism | Status |
|---|---|---|---|
| AC1 | R-11-4 (6) | compile-fail on `seed.Run/ContentHash/GoldenDigest/CenterAID` | 🔴 |
| AC2 | R-11-5 (6) | behavioral: disposable-DB teeth + committed-RLS lock | 🔴 teeth / 🟢 lock |
| AC3 | — | compile-fail on `seed.Reset` | 🔴 |
| AC4 | — | compile-fail (`seed.WriteCredentials`…) + lint-artifact-absent | 🔴 |
| AC5 | R-11-4 (6) | compile-fail on `seed.DestructiveReset` (3-gate table) | 🔴 |
| AC6 | R-11-5 (6) | compile-fail on `test.EnsureTestDB/TestDBName` | 🔴 |
| AC7 | R-11-5 (6) | behavioral `-race`: disposable-DB teeth + concurrency lock | 🔴 teeth / 🟢 lock |
| AC8 | — | compile-fail on `seed.SyntheticMarker/SyntheticEmailDomain` | 🔴 |

### Not generated as Go reds (documented, by design)
- **AC4 s-ID lint + `screens.yaml`** — the `.mjs` harness + manifest are dev green-work (Task 7/8). Red = artifact absent: `node scripts/screens-lint.mjs` → ENOENT. A full lint red belongs to the harness itself once scaffolded; not a Go test.
- **AC5 resource-budget doc** — prose in `docs/manual-setup.md` (Task 9); presence-checked at review, not a runtime red.

## Step 5 — Validation & Completion

### Validation (checklist.md)
- ✅ Prerequisites satisfied (story `ready-for-dev`, 8 BDD ACs, Go test config, live DB).
- ✅ 8 test files created correctly (compile verified under both tags).
- ✅ Checklist maps every AC to a red mechanism + risk.
- ✅ Red-phase scaffolds: compile-fail reds quarantined under `atdd_red_phase` (convention override of `test.skip()`, documented); behavioral reds observed RED.
- ✅ Story metadata + handoff paths captured in frontmatter; `### ATDD Artifacts` linked into the story Dev Notes.
- ✅ No orphaned CLI/browser sessions (backend; none launched).
- ✅ Temp artifacts under `_bmad-output/test-artifacts/` (no random locations).

### WF-8 hard-gate status
R-11-4 (6) + R-11-5 (6) red tests are **on the branch**. The gate to move 11-1a → `in-progress` is **satisfied**. The two behavioral teeth stay RED until AC6/DD16 provisions the disposable `classlite_test`; all compile-fail reds flip green as `internal/seed` + `test.EnsureTestDB/TestDBName/TestMain` land (remove each file's build tag per-seam).

### Assumptions / risks for dev
1. **Seed tenant IDs must equal `test.TenantAID/TenantBID`** — AC1 asserts it; a mismatch silently breaks AC2's deterministic tenants.
2. **Store-layer-only is asserted via empty `audit_logs`/`notifications`** — if the seed legitimately needs a row there, revisit DD1 rather than weakening the test.
3. **AC4 s-ID lint + screens.yaml** have no Go red (harness is green-work) — ensure the `.mjs` ships its own failing self-test (Task 8).
4. **`seed.RepoRoot(t)`** is a convenience seam the gitignore test pins; dev may instead relocate that assertion — fine, as long as `tests/e2e/.auth` gitignore coverage is proven.

### Next recommended workflow
`/bmad-dev-story 11-1a` (turn the reds green). Post-dev: `/bmad-tea TA` (expand P2/P3 + fixtures + DoD) then `/bmad-tea RV` (test-quality review). Epic boundary: `TR` → `NR` → `GATE`.
