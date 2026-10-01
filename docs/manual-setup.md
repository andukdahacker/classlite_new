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

## Cross-cutting env vars

| Task | Dev | Staging | Prod |
|---|---|---|---|
| `JWT_SECRET` (rotate per env, ≥32 bytes non-dev) | [x] | [ ] | [ ] |
| `COOKIE_DOMAIN` (`localhost` dev, `.classlite.app` prod) | [x] | [ ] | [ ] |
| `CORS_ORIGINS` | [x] | [ ] | [ ] |
| `APP_APEX_HOST` | [x] | [ ] | [ ] |
| `APP_POST_LOGIN_URL` | [x] | [ ] | [ ] |
| `APP_LOGIN_ERROR_URL_BASE` | [x] | [ ] | [ ] |
| `SENTRY_DSN` | [ ] | [ ] | [ ] |
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
