# Story 11.8a: Deploy Pipeline — Migrations, Gate, Smoke, Rollback

Status: in-progress

<!--
baseline_commit: d77a493
epic: 11 (Exposure / launch — Wave A)
story_key: 11-8a-deploy-pipeline-migrations-gate-smoke-rollback
size: M
dependencies: none
priority: P0 (FU-11-DEPLOY — "the only story that can put v2 on the internet")
wf8: TRIPPED (≥6) — DOCUMENTED INFRA EXCEPTION to the red-phase ATDD mandate (see Dev Notes §WF-8).
-->

## Story

As the **team**,
I want the **deploy pipeline to apply migrations as a dedicated privileged CI step, refuse to ship on any failure, gate production behind an explicit approval, smoke-check what it shipped, and have a rollback that has actually been exercised**,
so that **a real deploy can never put an un-migrated schema or a broken image in front of users, and the one story that "is launch" is safe to run.**

## Context — what already exists (read this first)

The v2 infrastructure was **stood up manually on 2026-10-15** (the environment half of this story). This story automates the **gated pipeline**; it does NOT re-provision. Current live state:

- **Railway** project `classlite` (prod env): `classlite-api` (git-connected `andukdahacker/classlite_new`@`main`, Docker build, `/health` healthcheck) + managed `Postgres` (private `postgres.railway.internal`, db `railway`). API is **live & healthy**.
- **Migrations were applied once, by hand**, through a temporary Railway TCP proxy → the prod `railway` DB is already at version `20261012120000` (47 tables). So the pipeline's first automated `migrate up` is a **no-op/idempotent** run — correct, and a safe first exercise.
- **Dockerfile build is already self-contained** (commit `f82f3d3`): `sqlc generate` runs in the builder (the sqlc output is gitignored). **Do not** re-solve the build.
- **Cloudflare Pages** `classlite-web` (`my.classlite.app`) + `classlite-landing` (`classlite.app`) are **git-auto-deployed** on push today; **R2** wired; DNS done.
- There is **no `deploy.yml`** (the `ci-web.yml` comments reference one that was never created). CI gates (`ci-api.yml`, `ci-web.yml`, `ci-landing.yml`) are test/lint only — no deploy, no migrate, no gate/smoke/rollback.

## Acceptance Criteria (BDD)

Epic ACs (`epic-11.md` §Story 11-8a) are **AC1–AC4**, verbatim intent. **AC5–AC8** fold in rulings this story owns (AC5 SEC-7, AC6 replay-landmine, AC7 password, AC8 restore-drill).

**AC1 — migrations run as a dedicated privileged migrator credential, in CI, never on boot**
**Given** ~170 migrations and the prod `railway` database
**When** the pipeline runs
**Then** `migrate up` runs as a **dedicated privileged migrator credential in a CI step** (a `MIGRATION_DATABASE_URL`-style secret), **not** as `classlite_app` and **not** on API boot
**And** DDL privilege never resides in the long-running app process (preserving the RLS property the 228-file Go suite protects).

**AC2 — fail-closed on migration failure (+ red-phase proof — DF-B RULED)**
**Given** a migration that exits non-zero
**When** the pipeline runs
**Then** the deploy **aborts fail-closed** and **no new image receives a production traffic cutover** — migrate is the gate on the **cutover**, NOT on the image **build** (Railway builds the pushed commit in parallel with CI; the build is side-effect-free; see §Orchestration — do not describe migrate as a "predecessor of the build")
**And** this fail-closed behavior is **proven by a red-phase CI test** (NOT discharged by the WF-8 doc-exception — Murat score-9): a throwaway-DB job applies the full migration set from scratch **as the migrator role** (exercises real DDL under the real privilege, not the idempotent no-op prod run), plus a **deliberately-failing migration** asserting `migrate` exits non-zero **and** that the downstream cutover/smoke is never marked eligible. This is the seam the infra-exception explicitly does NOT cover.

