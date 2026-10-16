# Manual Setup Tasks

External work that can't be done in code — OAuth apps, DNS, deploy config, secrets. Update this as new stories add services. When deploying to staging/prod, filter to unchecked items in the target column.

Legend: `[x]` done · `[ ]` todo · `[-]` N/A

Columns: **Dev** = your local machine · **Staging** = pre-prod env (TBD) · **Prod** = classlite.app

---

## Google OAuth — Login (Story 1.6)

Single OAuth 2.0 credential in Google Cloud Console; reused by Meet integration below.

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Create Google Cloud project | [x] | [ ] | [ ] |
| Enable OAuth 2.0 API | [x] | [ ] | [ ] |
| Create Web-application OAuth client | [x] | [ ] | [ ] |
| Add redirect URI: `.../api/auth/google/callback` | [x] | [ ] | [ ] |
| Set `GOOGLE_CLIENT_ID` env var | [x] | [ ] | [ ] |
| Set `GOOGLE_CLIENT_SECRET` env var | [x] | [ ] | [ ] |
| Set `GOOGLE_REDIRECT_URL` env var | [x] | [ ] | [ ] |
| Set `OAUTH_STATE_SECRET` (≥32 bytes in non-dev) | [x] | [ ] | [ ] |

---

## Google Meet OAuth (Story 2.5c)

Reuses the credentials above. Just extend scopes + add a second redirect URI.

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Add `calendar.events` scope to OAuth consent screen | [x] | [ ] | [ ] |
| Add Meet callback redirect URI: `.../api/centers/callback/google-meet` (FIXED path — no `{id}` — Google requires exact-match redirect_uri, per AC9 amendment 2026-07-16) | [x] | [ ] | [ ] |
| Generate `INTEGRATIONS_ENCRYPTION_KEY` (`openssl rand -base64 32`) | [x] | [ ] | [ ] |
| Set `MEET_OAUTH_REDIRECT_URL` env var | [ ] | [ ] | [ ] |

---

## Resend Email (Story 1.4)

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Create Resend account | [ ] | — | — |
| Verify `classlite.app` sending domain (DNS TXT/CNAME) | [-] | [ ] | [ ] |
| Set `RESEND_API_KEY` | [ ] | [ ] | [ ] |
| Set `RESEND_FROM_EMAIL=noreply@classlite.app` | [ ] | [ ] | [ ] |
| Set `APP_VERIFY_URL_BASE` | [ ] | [ ] | [ ] |
| Set `APP_RESET_URL_BASE` | [ ] | [ ] | [ ] |

### Grade-release notification (Story 6.1)

The grade-release email is a code-side `RenderGradeReleasedEmail` template (no Resend dashboard template needed — same inline-HTML pattern as verify/invite). The **student email is gated** so delivery can wait until Story 5-5b renders the grade block; the grade still persists + releases regardless. Deep-links to `{APP_RESULT_URL_BASE}/assignments/{assignmentId}/submission` (the 5-5a result page).

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Set `GRADE_RELEASE_EMAIL_ENABLED` (default `false` — flip to `true` only once 5-5b renders the grade for students) | [x] `false` | [ ] | [ ] |
| Set `APP_RESULT_URL_BASE` (app origin for the result deep link, e.g. `https://app.classlite.app`) | [ ] | [ ] | [ ] |

---

## Cloudflare R2 (Story 1.2e)

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Create R2 bucket `classlite-uploads` | [ ] | [ ] | [ ] |
| Generate API token (read + write on bucket) | [ ] | [ ] | [ ] |
| Set `R2_ACCOUNT_ID` | [ ] | [ ] | [ ] |
| Set `R2_ACCESS_KEY_ID` | [ ] | [ ] | [ ] |
| Set `R2_SECRET_ACCESS_KEY` | [ ] | [ ] | [ ] |
| Set `R2_BUCKET_NAME` | [ ] | [ ] | [ ] |

**Story 4.4a note:** the presigned-upload endpoints (`/api/uploads/presign` + `/confirm`)
are now **authenticated** (behind ExtractTenant/verified/center) and the Knowledge Hub
upload→confirm→create flow relies on R2 being configured — without the R2 vars above the
API falls back to the in-memory mock (dev only). No new env var is introduced by 4.4a.
The per-center storage ceiling is `centers.storage_limit_bytes` (DB column, **500 MiB /
524288000-byte default applied automatically by the migration** — no manual backfill); it
is read-only until Epic 9 introduces the plan model + write path that raises it.

