# Story 11-1a: Completion Notes

_Implementation record for [`11-1a-seed-fixtures-and-test-tenant-isolation.md`](./11-1a-seed-fixtures-and-test-tenant-isolation.md). Status: review. Baseline 6a4eb4d._

## Dev Agent Record

### Debug Log

- **AC6 de-risked first.** Proved the full 83-migration chain applies as a NON-superuser `classlite_migrator` (NOSUPERUSER CREATEROLE) against a fresh `classlite_test` before wiring any Go. The migrator owns the test DBs (full DDL incl. CREATE EXTENSION for trusted `pg_trgm`/`unaccent`); the superuser bootstrap is confined to CREATE ROLE/DATABASE. The immutable `GRANT CONNECT ON DATABASE classlite_dev` (20260601110000) replays clean because the bootstrap creates a throwaway `classlite_dev` and grants the migrator `CONNECT … WITH GRANT OPTION` on it (DD16d, no ownership hijack).
- **Two red-phase ATDD queries did not match the real schema** (project-context's idealized names, as the story warned). Reconciled at green: table is `attendance` not `attendance_records`; `current_grades` has `center_id` + `submission_id` but NO `student_id` (it's a view over `grades`). Fixed the AC1 coverage + AC8 confession queries.
- **Determinism oracle uses raw parametrized INSERTs, not the generated store writers.** The sqlc writers mint `gen_random_uuid()` PKs for assignments/submissions/grades/attendance/files and cannot insert a `graded` submission directly — both incompatible with the content-hash determinism oracle (DD14). Decision: raw parametrized `INSERT … ON CONFLICT DO NOTHING` with DETERMINISTIC UUIDs inside the tenant-scoped tx. Still store-layer in spirit (no service orchestration — proven by `TestSeed_StoreLayerOnly` asserting audit_logs/notifications stay empty, DD1).
- **Coverage counts hit RLS.** Seeded rows are committed but a context-less app connection sees zero under the RLS null-guard; the coverage/confession assertions read through `SuperuserPool` (existence assertions, not RLS checks).
- **Committed seed data collided with the RLS fixtures.** The seed commits the fixture tenant ids (`TenantAID/BID`, AC1 requires this); ~all RLS adversarial tests create centers with those same ids in rollback txs → `centers_pkey` duplicate. Fix (the AC7 discipline applied to the seed tests): `TestMain` clears both seed tenants at suite start, and every committing seed test registers `cleanupSeedTenants` teardown. The two behavioral tests reconciled to the seeded surface (positive controls `>=1` not `==1`; residue check scoped to the worker `SEED_FAKE_W%` centers, not the seeded `SEED_FAKE_Center A/B`).
- **The headline finding — a real latent prod bug DD16b surfaced.** With the full suite finally running on `classlite_test`, two Epic-9 confused-deputy tests (`TestPolarTenantResolution_ConfusedDeputy`, `TestGrace_PaymentFailed_ResolvesByBoundSubscription_NotMetadata`) FAILED on `classlite_test` but PASS on `classlite_dev`, identical schema. Root cause: the polar tenant-resolution functions are `SECURITY DEFINER` and must resolve a webhook event to a center ACROSS tenants; they silently relied on their OWNER (the migration role) being a superuser to bypass RLS. Migrating as a plain non-superuser makes the migrator the owner WITHOUT RLS bypass → cross-tenant lookup returns nothing → resolution falls back to the SPOOFABLE `metadata.center_id` → a confused-deputy (SEC-7) leak that would detonate only in a non-superuser prod. Fix: grant the migrator `BYPASSRLS` (NOT superuser). Filed **FU-11-1A-MIGRATOR-BYPASSRLS** — 11-8a's prod migration role must also be BYPASSRLS (or the two resolvers made RLS-independent).

### Completion Notes