**AC3 — post-deploy smoke + an exercised rollback (strengthened — DF-B RULED)**
**Given** a successful deploy
**Then** a **post-deploy smoke check** runs against `/health` (expects `200 {"status":"ok","db":"connected"}`) **and** two authenticated-route signals: (i) a protected route with no token → `401` (auth-routing live), **and (ii) an authenticated `200`** against a cheap seeded read endpoint asserting payload shape — the `200` is required because a dead-DB/broken app *also* returns `401`, and because it is the **only** check that exercises the app's real `classlite_app` connection and thus catches AC7's password rotation breaking it (Murat: `/health`'s `db:connected` may ping a different role)
**And** the smoke runs in a **SEPARATE workflow triggered on Railway `deployment_status`** (post-cutover), reporting a **non-gating** check — it must NOT live in the gated check-suite (that deadlocks)
**And** a **documented rollback path exists and has been exercised once** against the real Railway service, proving **traffic actually reverted** (not just that the API call ran): capture the serving build-id → rollback → assert serving build-id == the prior deployment AND `/health` 200 from it; and a **known-bad injection** (deploy a smoke-failing image → assert auto-rollback fires AND live traffic never served the bad image). Script it re-runnably (don't let "once" rot)
**And** it is recorded as an explicit constraint that **`migrate up` runs while the OLD image is still serving** and **rollback reverts the IMAGE only (no `migrate down`)** → migrations MUST be **expand/contract backward-compatible**; a destructive migration breaks prod *during* the migrate step and rollback cannot restore dropped data (data-loss coverage → **AC8**).

**AC4 — explicit production gate, enforced via Railway "Wait for CI" (F1 RULED)**
**Given** `main` goes green
**When** a production deploy would fire
**Then** Railway's **"Wait for CI"** is enabled for `classlite-api`, so Railway deploys **only after** the commit's GitHub check suite concludes green — and that check suite includes the **privileged `migrate` gate (AC1/AC2)** and a **GitHub `production` Environment required-reviewer approval** on that job
**And** therefore a red migrate check **or** an un-approved deploy leaves the check pending/failed → **Railway never ships the image** (the required-reviewer approval is the explicit gate; "Wait for CI" is the enforcement — see Dev Notes §Orchestration)
**And** (DF-C RULED) the pipeline exposes a **single terminal `gate-passed` check context** (`needs: [migrate]`, runs only after approval+migrate-green) and Railway keys on that one context — so there is always exactly one check that stays pending until migrate-AND-approval complete (never "whole suite green" ambiguity)
**And** (DF-C RULED, DoD item) a **pre-merge spike proves the two load-bearing Railway behaviors**: that "Wait for CI" actually waits on GitHub **check-runs** (Actions API, not just legacy commit-status) AND that a **pending-approval** job blocks cutover — because if either is false the gate fails **OPEN**. The spike result is recorded before this story can close.

**AC5 — SEC-7 confused-deputy closed (FU-11-1A-MIGRATOR-BYPASSRLS)**
**Given** the two Epic-9 `SECURITY DEFINER` resolvers `polar_center_by_subscription_id` / `polar_center_by_checkout_id` (migrations `20260930120600`/`700`) that must read FORCE-RLS tables across tenants with no tenant GUC
**When** migrations are owned by the prod (non-superuser) migrator role
**Then** the privilege model is made correct **and proven by a regression test** that runs the resolvers **as the actual prod migrator role (not a superuser)** and asserts they return the right `center_id` cross-tenant — closing the "the only thing stopping the leak is remembering to grant BYPASSRLS" gap
**And** the test has **teeth (DF-B RULED)**: (i) a **negative control** — the *same* resolvers run as a role *without* BYPASSRLS → assert `NULL`/0 rows (proves BYPASSRLS is the *cause*, not an accident, and that FORCE RLS is actually on); (ii) a **receiver-fallback test** — the spoofable `metadata.center_id` path still *exists*, so assert that when the resolver returns a real `center_id` the webhook receiver uses it and does NOT consult `metadata.center_id` (and ideally: a spoofed metadata center that *disagrees* is ignored); (iii) a **`pg_roles` attribute assertion** on the *actually-provisioned prod* migrator (`rolsuper=false`, `rolbypassrls=true`), not just the test fixture — catches prod drift / a later SUPERUSER re-grant
**And** (DF-D RULED) AC5 is **test-only pinning + role-privilege provisioning** — it does **NOT change the behavior** of the two immutable `SECURITY DEFINER` resolvers; no new/edited resolver migration rides this P0 story (the RLS-redesign alt stays rejected, F2)
**And** the chosen mechanism is recorded: prod migrator role is `NOSUPERUSER` **`BYPASSRLS`**, mirroring CI's `classlite_migrator`.

**AC6 — the `classlite_dev` replay landmine is handled in the migrate step**
**Given** the immutable migration `20260601110000` hardcodes `GRANT CONNECT ON DATABASE classlite_dev`
**When** the migrate step runs against the prod DB named `railway`
**Then** the step **ensures a throwaway `classlite_dev` database exists first** so the immutable GRANT replays clean — exactly as CI's bootstrap and the manual 2026-10-15 run did
**And** the implementation respects two Postgres facts: there is **no `CREATE DATABASE IF NOT EXISTS`** (guard with `SELECT 1 FROM pg_database WHERE datname='classlite_dev'` or catch-duplicate), and **`CREATE DATABASE` cannot run inside a transaction block** (run it as its own statement, separate from the migration tx)
**And** the role doing the create has `CREATEDB` — reconcile with AC5: a `NOSUPERUSER BYPASSRLS` migrator does **not** confer `CREATEDB`, so **either grant the prod migrator `CREATEDB`** (does not breach NOSUPERUSER) **or create `classlite_dev` out-of-band once** as the Railway bootstrap superuser (then this step only verifies existence)
**And** this is captured as a documented, intentional step (not silent).

**AC7 — `classlite_app` prod password is not the dev default**
**Given** `20260601110000` creates `classlite_app` with the hardcoded literal `classlite_dev_password`
**When** the app connects in prod
**Then** the prod `classlite_app` password is **rotated off the dev default** via a privileged `ALTER ROLE` step driven by a secret (NOT a new committed literal), and `DATABASE_URL` on Railway is updated to match
**And** the sequence is **rotate first (`ALTER ROLE … PASSWORD`) → then update the Railway `DATABASE_URL` var** (existing pooled connections survive a password change; only *new* connections with the stale password fail — keep the gap minimal; document the order in the runbook)
**And** the step is **idempotent / guarded** (it lives in a per-push workflow but must be a one-time rotation — skip if already rotated; do NOT churn `ALTER ROLE` on every deploy)
**And** it is acknowledged that **updating the Railway `DATABASE_URL` var itself triggers a Railway redeploy** (a deploy outside the gated path) — do the rotation as a **deliberate one-time operational action** (sequenced with a cutover, documented in the runbook), never silently inside the recurring pipeline; that redeploy serves the same already-migrated schema so it is safe under the expand/contract rule (AC3)
**And** the new `classlite_app` password secret is named + stored (enumerated in §Secrets).

**AC8 — a database restore has been exercised once (DF-A RULED — data-loss coverage)**
**Given** rollback (AC3) reverts the image only and cannot restore data a successful-but-destructive migration dropped — the single worst-case that hurts a paying customer on the first real deploy (John)
**When** this story closes
**Then** Railway Postgres **backups are enabled AND a restore has been performed once** into a throwaway target, with the data verified to come back (mirrors "rollback exercised once" — converts "we believe we have backups" into "we restored one and watched it work")
**And** this is the *drill*, not the full automated backup/restore gate (that stays **11-8b**); the runbook documents the restore procedure
**And** the expand/contract-migration constraint (AC3) is restated as the standing rule that keeps destructive migrations out of the gap this drill backstops.

## Tasks / Subtasks

> **CODE/TEST/DOCS = DONE & locally verified (2026-10-15, Amelia). LIVE-OPS = BLOCKED on Ducdo's
> Railway/prod access** (marked `[ ] ⧖OPS`). The WF-8 behavioral discharge (AC2 fail-closed proof,
> AC5 SEC-7 teeth) is green locally; the AC3 exercised rollback, AC8 restore drill, and AC4 gate
> spike are operational drills only Ducdo can run — full handoff in `docs/deploy-runbook.md`.

- [x] **Task 0 — narrowed WF-8 exception + runbook skeleton** (AC1–AC4)
  - [x] Record the WF-8 exception **narrowed to declarative YAML only** (§WF-8) in completion notes + `test-design-architecture.md`:242; behavioral tests NOT exempt (AC2/AC3/AC5) listed there.
  - [x] Draft `docs/deploy-runbook.md` (rollback + gate approval + smoke + restore-drill + break-glass) — written in full, not just a skeleton.
- [ ] **Task 1 — `deploy.yml` migrate gate + terminal `gate-passed` check** (AC1, AC2, AC4)
  - [x] New `.github/workflows/deploy.yml` on push to `main`, `concurrency: { group: deploy-main, cancel-in-progress: false }`: `migrate` job = `golang-migrate` **v4.19.1** (pinned), **runtime-assembled** URL from the migrator secret + proxy host:port, ensure `classlite_dev` (AC6), `migrate up`; non-zero → red. **DEVIATION (sanctioned by Dev Notes §Orchestration "first check for a standing proxy"):** uses the **standing** Railway Postgres TCP proxy (secrets `RAILWAY_PG_PROXY_HOST/PORT`) not per-run `tcpProxyCreate/Delete` — no race, no leaked-proxy fail-OPEN, so the `if: always()` teardown is N/A. `sslmode=require` kept. Per-run-proxy fallback documented in runbook.
  - [x] Bind `migrate` to the GitHub **`production` Environment** (required reviewers) = AC4 gate; terminal **`gate-passed`** job `needs: [migrate]` added (DF-C).
  - [ ] ⧖OPS **DF-C spike (DoD):** prove Railway "Wait for CI" waits on Actions **check-runs** AND a **pending-approval** job blocks cutover. Checklist + evidence slots: runbook §7.
  - [x] Manual prereqs (§Secrets) **DONE 2026-10-16 (Ducdo+Amelia, verified live):** standing Postgres TCP proxy `ballast.proxy.rlwy.net:22354` + `RAILWAY_PG_PROXY_*` secrets; Railway "Wait for CI" ON (`checkSuites:true`); GitHub `production` Environment + required reviewer `andukdahacker`; prod `classlite_migrator` provisioned (see Task 4).
- [x] **Task 2 — fail-closed red-phase test** (AC2, DF-B — Murat score-9)
  - [x] `scripts/migrate-gate-test.sh` + the `migrate-gate-test` job in `deploy.yml` (throwaway DB): full set **from scratch as the migrator role** exits 0 (real DDL under real privilege) + a **deliberately-failing migration** makes `migrate` exit non-zero → script non-zero = CI job fails = downstream `needs:` never eligible. **Verified locally green** against the docker Postgres (84 migrations applied as `NOSUPERUSER BYPASSRLS`; bad migration caught).
- [ ] **Task 3 — smoke (separate workflow) + proven rollback** (AC3)
  - [x] **Separate** `.github/workflows/smoke.yml` on `deployment_status` (non-gating): `/health` 200+`db:connected`, protected-no-token → `401`, **AND an authenticated `200`** (login synthetic monitor → cheap read → 200 + `{data}` envelope — the only check exercising the real `classlite_app` conn / catching AC7).
  - [x] Rollback **scripted re-runnably** (`scripts/rollback.sh` auto-rollback on smoke failure; `scripts/rollback-drill.sh` version-oracle proof; `scripts/railway-lib.sh` shared GraphQL). Serving-build-id oracle + known-bad-injection procedure in runbook §4.
  - [ ] ⧖OPS **Exercise the rollback once** against the real Railway service (version-oracle PASS + known-bad injection); paste evidence into runbook §4. ⚠ Railway GraphQL field names need live validation (runbook §4 note).
- [x] **Task 4 — SEC-7 migrator privilege + regression test with teeth** (AC5) — Go test green + prod migrator provisioned & verified (2026-10-16)
  - [x] ⧖OPS Provision the prod migrator **DONE 2026-10-16 (verified live):** `classlite_migrator` `NOSUPERUSER CREATEDB BYPASSRLS` created, public-schema app objects (46 tables + schema_migrations + sequences/views + all 7 SECURITY DEFINER fns) re-owned postgres→migrator; prod drift check green — `rolsuper/bypassrls = f/t`, both polar resolvers owned by `classlite_migrator`, 0 public tables left on `postgres`. `MIGRATION_DB_*` secrets set. (Provisioned via `scratchpad/provision-migrator.sh`, transaction-wrapped.)
  - [x] Go test `internal/test/migrator_bypassrls_sec7_atdd_test.go` (reuses `testdb.go`): resolvers return correct cross-tenant `center_id` through a non-bypass caller, no GUC (positive); **negative control** = byte-identical twin owned by a non-BYPASSRLS role → NULL; **FORCE RLS** asserted on both tables; **receiver-fallback** (resolver center used, disagreeing `metadata.center_id` ignored); **`pg_roles`/`pg_proc.proowner`** assert migrator is `NOSUPERUSER BYPASSRLS` and owns both resolvers. **Verified green.** Test-only — no resolver behavior change (DF-D).
- [x] **Task 5 — `classlite_dev` throwaway + `classlite_app` password rotation** (AC6, AC7) — code + prod rotation done & `/health`-verified (2026-10-16)
  - [x] `classlite_dev` handled in `deploy.yml` migrate job + `migrate-gate-test.sh`: `pg_database` guard (no `IF NOT EXISTS`), `CREATE DATABASE` outside a tx, migrator needs `CREATEDB` (or out-of-band once — runbook §3).
  - [x] `scripts/rotate-app-password.sh` — one-time **guarded/idempotent** `ALTER ROLE classlite_app PASSWORD` (COMMENT-ON-ROLE sentinel; `:'var'` safe literal); rotate-first→update-var sequence in runbook §6.
  - [x] ⧖OPS **DONE 2026-10-16 (verified live):** rotated `classlite_app` off the dev default (`ALTER ROLE` via superuser) + updated Railway `DATABASE_URL` (triggered a same-schema redeploy); `/health` returned `db:connected` on the new password after ~10s (real `classlite_app` path confirmed). `NEW_APP_PASSWORD` secret stored. (Via `scratchpad/rotate-app-password.sh`.)
- [ ] **Task 6 — DB restore drill** (AC8, DF-A)
  - [x] Procedure documented (runbook §8 + `manual-setup.md`): expand/contract standing rule restated; full automated gate stays 11-8b.
  - [ ] ⧖OPS Enable Railway Postgres backups; perform **one restore** into a throwaway target; verify data returns; paste evidence into runbook §8.
- [x] **Task 7 — docs + close-out**
  - [x] `docs/manual-setup.md` — new "Deploy Pipeline (11-8a)" section with §Secrets + manual prereqs + Prod/Staging boxes (`classlite_dev` already `[x]`, rest `[ ]` pending ops); runbook finished.
  - [x] Closed `FU-11-DEPLOY` + `FU-11-1A-MIGRATOR-BYPASSRLS` in `deferred-work.md` with residuals noted.

## Dev Notes

### §Orchestration — Railway "Wait for CI" gates the CUTOVER (F1 RULED)
Railway has **no release phase**, but it DOES have a **"Wait for CI"** setting: enabled, Railway **still triggers the deploy from the push and builds the image in parallel with CI**, then holds the **traffic cutover** until the commit's GitHub check suite concludes green. So **Wait for CI is a modifier on top of auto-deploy-on-push, NOT a replacement** — auto-deploy stays ON; **`deploy.yml` does NOT trigger the image deploy**, it owns only migrate + (separately) smoke/rollback. The app connects as `classlite_app` and never migrates at boot, so an un-migrated image = schema mismatch; Wait for CI prevents the *cutover* to that image until the privileged migrate check is green. Design:
- New `deploy.yml` on push to `main` with a **`migrate` job**: golang-migrate v4.19.1, ensure throwaway `classlite_dev` (AC6), `migrate up` over a runtime-assembled URL (below), red check on non-zero (AC2).
- The `migrate` job is bound to a GitHub **`production` Environment with required reviewers** → the run stays `in_progress` (job `waiting` on approval) → the check-suite does not conclude → Railway holds cutover = the AC4 gate. Approve → migrate runs → green → Railway cuts over. Red or un-approved → no cutover (fail-closed).
- **Add a `concurrency: { group: deploy-main, cancel-in-progress: false }`** to the workflow — MUST be `false`; cancelling a job mid-`migrate` or mid-proxy-teardown risks a half-applied schema or a leaked public proxy. (Two-pushes-racing edge cases beyond this — e.g. approving an older commit after a newer one — are noted under DF-C.)
- **Smoke is a SEPARATE workflow** on `deployment_status` (post-cutover), non-gating (AC3) — never in the gated suite (deadlock).
- Railway's `/health` healthcheck is the **native traffic gate**: Railway won't cut traffic to a new deployment until `/health` passes and keeps the prior deployment serving if it fails — built-in smoke + rollback-safety. AC3 layers an explicit authed-route smoke + an exercised manual rollback on top.
- **TCP proxy to reach Postgres** (the migrate job runs on a GitHub runner; `postgres.railway.internal` is unreachable). F4 default = per-run `tcpProxyCreate`/`tcpProxyDelete` (host like `yamabiko.proxy.rlwy.net:PORT`). HARD REQUIREMENTS (not forks): **(a)** pin `sslmode=require` minimum — prod Postgres is briefly public with plaintext creds behind a `BYPASSRLS` role; **(b)** teardown MUST be `if: always()` (a crash between create/delete leaves prod DB publicly reachable = fail-OPEN on the security boundary); **(c)** the proxy host:port is **dynamic**, so `MIGRATION_DATABASE_URL` CANNOT be a static full-URL secret — the secret carries creds+dbname and the URL is assembled at runtime from the proxy response. **First check** whether the Postgres service already exposes a standing proxy (`RAILWAY_TCP_PROXY_DOMAIN/PORT`) — if so, drop the per-run create/delete and the whole race. Railway API: `backboard.railway.com/graphql/v2` + account token.

### §Smoke — authenticated route without prod test creds
`/health` already returns `200 {"status":"ok","db":"connected"}` (`internal/handler/health_handler.go`). For "one authenticated route" without planting prod users, default to asserting a **protected route returns `401` with no token** (proves `ExtractTenant`/auth routing is live end-to-end). A fuller synthetic-monitor login is a Forks §F3 option.

### §SEC-7 (read the two migrations) — `classlite-api/migrations/20260930120600`/`700`
Both resolvers are `LANGUAGE sql SECURITY DEFINER STABLE` selecting a lone `center_id` from a FORCE-RLS table (`subscriptions` / `billing_checkout_intents`) with no tenant GUC. SECURITY DEFINER runs as the function **owner** = the migration role. Superuser owner → bypasses RLS (works). Plain non-superuser owner → RLS applies → `0 rows` → `NULL` → the webhook receiver falls back to the **spoofable `metadata.center_id`** = the confused-deputy leak (SEC-7). Note FORCE RLS means even the table *owner* is not exempt, and a non-privileged `SET row_security=off` errors — so `BYPASSRLS` on the owner is the practical lever (default). The deeper "RLS-independent resolver" terminal fix is architecturally preferred in `deferred-work.md:1384` but is constrained by FORCE RLS — carried as Forks §F2, not assumed.

### §WF-8 infra exception — NARROWED to declarative YAML only (DF-B RULED)
`11-8a` trips the ≥6 gate. The infra exception to the red-phase ATDD mandate (`sprint-status.yaml:459`) applies **ONLY to the declarative pipeline wiring** that genuinely has no testable seam — the Railway "Wait for CI" toggle, the `production` Environment binding, the `needs:`/`deployment_status` graph. It does **NOT** cover the behavioral seams, which are red-able and are now **required as tests**: the **fail-closed migrate gate (AC2** — Murat scored this risk **9**; a 9 with a real seam cannot be discharged by documentation), the **SEC-7 regression with negative control + receiver-fallback + `pg_roles` (AC5)**, the **authenticated-200 smoke (AC3)**, and the **version-oracle/known-bad rollback (AC3)**. Discharge = those tests + the AC3 exercised rollback + the AC8 restore drill + the AC4 pre-merge gate spike. Record the narrowed exception explicitly.

### §Secrets & manual prerequisites (enumerate in `docs/manual-setup.md` before pickup)
**GitHub Actions secrets/inputs:** `RAILWAY_API_TOKEN` (account/project token — used by `tcpProxyCreate`/`Delete`, deployment-status polling, `deploymentRedeploy` rollback, `variableUpsert`); Railway **project id + production environment id + `classlite-api` service id + `Postgres` service id** (every graphql mutation needs them); migrator creds for the runtime-assembled migrate URL (`classlite_migrator` password) + `sslmode=require`; the new `classlite_app` password secret (AC7); the exact **401-protected route** + `/health` path the smoke hits (AC3); the rollback-target discovery call (which "previous good deployment" id, which API).
**Manual Ducdo steps (NOT code — console/settings, record as prereqs):** enable Railway **"Wait for CI"** on `classlite-api` (per-service deploy-trigger setting; not in `railway.json`, not reliably on graphql/v2); create the GitHub **`production` Environment + required reviewers**; **provision the prod `classlite_migrator` role** + password (CI's is only a test fixture — prod has no equivalent yet) with `NOSUPERUSER BYPASSRLS` (+ `CREATEDB` if AC6 creates `classlite_dev` in-band). Note: branch-protection "required status checks" gate *merges*, not deploys — do not conflate with what Railway watches.

### Files to touch
- **NEW** `.github/workflows/deploy.yml` (orchestration) · **NEW** `docs/deploy-runbook.md`
- **UPDATE** `docs/manual-setup.md` (check prod boxes) · `deferred-work.md` (close 2 FUs)
- **SEC-7** possibly `classlite-api/migrations/20260930120600`/`700` are **immutable** (shipped) — do NOT edit them; the fix is role-privilege + a NEW test (and, if Forks §F2 picks redesign, a NEW forward migration). Reuse `classlite-api/internal/test/testdb.go` (11-1a migrator lifecycle).
- **Do NOT touch** `classlite-api/Dockerfile` (sqlc fix already shipped) or the immutable `20260601110000` migration.

### References
- [Source: `_bmad-output/planning-artifacts/epics/epic-11.md#Story 11-8a` — AC1–AC4]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:73` — FU-11-DEPLOY]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:1379,1384` — FU-11-1A-MIGRATOR-BYPASSRLS / SEC-7]
- [Source: `.github/workflows/ci-api.yml` — "Bootstrap + migrate test DB" (golang-migrate v4.19.1, classlite_migrator BYPASSRLS, throwaway classlite_dev)]
- [Source: `classlite-api/migrations/20260601110000_create_app_role.up.sql` — classlite_app + hardcoded GRANT CONNECT classlite_dev + dev-default password]
- [Source: project memory `project_v2_deploy_infra_provisioning` — the manual 2026-10-15 provisioning + the exact gotchas this story automates]

## Definition of Done
- `deploy.yml` runs migrate (privileged) → terminal `gate-passed` check → Railway cutover → separate-workflow smoke, green on a real prod run (first run is an idempotent no-op migrate — expected).
- **Fail-closed red-phase test green** (AC2): deliberately-failing migration halts non-zero + blocks cutover/smoke; full-from-scratch migrate as the migrator role passes.
- **DF-C gate spike recorded**: proven that Railway "Wait for CI" waits on Actions check-runs AND pending-approval blocks cutover (else escalated — the gate must not fail open).
- Smoke asserts `/health` 200 + protected-`401` + **an authenticated `200`** (real `classlite_app` path); rollback **proven to revert traffic** (version-oracle + known-bad injection), exercised once, scripted.
- **SEC-7 test green with teeth** (AC5): positive + negative control + receiver-fallback + `pg_roles` on the real prod role; no resolver behavior changed; `FU-11-1A-MIGRATOR-BYPASSRLS` closed.
- **DB restore drill done** (AC8): backups enabled + one restore verified into a throwaway target, documented.
- `classlite_app` prod password rotated off the dev default; `DATABASE_URL` updated; app still serves an authenticated `200`.
- Railway **auto-deploy-on-push stays ON** (gated by "Wait for CI"); `deploy.yml` owns migrate + (separate workflow) smoke/rollback, **not** the image push; the gated check-suite authorizes **cutover** only.
- `docs/manual-setup.md` prod boxes checked + §Secrets manual prerequisites recorded; `FU-11-DEPLOY` closed; narrowed WF-8 exception recorded.

## Out of Scope
- **Staging environment** (`docs/manual-setup.md` Staging column, backup/restore proof, k6/FU-8-4-PERF) → **Story 11-8b**.
- **Cloudflare Pages deploy gating** — web/landing stay on their existing git-auto-deploy (static, no schema risk); bringing them under `deploy.yml` is deferred.
- **Backend Sentry** (FU-11-SENTRY) and **ci-web tsc gate** (FU-11-TSC, already CLOSED by 11-5a) — separate FUs.
- Re-provisioning any infra (done manually 2026-10-15).

## Forks for Ducdo (defaults are written into the ACs — override if desired)
- **F1 — Orchestration: ✅ RULED (Ducdo 2026-10-15) — Railway "Wait for CI".** Keep Railway auto-deploy ON but gate it on the GitHub check suite (privileged `migrate` job + `production`-Environment approval). Cleaner than disabling auto-deploy + API-driving Railway. Folded into AC4 + Dev Notes §Orchestration + Task 1.
- **F2 — SEC-7 mechanism: ✅ RULED (Ducdo 2026-10-15) — default.** Prod migrator role `NOSUPERUSER BYPASSRLS` + a regression test exercising the resolvers as that role. Resolver RLS-redesign alt NOT taken (constrained by FORCE RLS; a new migration + receiver review).
- **F3 — Smoke "authenticated route": ✅ ACCEPTED default (Ducdo 2026-10-15)** — protected-route-returns-`401` (no prod creds). (Alt not taken: synthetic monitoring account doing a real login.)
- **F4 — DB reachability for migrate: ✅ ACCEPTED default (Ducdo 2026-10-15)** — temporary Railway TCP proxy created+destroyed per deploy run. (Alt not taken: persistent private runner / Railway-run migrate — distroless has no `migrate` binary.)
- **F5 — `classlite_app` password: ✅ ACCEPTED default (Ducdo 2026-10-15)** — prod-only secret-driven `ALTER ROLE` post-migrate. (Alt not taken: a forward migration reading the password from a GUC/setting.)

### Party-Mode Spec Review (2026-10-15) — ALL FORKS RULED
Winston/Murat/Amelia/John reviewed as independent subagents. **Unambiguous corrections folded in:** struck the stale "disable auto-deploy" DoD line + cutover-vs-build language (AC2/DoD/§Orch); smoke → **separate `deployment_status` workflow** (deadlock fix, AC3/Task 3); AC6 `CREATEDB`-vs-`NOSUPERUSER` reconcile + `pg_database` guard + no-tx `CREATE DATABASE`; AC7 rotate→update order + idempotent guard + var-triggers-redeploy; TCP-proxy `sslmode=require` + `if: always()` teardown + runtime URL; `concurrency` group; §Secrets manual-prereqs. **Four forks RULED (Ducdo 2026-10-15 — "accept all as recommended"):**
- **DF-A ✅ RULED (a):** one-time **DB-restore drill** folded in as **AC8** + Task 6 (not the sequencing lock). Expand/contract constraint stands (AC3).
- **DF-B ✅ RULED — accept core + rollback oracle:** WF-8 exception **narrowed to declarative YAML only** (§WF-8); ADDED the **fail-closed red-phase test** (AC2 / Task 2, the score-9), **SEC-7 teeth** = negative control + receiver-fallback + `pg_roles` (AC5 / Task 4), **authenticated-200 smoke** (AC3 / Task 3), **version-oracle/known-bad rollback** (AC3 / Task 3).
- **DF-C ✅ RULED — accept:** terminal **`gate-passed`** check context + **pre-merge spike** proving Wait-for-CI waits on check-runs AND pending-approval blocks cutover, as a **DoD item** (AC4 / Task 1).
- **DF-D ✅ RULED — test-only pinning:** AC5 does NOT change the two `SECURITY DEFINER` resolvers' behavior; no resolver migration rides this P0 story (AC5).

## Change Log
| Date | Change | By |
|------|--------|-----|
| 2026-10-15 | **Dev-story: pipeline code + behavioral tests + docs LANDED & locally verified; live-ops drills handed off to Ducdo.** ready-for-dev→in-progress. Shipped `deploy.yml` (fail-closed `migrate-gate-test` → `production`-gated `migrate` → terminal `gate-passed`) + separate `smoke.yml` + `scripts/{migrate-gate-test,rollback,rollback-drill,rotate-app-password,railway-lib}.sh` + `internal/test/migrator_bypassrls_sec7_atdd_test.go` + `docs/deploy-runbook.md` + `manual-setup.md` section. **Verified green locally:** AC2 fail-closed proof (84 migrations as NOSUPERUSER BYPASSRLS exit 0 + deliberate failure exit non-zero) and AC5 SEC-7 teeth (positive / non-BYPASSRLS-owner negative control → NULL / FORCE assert / receiver-fallback / pg_roles+owner). Narrowed WF-8 exception recorded (test-design-architecture:242). Closed FU-11-DEPLOY + FU-11-1A-MIGRATOR-BYPASSRLS. **DEVIATION (sanctioned):** standing TCP proxy, not per-run create/delete. **STAYS in-progress** — DoD needs operator-only drills (DF-C gate spike, exercised rollback + known-bad injection, DB restore, prod migrator provisioning, AC7 rotation, live Railway GraphQL field validation); full handoff in runbook §2–§8. Impl record → completion-notes sibling. | Amelia |
| 2026-10-15 | **Party-mode forks DF-A–DF-D RULED (Ducdo, "accept all as recommended").** DF-A→AC8+Task6 DB-restore drill. DF-B→WF-8 narrowed to YAML-only + AC2/Task2 fail-closed red test (score-9) + AC5/Task4 SEC-7 teeth (negative control/receiver-fallback/pg_roles) + AC3/Task3 authed-200 smoke + version-oracle/known-bad rollback. DF-C→AC4/Task1 terminal `gate-passed` check + pre-merge Wait-for-CI/approval spike (DoD). DF-D→AC5 test-only pinning (no resolver behavior change). Now **8 ACs / 8 tasks**. Still ready-for-dev. | Amelia |
| 2026-10-15 | **Party-mode spec review (Winston/Murat/Amelia/John).** Unambiguous corrections folded: struck stale "disable auto-deploy" DoD line + cutover-vs-build language (AC2/DoD/§Orch); smoke → separate `deployment_status` workflow (deadlock fix, AC3/Task2); AC6 CREATEDB/NOSUPERUSER reconcile + pg_database guard + no-tx CREATE DATABASE; AC7 rotate→update order + idempotent guard + var-triggers-redeploy; proxy sslmode + `if: always()` teardown + runtime-URL; `concurrency` group; §Secrets manual-prereqs. 4 held forks added: DF-A data-restore-drill-vs-sequencing-lock, DF-B WF-8-narrow + fail-closed red test + SEC-7 teeth + authed-200 + rollback oracle, DF-C gate-passed check + Wait-for-CI/approval spike, DF-D SEC-7 behavior-change-vs-test-pin. Now 7 ACs / 5 tasks / 5 ruled + 4 held forks. | Amelia |
| 2026-10-15 | **Forks F1+F2 RULED (Ducdo).** F1 → Railway **"Wait for CI"** (gate the push-deploy on the GitHub migrate check + `production`-Environment approval; not disable-auto-deploy). F2 → default (prod migrator `NOSUPERUSER BYPASSRLS` + tested invariant). AC4, §Orchestration, Task 1, Forks updated. F3/F4/F5 remain at their written defaults (unruled). | Amelia |
| 2026-10-15 | Story created (`/bmad-create-story 11-8a`). backlog→ready-for-dev. Scope reframed off the **live** manually-provisioned stack: environment exists + migrations already applied once by hand, so this story is the **gated pipeline** (migrate-as-privileged-CI-step + fail-closed + prod gate + smoke + exercised rollback) plus the SEC-7 resolver privilege fix (closes FU-11-1A-MIGRATOR-BYPASSRLS), the `classlite_dev` replay-landmine handling, and `classlite_app` password rotation. sqlc-Dockerfile build fix already shipped (`f82f3d3`). WF-8 documented infra exception. 7 ACs / 6 tasks / 5 forks. baseline `d77a493`. | Amelia |