---

## Google Gemini — AI Content Generation (Story 4.3a)

The async job worker calls the Gemini `generateContent` REST API to generate
exercise sections / questions / distractors. Required in non-dev (`Validate()`
rejects an empty `GEMINI_API_KEY` outside development). The key lives in env
only and is NEVER logged (EDGE-4/R49). A real call is banned from CI — PR tests
inject a mock.

**Story 6.2a (AI Writing grading)** reuses the same `GEMINI_API_KEY` / `GEMINI_MODEL`
env vars and the same worker/mock seam — the `ai_grade_writing` job type registers a
new handler on the existing dispatcher. **No new environment variables or setup are
required.**

**Story 6.3b (AI Speaking grading)** likewise reuses the same `GEMINI_API_KEY` /
`GEMINI_MODEL` — the `ai_grade_speaking` job type registers another handler. **No new
env vars.** But there is a HARD model requirement (D16): `GEMINI_MODEL` **MUST be a
multimodal (audio-capable) model** — the speaking worker POSTs the recording as inline
audio. A text-only model is refused at run time and looks like a provider hiccup (three
retries → refund), NOT a config error. The default `gemini-2.0-flash` is multimodal.
**Model coupling:** there is one shared model for authoring + writing + speaking (no
per-job-type config in v1), so swapping `GEMINI_MODEL` for speaking changes authoring/
writing cost + behavior too — validate any swap against all three. (ffmpeg for the audio
transcode is a 6-3b0 runtime dependency — see the ffmpeg section below.)

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Create a Google AI Studio API key (or GCP `generativelanguage` API key) | [ ] | [ ] | [ ] |
| Set `GEMINI_API_KEY` env var | [ ] | [ ] | [ ] |
| Set `GEMINI_MODEL` (optional — defaults to `gemini-2.0-flash`) | [-] | [-] | [-] |

---

## Railway — API Deploy

**Open decision:** parallel deploy (new Railway project, cut traffic over, delete v1) vs in-place swap (reuse v1 project, swap repo). Parallel is safer if v1 has user data.

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Decide cutover strategy (parallel vs in-place) | — | [ ] | [ ] |
| Create/select Railway project | — | [ ] | [ ] |
| Connect GitHub repo | — | [ ] | [ ] |
| Add PostgreSQL service (auto-provisions `DATABASE_URL`) | — | [ ] | [ ] |
| Set all env vars in Railway dashboard | — | [ ] | [ ] |
| Verify `/health` responds | — | [ ] | [ ] |
| Confirm migrations ran | — | [ ] | [ ] |
| Delete v1 Railway service (after 48h zero-traffic) | — | — | [ ] |

Prod stood up manually 2026-10-15 (Railway project `classlite` + Postgres + `classlite-api`
live & healthy, migrations applied once by hand → DB at `20261012120000`). Deploy automation is
the **Deploy Pipeline** section below.

---

## Deploy Pipeline — Migrate Gate, Smoke, Rollback (Story 11-8a)

Full procedure + secrets table: **`docs/deploy-runbook.md`**. The gated pipeline is
`.github/workflows/deploy.yml` + `smoke.yml`. Prerequisites that are console/DB, not code:

Progress as of 2026-10-16 (Amelia, verified live). Railway IDs + per-item evidence in runbook §2.

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Enable standing **TCP proxy** on `Postgres` → set `RAILWAY_PG_PROXY_HOST/PORT` | — | [-] | [x] `ballast.proxy.rlwy.net:22354` |
| Enable Railway **"Wait for CI"** on `classlite-api` | — | [-] | [x] |
| Create GitHub **`production` Environment** + required reviewers | — | [-] | [x] reviewer `andukdahacker` |
| Provision prod `classlite_migrator` role (`NOSUPERUSER CREATEDB BYPASSRLS`) + own schema | — | [-] | [x] verified `f/t`, resolvers re-owned, 46/0 tables |
| Verify `classlite_dev` DB exists (immutable-GRANT replay, AC6) | — | [-] | [x] exists |
| Set `MIGRATION_DB_*` + `RAILWAY_PG_PROXY_*` secrets + `PROD_API_URL`/`SMOKE_*` vars | — | [-] | [x] |
| Set `RAILWAY_API_TOKEN` + `RAILWAY_API_SERVICE_ID` + `RAILWAY_ENVIRONMENT_ID` (rollback) | — | [-] | [ ] |
| Seed synthetic monitor account → `SMOKE_EMAIL`/`SMOKE_PASSWORD` | — | [-] | [ ] |
| DF-C spike: Wait-for-CI waits on check-runs + pending-approval blocks cutover (runbook §7) | — | [-] | [ ] |
| Rotate `classlite_app` password off dev default + update `DATABASE_URL` (AC7, runbook §6) | — | [-] | [x] rotated 2026-10-16, `/health` verified on new pw |
| Rollback exercised once — needs a 2nd SUCCESS deploy first (only 1 exists) (runbook §4) | — | [-] | [ ] |
| DB restore drill — backups enabled (none scheduled) + one restore verified (AC8, runbook §8) | — | [-] | [ ] |

