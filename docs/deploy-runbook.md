# Deploy Runbook — ClassLite v2 (Story 11-8a)

_The operational contract for shipping `classlite-api` to prod. The pipeline code is
`.github/workflows/deploy.yml` (+ `smoke.yml`) and `scripts/migrate-gate-test.sh`,
`scripts/rollback*.sh`, `scripts/rotate-app-password.sh`, `scripts/railway-lib.sh`._

> **Why this story exists.** `classlite-api` connects as `classlite_app` and **never migrates
> on boot**; an un-migrated image is therefore a schema mismatch in front of users. This
> pipeline makes `migrate up` a dedicated privileged CI step, refuses to cut traffic on any
> failure, gates prod behind an explicit human approval, smokes what it shipped, and keeps a
> rollback + restore drill that have actually been run.

---

## 1. How a prod deploy flows (AC1/AC2/AC4 — the gate)

Railway auto-deploy-on-push stays **ON**. With **"Wait for CI" enabled** on the `classlite-api`
service, Railway builds the pushed commit in parallel with CI but **holds the traffic cutover**
until the commit's GitHub check suite concludes green.

```
push to main
   ├─► Railway: builds the image (parallel, side-effect-free) ─┐
   └─► GitHub Actions deploy.yml:                               │
         migrate-gate-test  (throwaway DB, fail-closed proof)   │
                 ↓ green                                        │
         migrate            (production Environment →           │
                             WAITS for a required-reviewer      │
                             approval, then runs migrate up)    │
                 ↓ green                                        │
         gate-passed        (single terminal check context) ────┘
                 ↓
   Railway "Wait for CI" sees gate-passed green → CUTS TRAFFIC to the new image
                 ↓
   Railway emits deployment_status=success → smoke.yml runs (separate, non-gating)
```

- A **red `migrate-gate-test`**, a **red `migrate`**, or an **un-approved `migrate`** ⇒
  `gate-passed` never concludes ⇒ Railway **never cuts over** (fail-closed).
- `migrate up` runs **while the OLD image is still serving**. Rollback reverts the **image
  only** (no `migrate down`). ⇒ **migrations MUST be expand/contract backward-compatible.** A
  destructive migration breaks prod *during* the migrate step and rollback cannot restore
  dropped data — that is what the AC8 restore drill backstops.

### Approving a prod deploy
1. Push merges to `main`. The `migrate` job enters **waiting** on the `production` Environment.
2. A required reviewer opens the Actions run → **Review deployments** → approve.
3. `migrate` runs; on green, `gate-passed` goes green; Railway cuts over.
4. Watch `smoke.yml` (fires on the Railway `deployment_status=success`).

---

## 2. Secrets & variables (enumerate + set before first gated run)

### Progress — 2026-10-16 (Ducdo + Amelia)

**Done & verified:** standing Postgres TCP proxy (`ballast.proxy.rlwy.net:22354`) + `RAILWAY_PG_PROXY_*`
secrets · "Wait for CI" ON (`checkSuites:true`) · GitHub `production` Environment + required
reviewer `andukdahacker` · `classlite_migrator` provisioned (`rolsuper/bypassrls = f/t`, both
resolvers re-owned to it, 46/46 public tables, 0 left on `postgres`) + `MIGRATION_DB_*` secrets ·
`PROD_API_URL`/`SMOKE_*` vars. **Still open:** `RAILWAY_API_*` rollback secrets · synthetic monitor
account (`SMOKE_EMAIL/PASSWORD`) · DF-C spike · AC7 password rotation · rollback drill (needs a 2nd
successful deploy) · backups + restore drill.

### Verified initial state — 2026-10-15 (live Railway + GitHub probe, Amelia)

At pickup, **nothing in this story's pipeline was configured.** The infra existed and was healthy;
every gate/safety mechanism below was unset (see the 2026-10-16 progress note above for what has
since been done).