All 8 ACs are green on a disposable `classlite_test`, and the FULL `go test ./... -race` passes on that DB (every package). Build / vet / gofmt clean; s-ID lint green (89 ids, bidirectional); no `api.yaml` or `.sql` query diff → no `codegen.sh` (WF-3). The only migration is the new DB-agnostic role-grant pair (WF-2, never edited 20260601110000).

- **AC1** — `internal/seed` builds two deterministic tenants × {owner,admin,teacher,2 students} × Epics 1–8 (centers, members, classes active+ended, a session, enrollments, 4-skill exercises, 4 assignments, 4 submissions across all 4 attempt statuses, a released grade, attendance, a file). Content-hash + committed golden digest (`GoldenDigest`), excluding bcrypt/timestamps. Store-layer-only (audit/notifications empty). No live R2/Gemini.
- **AC2** — committed-path + tx-path cross-tenant isolation over the 8-4a tables (classes = the center_id-scoped stand-in; `centers` is the tenant root), both directions, positive controls; the behavioral red (disposable-DB teeth) is now GREEN.
- **AC3** — `seed.Reset(centerID)` superuser cascade; B byte-identical after `reset(A)`.
- **AC4** — `WriteCredentials` → `classlite-web/tests/e2e/.auth/credentials.json` (gitignored); `docs/product/screens.yaml` (89 entries); `scripts/screens-lint.mjs` + `.github/workflows/screens-lint.yml` (repo-wide triggers, bidirectional, shape/enum, never rewrites story files).
- **AC5** — `## Local resource budget` in `docs/manual-setup.md`; `DestructiveReset` fails closed unless all three positive proofs hold (db-name allowlist + sentinel object + opt-in).
- **AC6** — `TestMain`/`EnsureTestDB` own the disposable `classlite_test` lifecycle, migrate as the non-superuser (BYPASSRLS) migrator, resolve the immutable-GRANT replay; `ci-api.yml` bootstraps+migrates for the whole suite; `SetupDB` rollback untouched.
- **AC7** — inventory + classification in [`11-1a-rawpool-inventory.md`](./11-1a-rawpool-inventory.md); the disposable DB is the structural R-11-5 fix; multi-connection `-race` concurrency test green. **DD4 interpretation flagged for review:** a literal per-site rewrite of all 148 committing call sites was NOT performed (it cannot move the genuine-concurrency/service-owns-tx classes and adds no R-11-5 value over the disposable DB).
- **AC8** — in-data `SEED_FAKE_` marker on grade feedback + synthetic identifiers; students are non-natural-person (`@example.test`, "… Fixture …" names).

Deferrals: **FU-11-1A-STALENESS** (git-log detector → 11-3b), **FU-11-1A-MIGRATOR-BYPASSRLS** (prod role → 11-8a). FU-11-1A-RAWPOOL is NOT filed — it is AC7, in-scope.

**R-11-5 honest trace:** the data-layer + committed-path + concurrency-race isolation is retired HERE; the Playwright per-worker RUNTIME wiring is 11-2/11-5a. NOT marked fully closed at this gate (John d).

### Implementation Plan (as executed)

1. Recon (2 parallel agents): full DB schema/store map + raw-pool helper inventory. Read the 8 red-phase ATDD files for the exact green SEAMS.
2. De-risk AC6 against the live container (migrator role → migrate full chain as non-superuser → app role connects).
3. New role-grant migration pair (WF-2).
4. `internal/seed`: seed/dataset/hash/reset/credentials/sentinel. `cmd/seed`. `scripts/seed.sh` wrapper. `.gitignore`.
5. `internal/test`: `testdb.go` (EnsureTestDB) + `testmain_test.go` (TestMain) + `seed_cleanup_test.go`.
6. Converted the 8 red tests to green (dropped build tags, reconciled 2 schema mismatches, added seed-test teardown, reconciled 2 behavioral assertions to the seeded surface).
7. Sealed `GoldenDigest`; iterated reset FK order (center_members not cascade) and the coverage RLS read.
8. Diagnosed + fixed the SECURITY DEFINER / BYPASSRLS confused-deputy regression.
9. `screens.yaml` (generator) + s-ID lint + workflow; resource budget; CI migrate step; FUs; R-11-5 register update.
10. Gates: full `go test ./... -race` on `classlite_test` (all green, twice), build/vet/gofmt, s-ID lint, no codegen.