Staging rows are `[-]` (N/A here) → owned by **Story 11-8b**. Railway GraphQL field names in
`scripts/railway-lib.sh` need live validation during the DF-C spike.

---

## Cloudflare Pages — Frontends

| Task | Dev | Staging | Prod |
|---|---|---|---|
| Connect `classlite-landing` to Pages | — | [ ] | [ ] |
| Connect `classlite-web` to Pages | — | [ ] | [ ] |
| Set build command `npm run build`, output `dist/` | — | [ ] | [ ] |
| Set `PUBLIC_DASHBOARD_URL` per branch | — | [ ] | [ ] |
| Set `VITE_API_URL` per branch | — | [ ] | [ ] |

---

## DNS (Cloudflare)

Do **not** wipe existing records — edit in place to minimize propagation delay.

| Task | Staging | Prod |
|---|---|---|
| `classlite.app` → landing (Cloudflare Pages) | [ ] | [ ] |
| `my.classlite.app` → dashboard (Cloudflare Pages) | [ ] | [ ] |
| `api.classlite.app` → API (Railway) | [ ] | [ ] |
| Verify propagation (`dig`, curl `/health`) | [ ] | [ ] |

---

## ffmpeg — Audio Transcode (Story 6.3b0)

The API runtime now **requires `ffmpeg`**. The AI speaking-grade worker (Epic 6) transcodes browser-recorded clips (webm/mp4) into Gemini-ingestible Opus/Ogg via `internal/media` before the Gemini call — Gemini rejects webm/mp4. Boot runs `CheckFFmpegAvailable` and **fails fast** (`os.Exit(1)`) if the binary is missing/unrunnable, so a bad image never silently ships.

`CLASSLITE_FFMPEG_PATH` selects the binary (default `ffmpeg` → PATH lookup). It is **not** an external-service secret — no dashboard, no credential — just a runtime dependency provided per environment:

| Environment | How ffmpeg is provided | Dev | Staging | Prod |
|---|---|---|---|---|
| **Local dev** | Install on PATH (`brew install ffmpeg` / `apt-get install ffmpeg`), or set `CLASSLITE_FFMPEG_PATH` | [x] | — | — |
| **CI (`ci-api`)** | `apt-get install -y ffmpeg` step (integration tests are guarded against silent skip — AC7) | [x] | — | — |
| **Prod/Staging image** | Bundled **static** ffmpeg copied into the distroless-static runtime from `mwader/static-ffmpeg` (pinned tag), `CLASSLITE_FFMPEG_PATH=/usr/local/bin/ffmpeg` set in the Dockerfile | — | [ ] | [ ] |

⚠️ **Human-review item (Winston/D3):** the `classlite-api/Dockerfile` change that bundles ffmpeg touches the deploy surface (base image, image size, CVE posture). Review points: (1) the pinned `mwader/static-ffmpeg:<version>` tag + its CVE posture, (2) the image-size delta, (3) that the copied binary is genuinely static (`ldd` → "not a dynamic executable"). Bump the pin deliberately, never float it.

---

## Sentry — Error Tracking & Telemetry (Story 11-0a)

Backend + frontend error tracking. The code reads the DSNs from env and **no-ops when unset** (empty DSN = silent no-op, both services — DD4), so setting the env var in a deployed environment **activates capture with no further code change** — the backend already reads `SENTRY_DSN` (`observability.Init`) and the frontend already reads `VITE_SENTRY_DSN` (`src/lib/sentry.ts`). Create **two** Sentry projects (one backend Go, one frontend React) and wire their DSNs:

| Task | Dev | Staging | Prod |
|---|---|---|---|
| `SENTRY_DSN` (api — backend project DSN) | [ ] | [ ] | [ ] |
| `VITE_SENTRY_DSN` (web — frontend project DSN; **baked into the Cloudflare Pages build**) | [ ] | [ ] | [ ] |
| `RELEASE_SHA` (api — commit SHA → Sentry Release; optional, attributes an error to a deploy) | [ ] | [ ] | [ ] |
| `VITE_RELEASE_SHA` (web — commit SHA → FE Release; optional) | [ ] | [ ] | [ ] |
| **Session replay DISABLED — verify** in BOTH Sentry projects' settings. No replay SDK ships (locked by `sentry-replay-off.test.ts`); this confirms it is not enabled server-side either. Replay stays OFF in EVERY env until PII masking is verified (education product, minors plausible, VN jurisdiction/consent). | [ ] | [ ] | [ ] |
| **Log-retention decision** — Sentry captures errors; triage also needs the request-scoped stdout logs, joined by `request_id`. Railway stdout retention is short. DECIDE + record the target here: a Railway **log drain** to a searchable sink, OR an explicit accepted retention window. | [ ] | [ ] | [ ] |

**Wiring notes:**
- Backend errors are captured at the `ErrorMapper` HTTP funnel + the worker dispatcher funnels, tagged by `request_id` / `center_id` / `user_id` / `route` / `method` / `status`, with student PII / submission text / grades / Gemini prompt + API key **scrubbed** (`observability.ScrubEvent`, the R-11-6 guardrail). Only panics + unhandled 500s are captured — mapped 4xx are not.
- Frontend: `VITE_*` vars are **inlined by Vite at build time** — a runtime-only var will NOT reach the bundle. `VITE_SENTRY_DSN` (and optionally `VITE_RELEASE_SHA`=commit SHA) must be set in the Cloudflare Pages **build** environment. The `.env.example` comment claims CI sets `VITE_RELEASE_SHA` — it does not yet; wire it in the Pages build or track as a follow-up.

> **Prod columns stay `[ ]` until cutover (WF-9 — never pre-mark prod).**

---

## Cross-cutting env vars

| Task | Dev | Staging | Prod |
|---|---|---|---|
| `JWT_SECRET` (rotate per env, ≥32 bytes non-dev) | [x] | [ ] | [ ] |
| `COOKIE_DOMAIN` (`localhost` dev, `.classlite.app` prod) | [x] | [ ] | [ ] |
| `CORS_ORIGINS` | [x] | [ ] | [ ] |
| `APP_APEX_HOST` | [x] | [ ] | [ ] |
| `APP_POST_LOGIN_URL` | [x] | [ ] | [ ] |
| `APP_LOGIN_ERROR_URL_BASE` | [x] | [ ] | [ ] |
| Sentry DSNs (`SENTRY_DSN`, `VITE_SENTRY_DSN`, `RELEASE_SHA`) — see **Sentry (Story 11-0a)** above | → | → | → |
| `/etc/hosts`: `127.0.0.1 classlite.localhost my.classlite.localhost` | [ ] | — | — |

---

## Not yet needed (future stories)

- `POLAR_API_KEY`, `POLAR_WEBHOOK_SECRET` (Epic 9)
- Google Drive integration (FU-2-5-D)
- Zoom integration (FU-2-5-E)
- Encryption key rotation runbook (FU-2-5-L)

## Billing — Plan Tiers & Enforcement (Story 9.1a)

The plan-limit + AI-credit **enforcement gates are DARK-LAUNCHED** behind a flag (D19). The
schema (`subscriptions`/`ai_credits`), the credit accounting, and the Owner-only read API all
ship LIVE regardless; only the hard-block (409 `PLAN_LIMIT_EXCEEDED` / 402 `INSUFFICIENT_CREDITS`)
is gated. It stays **OFF in prod for 9-1a** and is turned ON by the 9.2 story that delivers the
upgrade exit — arming it earlier would brick a genesis-Free center with no way to upgrade.

| Task | Dev | Staging | Prod |
|---|---|---|---|
| `BILLING_ENFORCEMENT_ENABLED` env var (unset/false = gates are no-ops; `true` = enforce) | [-] | [ ] | [ ] |
| Set specific pilot/dogfood centers to Studio via the override seam (`SetPlan` / `scripts/seed.sh`) — for testing enforcement before 9.2 | [ ] | [ ] | [ ] |