| Reality | Evidence |
|---|---|
| ❌ "Wait for CI" **OFF** on `classlite-api` | `deploymentTrigger.checkSuites: false` → auto-deploys on push without waiting |
| ❌ GitHub `production` Environment **missing** | `GET environments/production` → 404. Only `classlite / production` (Railway's own integration env) exists, `protection_rules: []` |
| ❌ Deploy secrets/vars **none** | only `CHROMATIC_PROJECT_TOKEN` exists |
| ❌ Standing Postgres **TCP proxy none** | `tcpProxies(Postgres) → []` |
| ❌ Rollback **no target** | `classlite-api` has 1 SUCCESS deployment ever (`d77a493`); rest FAILED/SKIPPED/REMOVED |
| ❌ Postgres **backups** unset | `volumeInstanceBackupScheduleList → []` |
| ⚠️ Prod `classlite_migrator` role | not verifiable without DB access; the hand-migrate on 10-15 used Railway's default superuser → assume NOT provisioned |
| ✅ Live API healthy | `/health` → `{"db":"connected","status":"ok"}`; `/api/students` no-token → `401` |

**Discovered Railway IDs (pre-fill the secrets below with these):**

| ID | Value | Maps to |
|---|---|---|
| Project | `869846fd-2c22-4c10-95f6-b4a7ec938311` | (rollback queries need project+env+service) |
| production environment | `51b3126d-13fc-4707-a4b3-9634695400cb` | `RAILWAY_ENVIRONMENT_ID` |
| `classlite-api` service | `c7889ff9-d6d4-413a-8d62-0e460df6a370` | `RAILWAY_API_SERVICE_ID` |
| `Postgres` service | `7a699103-0392-43a0-acb8-a5a0f408eaa2` | (proxy/backup target) |
| Postgres volume instance | `0ac04cff-d125-4f76-9d80-069ea42079a1` | (backup/restore target, §8) |

### Secrets & variables to set

**GitHub → repo → Settings → Secrets and variables → Actions.**

| Name | Kind | Used by | Value / Notes |
|---|---|---|---|
| `RAILWAY_PG_PROXY_HOST` | secret | deploy.yml migrate | Standing Postgres TCP proxy host (`RAILWAY_TCP_PROXY_DOMAIN`, available AFTER step ① below). |
| `RAILWAY_PG_PROXY_PORT` | secret | deploy.yml migrate | Standing proxy port (`RAILWAY_TCP_PROXY_PORT`, after ①). |
| `MIGRATION_DB_USER` | secret | deploy.yml migrate | `classlite_migrator` (after §3). |
| `MIGRATION_DB_PASSWORD` | secret | deploy.yml migrate | Prod migrator password (chosen in §3). |
| `MIGRATION_DB_NAME` | secret | deploy.yml migrate | `railway` (the prod app DB). |
| `RAILWAY_API_TOKEN` | secret | smoke.yml rollback, drill | A Railway **account or project token** (create: Railway → Account/Project Settings → Tokens). |
| `RAILWAY_API_SERVICE_ID` | secret | rollback/drill | `c7889ff9-2c…df370` (classlite-api, above). |
| `RAILWAY_ENVIRONMENT_ID` | secret | rollback/drill | `51b3126d-…5400cb` (production, above). |
| `SMOKE_EMAIL` / `SMOKE_PASSWORD` | secret | smoke.yml authed-200 | A synthetic monitor account seeded in prod (§5). |
| `NEW_APP_PASSWORD` | secret | rotate-app-password.sh | New `classlite_app` password (AC7). Not a committed literal. |
| `PROD_API_URL` | **var** | smoke.yml | `https://api.classlite.app`. |
| `SMOKE_PROTECTED_PATH` | **var** | smoke.yml | `/api/students` (verified 401 with no token). |
| `SMOKE_READ_PATH` | **var** | smoke.yml | A cheap seeded authed read returning a `{data}` envelope. |

### Manual console steps (NOT code) — in order

- [ ] **① Enable a standing TCP proxy on Postgres (chosen approach — see note).** Railway
      dashboard → `classlite` → `Postgres` service → **Settings → Networking → TCP Proxy →
      Add/Enable** (proxies the internal `:5432`). Redeploy the Postgres service so it arms.
      Then read `RAILWAY_TCP_PROXY_DOMAIN` + `RAILWAY_TCP_PROXY_PORT` from the Postgres service
      **Variables** tab → set them as `RAILWAY_PG_PROXY_HOST` / `RAILWAY_PG_PROXY_PORT`.
- [ ] **② Enable Railway "Wait for CI"** on `classlite-api`: dashboard → `classlite-api` →
      **Settings → Deploy (or "Build & Deploy") → "Wait for CI"** toggle ON (this flips
      `deploymentTrigger.checkSuites` → true). Per-service deploy-trigger setting; not in
      `railway.json`, not reliably settable on graphql/v2 — do it in the console.
- [ ] **③ Create the GitHub `production` Environment + required reviewers:** GitHub → repo →
      Settings → **Environments → New environment → `production`** → under **Deployment
      protection rules** tick **Required reviewers** and add **yourself** (duc.do / andukdahacker).
      This is what makes the `migrate` job pause for your approval on every prod deploy (AC4).
      ⚠ Create it named exactly `production` — the existing `classlite / production` is Railway's
      integration env and is a different object; `deploy.yml` targets `production`.
- [ ] **④ Provision the prod `classlite_migrator`** role (§3). CI's is a test fixture only.
- [ ] **⑤ Seed the synthetic monitor account** in prod (§5) → `SMOKE_EMAIL`/`SMOKE_PASSWORD`.

> **Why a standing proxy (not per-run `tcpProxyCreate`/`Delete`): chosen 2026-10-15.** The live
> probe found `tcpProxies(Postgres) → []`, so neither path works until you act. A standing proxy
> is one toggle (①) + two secrets and removes the per-run-create race, the leaked-public-proxy
> fail-OPEN window, and the `if: always()` teardown entirely. `deploy.yml` already reads
> `RAILWAY_PG_PROXY_HOST/PORT` and keeps `sslmode=require`. (The per-run alternative is worse
> here: Railway's `tcpProxyCreate` is deprecated and "requires you to redeploy the service for it
> to be active" — fiddly and slow. Documented in §4 only as a last resort.)

> Branch-protection "required status checks" gate **merges**, not deploys — do not conflate
> with what Railway's "Wait for CI" watches.

---

## 3. Prod migrator role (AC5/AC6) — provision once

Run as the Railway Postgres bootstrap superuser (via the TCP proxy):

```sql
-- NOSUPERUSER BYPASSRLS mirrors CI's classlite_migrator. BYPASSRLS is LOAD-BEARING: the two
-- Epic-9 SECURITY DEFINER resolvers (polar_center_by_subscription_id / _checkout_id) run as
-- their owner (this role) and must read FORCE-RLS tables cross-tenant with no tenant GUC. A
-- non-BYPASSRLS owner ⇒ NULL ⇒ the webhook receiver falls back to spoofable metadata.center_id
-- (SEC-7 confused deputy). CREATEDB lets this role create the throwaway classlite_dev in-band
-- (AC6); omit it and create classlite_dev out-of-band once instead.
CREATE ROLE classlite_migrator LOGIN PASSWORD '<MIGRATION_DB_PASSWORD>'
  NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS;
ALTER DATABASE railway OWNER TO classlite_migrator;   -- the migrator owns the app DB (full DDL)
GRANT CONNECT ON DATABASE classlite_dev TO classlite_migrator WITH GRANT OPTION;
```

**AC6 — the `classlite_dev` replay landmine.** The immutable migration `20260601110000`
hardcodes `GRANT CONNECT ON DATABASE classlite_dev`. The prod DB is `railway`, so that GRANT
replays against a database named `classlite_dev` which must exist. `deploy.yml`'s migrate job
ensures it (guarded by `pg_database`; `CREATE DATABASE` runs outside a tx — there is no
`CREATE DATABASE IF NOT EXISTS`). If the migrator lacks `CREATEDB`, create it out-of-band once:

```sql
SELECT 1 FROM pg_database WHERE datname='classlite_dev';  -- if 0 rows:
CREATE DATABASE classlite_dev;
```

**AC5 prod-drift check (run after provisioning, and periodically).** The Go regression test
(`internal/test/migrator_bypassrls_sec7_atdd_test.go`) pins this on the TEST role; the identical
assertion must hold on the **prod** role — a Go test cannot reach prod:

```sql
-- expect: rolsuper=f, rolbypassrls=t
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='classlite_migrator';
-- expect both owned by classlite_migrator
SELECT p.proname, r.rolname AS owner
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
WHERE p.proname IN ('polar_center_by_subscription_id','polar_center_by_checkout_id');
```

---

## 4. Rollback (AC3)

**Automatic:** on a `smoke.yml` failure, `scripts/rollback.sh` redeploys the previous SUCCESS
deployment (image only) and fails loud if the reverted image is not healthy.

**Exercised-once proof (re-runnable):** `scripts/rollback-drill.sh` — captures the serving
deployment id, rolls back, and asserts the serving id == the prior id AND `/health` 200 (proves
traffic *actually* reverted, not just that an API call ran). Run it against prod once and paste
the output below.

```
RAILWAY_API_TOKEN=… RAILWAY_API_SERVICE_ID=… RAILWAY_ENVIRONMENT_ID=… \
  PROD_API_URL=https://api.classlite.app scripts/rollback-drill.sh
```

**Known-bad injection (manual drill — do with eyes on prod):** deploy a deliberately
smoke-failing image, confirm `smoke.yml` fires the rollback AND that live traffic never served
the bad image (Railway's `/health` native gate should keep the prior deployment serving; the
authed-200 smoke is the backstop). Record the result below.

> ⚠ **Railway GraphQL field names in `scripts/railway-lib.sh` are marked for live validation.**
> Confirm `deployments`, `deploymentRedeploy`, and node fields against
> `backboard.railway.com/graphql/v2` during the §7 spike; a wrong field name fails rollback OPEN.

### Drill evidence (fill in once run)
- Rollback-drill (version oracle): _<paste serving-before / target / serving-after + PASS>_
- Known-bad injection: _<paste: smoke failed → rollback fired → bad image never served>_

---

## 5. Smoke (AC3)

`smoke.yml` runs post-cutover (separate workflow, non-gating):
1. `/health` → `200 {"status":"ok","db":"connected"}`.
2. `SMOKE_PROTECTED_PATH` with **no token** → `401` (auth routing live).
3. **Authenticated `200`**: log in `SMOKE_EMAIL`/`SMOKE_PASSWORD`, read `SMOKE_READ_PATH`,
   assert `200` + a `{data}` envelope. This is the ONLY check that exercises the real
   `classlite_app` connection — it catches AC7's password rotation breaking the app
   (a dead-DB/broken app also returns `401`, so 401-only is liveness cosplay).

Seed the synthetic monitor account in prod (a low-privilege real login), store its creds as
`SMOKE_EMAIL`/`SMOKE_PASSWORD`.

---

## 6. `classlite_app` password rotation (AC7) — one-time operational action

> ✅ **DONE 2026-10-16** (after one failed attempt — see the incident note). Rotated off the dev
> default, `DATABASE_URL` updated, app verified healthy on the new password, `NEW_APP_PASSWORD` stored.
>
> ⚠️ **INCIDENT / LESSON (2026-10-16).** The first rotation caused a ~prod outage. Two traps:
> 1. **`railway variables --set` (legacy flag) silently no-op'd** — the role password changed but
>    `DATABASE_URL` didn't, so `classlite_app` 28P01'd on every new connection. Use the current form
>    **`railway variable set KEY=VALUE`** and **read the var back to confirm** it took.
> 2. **A var-change redeploy is SKIPPED while "Wait for CI" is ON** (and doubly so when `main`'s CI
>    is red) — so the new `DATABASE_URL` never reaches a running instance; the old instance keeps
>    serving the stale password and breaks as its pool recycles. **`/health` can false-positive** off
>    the old instance's live pool.
>
> **Correct rotation procedure:** (a) `ALTER ROLE … PASSWORD` → (b) **verify by connecting AS
> `classlite_app`** with the new pw (not `/health`) → (c) `railway variable set DATABASE_URL=…` →
> (d) **read `DATABASE_URL` back** to confirm → (e) **force a deploy** so it rolls out: if "Wait for
> CI" blocks it, turn it OFF, `railway redeploy --service classlite-api --yes`, turn it back ON →
> (f) confirm `/health` + no `28P01` in logs. **Recovery if you're mid-outage:** same (e)+(f) — the
> stored config is already consistent, you just need one deploy to land.


The dev default (`classlite_dev_password`, hardcoded in the immutable `20260601110000`) must be
rotated in prod. This is **not** in the recurring pipeline (updating the Railway `DATABASE_URL`
var itself triggers a redeploy). Sequence — **rotate first, then update the var**:

```
# 1. Rotate the role password (idempotent — guarded by a COMMENT ON ROLE sentinel):
ADMIN_URL='postgres://classlite_migrator:…@<proxy-host>:<port>/postgres?sslmode=require' \
NEW_APP_PASSWORD='<NEW_APP_PASSWORD>' scripts/rotate-app-password.sh

# 2. Operator: set Railway classlite-api DATABASE_URL to the new password.
#    Existing pooled connections survive the password change; only NEW connections with the
#    stale password fail — keep the gap minimal. The var update triggers a Railway redeploy of
#    the SAME already-migrated schema (safe under expand/contract, AC3).
```

---

## 7. DF-C pre-merge gate spike (AC4 — must pass before this story closes)

The gate rests on two Railway behaviors; if either is false the gate fails **OPEN**. Prove both
on a throwaway commit and record here:
- [ ] "Wait for CI" waits on GitHub **Actions check-runs** (not just legacy commit-status).
- [ ] A **pending-approval** `production`-Environment job **blocks the cutover** (Railway does
      not ship while the check suite is pending).

### Spike evidence (fill in once run)
- Check-runs waited on: _<result>_
- Pending-approval blocked cutover: _<result>_
- Railway GraphQL field names confirmed (§4): _<result>_

---

## 8. Database restore drill (AC8)

Image rollback cannot restore data a successful-but-destructive migration dropped. This is the
single worst case on the first real deploy, so convert "we believe we have backups" into "we
restored one and watched it work":
- [ ] Enable Railway Postgres **backups**.
- [ ] Perform **one restore** into a throwaway target; verify the data comes back.
- [ ] Record the procedure + evidence below.

The **standing rule** that keeps destructive migrations out of the gap this drill backstops:
every migration is **expand/contract backward-compatible** (AC3). The full automated
backup/restore gate is **Story 11-8b**.

### Restore-drill evidence (fill in once run)
- Backups enabled: _<result>_  · Restore verified: _<result>_

---

## 9. Break-glass (emergency manual migrate)

If CI is down but a migrate is urgent, run from a trusted host via the TCP proxy **as the
migrator role** (never `classlite_app`, never a superuser app connection):

```
migrate -path classlite-api/migrations \
  -database 'postgres://classlite_migrator:…@<proxy-host>:<port>/railway?sslmode=require' up
```

Then re-run the §3 prod-drift check and §5 authed-200 smoke by hand. Record that a break-glass
migrate happened (who/when/why) in the PR or incident log.
