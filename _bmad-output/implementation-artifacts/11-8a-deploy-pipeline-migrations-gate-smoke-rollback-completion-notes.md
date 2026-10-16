# Story 11-8a: Completion Notes

_Implementation record for [`11-8a-deploy-pipeline-migrations-gate-smoke-rollback.md`](./11-8a-deploy-pipeline-migrations-gate-smoke-rollback.md). Status: in-progress (code/test/docs complete + locally verified; live-ops drills blocked on Ducdo)._

## Dev Agent Record

### Debug Log
- `psql` is not on the host — ran `scripts/migrate-gate-test.sh` via a `docker exec` shim against `classlite_new-postgres-1` to genuinely exercise it (Phase A applied 84 migrations as `NOSUPERUSER BYPASSRLS`; Phase B caught the deliberate failure, exit non-zero). Clean run exits 0.
- SEC-7 negative control: a `SECURITY DEFINER` function runs as its OWNER, so "run the resolver without BYPASSRLS" can only mean a non-BYPASSRLS **owner**. Implemented as a byte-identical twin `ALTER FUNCTION … OWNER TO classlite_app` → returns NULL for the exact row the real resolver resolves. Isolates the owner's BYPASSRLS attribute as the single variable. The RLS policy's `NULLIF(current_setting('app.current_tenant_id', true), '')` returns 0 rows (not an error) with no GUC, so the twin cleanly yields NULL.
- `go build ./...`, `go vet ./internal/test/` clean; SEC-7 + existing polar resolution tests pass together (no helper-name collision).

### Completion Notes
**Shipped & verified locally (the WF-8 behavioral discharge + all pipeline code/docs):**
- **AC2 fail-closed proof** — `scripts/migrate-gate-test.sh` + `deploy.yml` `migrate-gate-test` job. Full-from-scratch-as-migrator exits 0; deliberately-failing migration exits non-zero. Ran green against docker Postgres.
- **AC5 SEC-7 teeth** — `internal/test/migrator_bypassrls_sec7_atdd_test.go` (3 tests, all green): positive cross-tenant resolution through a non-bypass caller / negative control (non-BYPASSRLS owner → NULL) / FORCE-RLS pg_class assert / receiver uses resolver center not spoofed metadata / `pg_roles`+`pg_proc.proowner` role invariant. Test-only pinning (DF-D) — the two immutable resolvers unchanged.
- **AC1/AC4 gate** — `deploy.yml`: `migrate-gate-test` → `migrate` (production Environment approval) → `gate-passed` (`needs:[migrate]`, single terminal context). `concurrency: deploy-main / cancel-in-progress:false`. golang-migrate v4.19.1 pinned. Runtime-assembled URL (never a static full-URL secret).
- **AC3 smoke + rollback** — `smoke.yml` (separate `deployment_status` workflow, non-gating): `/health` + protected-401 + authed-200. `rollback.sh` (auto on smoke failure) + `rollback-drill.sh` (version-oracle) + `railway-lib.sh`.
- **AC6 classlite_dev** — guarded `pg_database` check + `CREATE DATABASE` outside a tx in `deploy.yml` + `migrate-gate-test.sh`; CREATEDB reconcile documented.
- **AC7 rotation** — `rotate-app-password.sh` (idempotent, sentinel-guarded, safe literal quoting) + rotate-first→update-var runbook sequence; deliberately NOT in the recurring pipeline.
- **Docs** — `docs/deploy-runbook.md` (9 sections) + `docs/manual-setup.md` Deploy-Pipeline section; narrowed WF-8 exception recorded in `test-design-architecture.md`; `FU-11-DEPLOY` + `FU-11-1A-MIGRATOR-BYPASSRLS` closed in `deferred-work.md`.

**DEVIATIONS from the written spec (both sanctioned):**
1. **Standing TCP proxy instead of per-run `tcpProxyCreate/Delete`** — Dev Notes §Orchestration explicitly blesses this ("first check whether the Postgres service already exposes a standing proxy — if so, drop the per-run create/delete and the whole race"). Eliminates the race, the leaked-public-proxy fail-OPEN window, and the `if: always()` teardown. Per-run fallback documented in runbook §4. `sslmode=require` retained.
2. **Runbook written in full, not a skeleton** (Task 0 said skeleton) — net positive; the ops handoff needed the detail.

**BLOCKED on Ducdo's live Railway/prod access (the story's own §Secrets "Manual Ducdo steps" + the DoD drills):**
- DF-C pre-merge gate spike (AC4) — runbook §7.
- Enable Railway "Wait for CI"; create `production` Environment + reviewers; provision prod `classlite_migrator`; set secrets/vars; seed synthetic monitor account — runbook §2/§3.
- Exercise the rollback once (version-oracle + known-bad injection) — runbook §4; **validate Railway GraphQL field names** in `railway-lib.sh` during the spike.
- Rotate `classlite_app` prod password + update `DATABASE_URL` — runbook §6.
- DB restore drill (AC8) — runbook §8.

Because the DoD requires a green real-prod run, an exercised rollback, the restore drill, and the gate spike — all operator-only — the story stays **in-progress** rather than being falsely advanced to `review`.

### Implementation Plan (as executed)
1. Recon: read ci-api.yml, testdb.go, the two resolver migrations, create_app_role, health handler, billing_polar resolver chain, subscriptions/intents RLS, billing helpers.
2. Task 4 first (fully verifiable): wrote + ran the SEC-7 regression test green.
3. Task 2: wrote `migrate-gate-test.sh`, exercised it via a dockerized psql shim (red half + green half proven).
4. Tasks 1/3/5: authored `deploy.yml`, `smoke.yml`, `rollback*.sh`, `railway-lib.sh`, `rotate-app-password.sh`; syntax-validated (bash -n, yaml parse).
5. Task 0/7: runbook, manual-setup section, WF-8 narrowing note, deferred-work closures.
6. Verified Go build/vet + combined test run; updated story Tasks honestly.

## File List

### Added
- `.github/workflows/deploy.yml` — gated migrate pipeline (fail-closed test → migrate gate → gate-passed).
- `.github/workflows/smoke.yml` — separate post-cutover smoke + auto-rollback.
- `scripts/migrate-gate-test.sh` — AC2 fail-closed proof (throwaway DB).
- `scripts/railway-lib.sh` — shared Railway GraphQL helpers (rollback/drill).
- `scripts/rollback.sh` — auto-rollback on smoke failure.
- `scripts/rollback-drill.sh` — re-runnable version-oracle rollback proof.
- `scripts/rotate-app-password.sh` — one-time guarded `classlite_app` password rotation (AC7).
- `classlite-api/internal/test/migrator_bypassrls_sec7_atdd_test.go` — AC5 SEC-7 regression with teeth.
- `docs/deploy-runbook.md` — the operational runbook.
- `_bmad-output/implementation-artifacts/11-8a-…-completion-notes.md` — this file.

### Modified
- `docs/manual-setup.md` — new "Deploy Pipeline (11-8a)" section + prereq boxes; Railway section note.
- `_bmad-output/implementation-artifacts/deferred-work.md` — closed FU-11-DEPLOY + FU-11-1A-MIGRATOR-BYPASSRLS (residuals noted).
- `_bmad-output/test-artifacts/test-design/test-design-architecture.md` — narrowed the 11-8a WF-8 exception to declarative-YAML-only; listed the required behavioral tests.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-8a ready-for-dev → in-progress.
- `_bmad-output/implementation-artifacts/11-8a-…-rollback.md` — Tasks checkboxes (honest), Change Log, baseline_commit preserved.

### Deleted
- none.