- Leave `BILLING_ENFORCEMENT_ENABLED` **unset** (or `false`) in prod until Story 9.2 ships. Flip to `true` only alongside the upgrade path.
- No new third-party service in 9-1a (Polar arrives in 9.2). No new secret. No new DNS record.

## Polar.sh — Billing Payments (Story 9.2a)

The first real payment integration. ClassLite never touches raw card data — every charge runs
through Polar's hosted checkout, confirmed asynchronously by the signature-verified
`POST /api/webhooks/polar` receiver. The `internal/polar` client falls back to a deterministic
MOCK when `POLAR_API_KEY` is unset, so dev/staging/prod all boot without the key (and NO live
charge is possible until it is set). Secrets are never logged (R49 — `LogSummary` shows only a
`*_set` bool).

| Task | Dev | Staging | Prod |
|---|---|---|---|
| `POLAR_API_KEY` (unset => mock client, no live charges) | [-] | [ ] | [ ] |
| `POLAR_WEBHOOK_SECRET` (Standard-Webhooks HMAC) + `POLAR_WEBHOOK_SECRET_PREVIOUS` (24h rotation window) | [-] | [ ] | [ ] |
| `POLAR_PRICE_*` (per tier×cycle + per add-on pack → Polar priced-entity ids) | [-] | [ ] | [ ] |
| Register the webhook endpoint `https://api.<domain>/api/webhooks/polar` in the Polar dashboard | [-] | [ ] | [ ] |
| Create the Polar products/prices (Pro/Studio monthly+annual, add-on packs 100/500/2000) | [-] | [ ] | [ ] |
| FU-9-POLAR-CONTRACT: record real-sandbox fixtures (cite date + API version) + a staging SMOKE against real Polar | [ ] | [ ] | [-] |

### ARMING PRECONDITIONS (D3/D29 — BOTH must hold before prod goes live)

1. **`BILLING_ENFORCEMENT_ENABLED` prod flip is DEFERRED to post-9-2b.** The gate stays **OFF in
   prod** until Story 9-2b has wired the staff-invite / class-create / AI-grade 409/402 dialog
   surfaces (FU-9-1B-DIALOG-WIRING) — a live gate must never fire with no UI to explain it. The
   FU-9-CONTRACT-402 provider-contract test (shipped in 9-2a) is a hard precondition on the flip.
2. **Live `POLAR_API_KEY` stays UNSET in prod until 9-2b ships the purchase UI.** Otherwise the
   owner-gated `POST /api/billing/checkout` could take REAL money with no product wrapper. Until
   then the mock/sandbox client serves and no live charge is possible.

- The webhook route BYPASSES the shared `originMW` + global `RateLimit` (D27 — a Polar S2S POST
  carries no `Origin`); it is signature-authenticated + body-capped. No code change needed, but
  do not "fix" its missing Origin check — that is intentional.
