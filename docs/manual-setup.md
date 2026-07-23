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

- `GEMINI_API_KEY` (later stories)
- `POLAR_API_KEY`, `POLAR_WEBHOOK_SECRET` (Epic 9)
- Google Drive integration (FU-2-5-D)
- Zoom integration (FU-2-5-E)
- Encryption key rotation runbook (FU-2-5-L)