## File List

### Added
- `classlite-api/cmd/seed/main.go` — Go seed entry point (clean/upsert/destructive).
- `classlite-api/internal/seed/seed.go` — Run + tenant-tx orchestration + constants.
- `classlite-api/internal/seed/dataset.go` — the Epics 1–8 deterministic builder.
- `classlite-api/internal/seed/hash.go` — ContentHash + GoldenDigest.
- `classlite-api/internal/seed/reset.go` — per-tenant Reset + positive-proof DestructiveReset.
- `classlite-api/internal/seed/credentials.go` — WriteCredentials + CredentialsEntry + RepoRoot/FindRepoRoot.
- `classlite-api/internal/seed/sentinel.go` — disposable-DB sentinel helpers (DD13 proof #2).
- `classlite-api/internal/test/testdb.go` — EnsureTestDB + bootstrap + clearSeedTenants + migrateUp.
- `classlite-api/internal/test/testmain_test.go` — TestMain (ensure + clear + m.Run).
- `classlite-api/internal/test/seed_cleanup_test.go` — cleanupSeedTenants teardown helper.
- `classlite-api/migrations/20261012120000_grant_connect_current_database.{up,down}.sql` — DB-agnostic CONNECT grant (WF-2).
- `docs/product/screens.yaml` — 89-entry screen manifest (provenance ratchet).
- `scripts/screens-lint.mjs` — repo-level s-ID lint (no deps).
- `.github/workflows/screens-lint.yml` — own workflow, repo-wide triggers.
- `_bmad-output/implementation-artifacts/11-1a-rawpool-inventory.md` — AC7 inventory/classification.
- `_bmad-output/implementation-artifacts/11-1a-seed-fixtures-and-test-tenant-isolation-completion-notes.md` — this file.

### Modified
- `scripts/seed.sh` — 23-line stub → thin `go run ./cmd/seed` wrapper (DD1).
- `.gitignore` — ignore `classlite-web/tests/e2e/.auth/` + `tests/e2e/.auth/` (DD3).
- `docs/manual-setup.md` — `## Local resource budget` section (AC5/DD10).
- `.github/workflows/ci-api.yml` — bootstrap+migrate test-DB step + classlite_test test env (AC6).
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-11-1A-STALENESS / -MIGRATOR-BYPASSRLS + RAWPOOL-in-scope note.
- `_bmad-output/test-artifacts/test-design/test-design-architecture.md` — R-11-5 mitigation reworded to the honest disposable-DB + classification posture.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-1a ready-for-dev → in-progress → review.
- `classlite-api/internal/test/seed_determinism_atdd_test.go` — dropped tag; schema reconcile; superuser coverage reads; mustPgUUID; teardown.
- `classlite-api/internal/test/seed_synthetic_confession_atdd_test.go` — dropped tag; seed import; grade-query reconcile; teardown.
- `classlite-api/internal/test/seed_reset_atdd_test.go` — dropped tag; mustPgUUID; teardown.
- `classlite-api/internal/test/seed_credentials_atdd_test.go` — dropped tag; teardown.
- `classlite-api/internal/test/seed_destructive_guard_atdd_test.go` — dropped tag.
- `classlite-api/internal/test/testmain_lifecycle_atdd_test.go` — dropped tag.
- `classlite-api/internal/test/seed_committed_isolation_behavioral_test.go` — dropped tag; positive controls `>=1`.
- `classlite-api/internal/test/rawpool_concurrency_behavioral_test.go` — dropped tag; residue scoped to `SEED_FAKE_W%`.

### Deleted
- none.