- VN VAT e-invoice compliance (epic:120 — "Polar-generated invoice uses standard Vietnamese VAT
  format") is an **ops/legal open question** (owner: Ducdo/ops), verified by NO 9-2a AC — not a
  code item (D29c).

---

## Calibration gold set (Story 11-0b)

The AI-grading calibration harness MEASURES the shipped grader (6-2a writing) against a frozen,
examiner-banded gold set. The **mechanism** (schema, loader, the four assertions, the perturbation
teeth self-test, the report renderer) ships in code and runs green in CI with synthetic anchors.
The **real-data run** is manual, build-tagged, and gated — it spends Gemini credits, so it never
runs in CI. This section is the one-time toil to make the real run possible; **running the
mechanism needs no code change once the dataset is placed and the key is set** (AC8).

> **Nothing here commits student work or copyrighted samples.** Real essays (minors) + published
> Cambridge/IDP samples live ONLY under `CALIBRATION_DATASET_DIR` (gitignored). The committed
> manifest carries examiner bands + metadata + per-sample content **hashes**, never raw content
> (R-11-6 / DD2). Generated reports under `_bmad-output/test-artifacts/calibration/` are gitignored.

### Dataset assembly (OQ-11-5 — two milestones, DD7)

| Task | Dev | Staging | Prod |
|---|---|---|---|
| **Interim (sanity, NOT done):** obtain published Cambridge/IDP writing samples with examiner bands | [ ] | [-] | [-] |
| **Authoritative (the DONE gate):** teacher-band the center's own **bands-4-6** submissions (a pilot byproduct — matures through the L1 pilot) | [ ] | [-] | [-] |
| Inter-rater overlap (AC9/DD9): ≥5 of the 4–6 scripts banded by **both** center teacher **and** a certified examiner; agreement reported ([template](../_bmad-output/test-artifacts/calibration/inter-rater-overlap-template.md)) | [ ] | [-] | [-] |
| Stratify per half-band (≥3 per bucket across the range students sit — AC1) | [ ] | [-] | [-] |

### Placing the dataset

1. Create a directory OUTSIDE the repo (or a gitignored `calibration-dataset/` inside it).
2. Put each sample's essay text in its own file (e.g. `content/<id>.txt`).
3. Write `<dir>/manifest.json` — same shape as the committed synthetic anchors
   (`classlite-api/internal/calibration/testdata/goldset-anchors.json`): per sample `id`, `skill`
   (`writing`), `source` (`cambridge`|`idp`|`center`), `examinerOverall`, `examinerCriteria`
   (keyed `taskResponse`/`coherenceCohesion`/`lexicalResource`/`grammaticalRange`), `language`
   (`en` — the product emits no Vietnamese output, DD6), `contentRef` (path relative to the dir),
   `contentHash` (sha256 hex of the content file), and `piiProbes` (the student's known
   name/email/phone — the harness asserts these NEVER appear in feedback, AC4).
4. Compute each hash exactly as the loader verifies it: `shasum -a 256 content/<id>.txt` (or
   `calibration.HashContent`). A hash mismatch at run start is a HARD ERROR, never a silent
   re-baseline (AC6/DD2).

### Running the real-data calibration

```sh
GEMINI_API_KEY=<key> \
CALIBRATION_DATASET_DIR=/abs/path/to/goldset \
CALIBRATION_RUN_DATE=$(date +%F) \
  go test -tags=calibration ./internal/calibration/ -run Calibration -v
```

- Without `GEMINI_API_KEY` **or** `CALIBRATION_DATASET_DIR`, the run **LOUD-SKIPs** (CI stays
  green, no credits). The `calibration` build tag keeps it out of the default suite entirely.
- Report is written to `_bmad-output/test-artifacts/calibration/calibration-report-<date>.md`
  (override the dir with `CALIBRATION_REPORT_DIR`). It carries per-criterion + overall band
  deltas, MAE per band bucket, worst miss, over-score direction, and stability.
- A Gemini 429/network/timeout is a **transport failure** (retried, then skipped) — NEVER a
  quality red (DD10). The quality numbers are recorded **evidence**, not a CI gate (DD7).

### Pinned tolerances (DD5 — override only with a written reason)

| Const | Value | Meaning |
|---|---|---|
| `PerCriterionTol` | 1.0 | HARD accuracy gate: `|AI − examiner|` per criterion, **inclusive** (≤1.0 passes; Ducdo ruling 2026-10-12) |
| `OverallBandTol` | 0.5 | SECONDARY overall-band check (averaging hides compensating per-criterion errors) |
| `MaxAcceptableMAE` | 0.5 | ABSOLUTE examiner-truth floor (the DONE gate — NOT a self-baseline) |
| `StabilityReGrades` | 5 | re-grades of one sample (range-of-3 is a biased spread estimator) |
| `StabilityCriterionRangeTol` | 1.0 | per-criterion regrade range gate |
| `StabilityOverallStddevTol` | 0.25 | overall-band stddev gate |

> **Temperature (AC2/Task-4b):** the shipped writing worker sends **no temperature** to Gemini
> (`gemini.GenerateRequest` has no temperature field; the request config sends only
> `responseMimeType` + `maxOutputTokens`), so the model default (≈1.0 for `gemini-2.0-flash`)
> governs run-to-run variance. Stability is therefore partly a sampler property; if AC2 fails,
> pinning temperature in the worker is the candidate fix — a grading-behaviour change, a separate
> story, out of 11-0b scope.

### The VN-teacher parent-veto (AC7/DD6)

When real feedback exists, a bilingual teacher gives a **binary veto + reason** ("would you let
this go home to a parent — yes/no; if no, why"), NOT a numeric score. Capture it in the
[parent-veto template](../_bmad-output/test-artifacts/calibration/parent-veto-template.md). The
product emits no Vietnamese output today (DD6 → **FU-11-0B-VN-FEEDBACK**).

### Closing to `done` (DD7)

11-0b holds at **`review`** (knowingly, through the pilot if need be) until the **authoritative**
bands-4-6 run passes (AC1 per-criterion within tolerance + MAE under the absolute floor), is
**stable** (AC2), its own banding is **inter-rater-checked** (AC9), and the **parent-veto** (AC7)
is captured. The interim published-anchor run is a sanity checkpoint only (necessary-not-sufficient
— the samples skew high and are plausibly in training data).

---

## Local resource budget (Story 11-1a / AC5 / DD10)

The full stack can OOM a developer laptop if every service plus a Vite dev server
plus a multi-worker Playwright run compete for memory at once (it happened
2026-09-27). Run within this budget:

| Component | How to run locally | Notes |
|---|---|---|
| Postgres | `docker compose up postgres` (the shared container) | One instance; the Go suite runs against the disposable `classlite_test`, not `classlite_dev`. |
| API | `go run ./cmd/api` (or `scripts/dev.sh`) | Single process. |
| Web | **built preview**, not the dev server: `cd classlite-web && npm run build && npm run preview` | The Vite **dev** server is NOT used under test — it holds the whole module graph in memory and is the biggest single contributor to OOM (epic-11.md:424). |
| Playwright | `--workers=1` locally | One browser worker. The full multi-worker matrix is **CI-only**; locally run a documented subset (a single project/spec) so you never fan out N Chromium processes on a laptop. |

**Go tests** run against the disposable `classlite_test` database, which `TestMain`
(internal/test) creates and migrates automatically — no separate step. The DB is
dropped/recreated cheaply; nothing accumulates in your `classlite_dev`.

**Destructive dev-DB reset** (wipe all app data) is guarded by three POSITIVE
proofs (DD13) and refuses to run otherwise:

```bash
# Only proceeds when the target PROVES it is disposable:
#   (1) database name is literally classlite_test,
#   (2) the __disposable_fixture_db__ sentinel object exists, AND
#   (3) an explicit opt-in is set.
ALLOW_DESTRUCTIVE_RESET=1 \
  DATABASE_URL="postgres://classlite:...@localhost:5432/classlite_test?sslmode=disable" \
  go run ./cmd/seed -destructive
```

It never relies on prod-shape URL detection (which fails open the first time
staging looks local-ish); a production database cannot grow the sentinel and is
refused.

### Real-auth E2E lane (Story 11-2)

The authenticated Playwright projects log in through the real
`POST /api/auth/login` and capture the real `refresh_token`. Three hard
preconditions (asserted fail-fast in `auth.setup.ts`, not just documented):

| Precondition | Why | How |
|---|---|---|
| **Seeded API on `:8080`** | Playwright's `webServer` starts only Vite; the API is not started for you, and the login manifest comes from the seed. | From the repo root: `./scripts/seed.sh` (reads `DATABASE_URL` from `.env`, runs `cmd/seed`, emits `classlite-web/tests/e2e/.auth/credentials.json`), then `cd classlite-api && go run ./cmd/api` with the two env vars below. |
| **`COOKIE_DOMAIN=.classlite.localhost`** on the API | The dev default emits an explicit `Domain=localhost`, whose reach to `my.classlite.localhost` is RFC-6265-ambiguous → a silent logged-out boot. The explicit `.classlite.localhost` domain-matches every `*.classlite.localhost` host. | Set on the API process **and** exported in the Playwright shell (the cross-subdomain cookie specs skip-with-reason when it is unset). |
| **`APP_ENV=development`** on the API | Any other value flips the refresh cookie to `Secure`, which `http://…localhost` can't send → again a silent logged-out boot. | Set on the API process. |
| **`CORS_ORIGINS`** includes the E2E hosts | The server's `OriginCheck` 403s any state-changing POST (incl. `/api/auth/login` + `/api/auth/refresh`) whose `Origin` is not allow-listed; the default `http://localhost:5173` does not cover `*.classlite.localhost`. | `CORS_ORIGINS=http://my.classlite.localhost:5173,http://classlite.localhost:4321` on the API. The harness sends an explicit `Origin` on its login POSTs (an APIRequestContext sends none by default). |

Run the authenticated lane with `--workers=1` (see the Playwright row in the
resource budget above and `classlite-web/tests/e2e/README.md`): a persisted
`refresh_token` is single-use against the rotating refresh endpoint, so the
authenticated projects must serialize. The WF-8 unit gate needs none of this —
`cd classlite-web && npx tsc -b && npx vitest run tests/e2e/lib`.
