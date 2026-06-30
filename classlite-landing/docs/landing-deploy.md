# Landing Site — Deployment Notes

_Story 1.10 Task 8.8. CF Pages branch-to-env mapping, Functions pickup, allowlist governance._

## Cloudflare Pages branch-to-env mapping (Winston STRONG #8)

| CF Pages branch | Loads | `PUBLIC_DASHBOARD_URL` |
|---|---|---|
| Production (`main`) | `.env.production` | `https://my.classlite.app` |
| Preview branches | `.env` | `http://my.classlite.localhost:5173` (dev default) — override per preview if needed |

The `prebuild` hook runs `scripts/validate-dashboard-url.mjs`, which manually loads the matching `.env*` file based on `NODE_ENV`. CF Pages sets `NODE_ENV=production` on the production branch automatically; preview branches inherit `development`.

## CF Pages Functions pickup

`functions/index.ts` is the Cloudflare Pages Function handling the bare `/` route (Story 1.10 AC1 + R-NEW-54). CF Pages **auto-picks up the `functions/` directory at the project root** — no `wrangler.toml` config needed for default routing.

The Function reads `Accept-Language` at the edge per-request, parses q-weighted preferences (`prefer-Vi-on-tie` per UX-2), and 302s to `/vi/` or `/en/` with `Vary: Accept-Language`. The static HTML at `/vi/index.html` and `/en/index.html` is served by Astro's static output and passes through this Function untouched (only the bare `/` matches).

### Local dev with wrangler

To exercise the Function locally (needed to run `e2e/locale-redirect.spec.ts`):

```sh
npm run build
npx wrangler pages dev dist --port 8788
# in another terminal:
npm run test:e2e
```

The Playwright `webServer` block in `playwright.config.ts` automates this in CI.

## `PUBLIC_DASHBOARD_URL` allowlist (R-NEW-55)

The allowlist regex lives in `scripts/validate-dashboard-url.mjs`:

| Env | Regex |
|---|---|
| `production` | `^https:\/\/my\.classlite\.app$` |
| `development` (default) | `^https?:\/\/my\.classlite\.localhost(:\d+)?$` |

A misconfigured staging deploy (e.g., `PUBLIC_DASHBOARD_URL=https://phishing-classlite.example.com`) fails the build before any HTML lands in `dist/`. This is the load-bearing R-NEW-55 mitigation — Astro's `import.meta.env` would have silently accepted any string.

### Adding a new env (staging, etc.)

Adding a third environment requires:

1. A new `.env.staging` file with the staging URL.
2. Extending the regex in `validate-dashboard-url.mjs` to recognize the new pattern.
3. A PM-signed-off PR (the regex IS the allowlist; widening it is a security-relevant change).
4. Updating this doc.

## `/etc/hosts` for local cross-subdomain dev (Murat BLOCKER #3)

The cookie write to `Domain=.classlite.localhost` only matches subdomains under `*.classlite.localhost`. Bare `localhost` does NOT match. Add to `/etc/hosts`:

```
127.0.0.1 classlite.localhost my.classlite.localhost
```

Then access the landing at `http://classlite.localhost:4321/vi/` and the dashboard at `http://my.classlite.localhost:5173/`. The hint-cookie redirect cycle works end-to-end with these hosts.

## Followup deferrals

- `1-10-followup-og-images` — produce `og-image-{vi,en}.png` social-share assets. Marketing-owned.
- `1-10-followup-feature-illustrations` — replace FeatureCard SVG placeholders. Designer-owned.
- `1-10-followup-legal-pages` — real Terms / Privacy content. Legal-owned.
- `1-10-followup-zalo-link` — real Zalo support contact ID. Ops-owned.
- `1-10-followup-cookie-domain-package` — extract `@classlite/cookie-domain` workspace package to dedupe the triplication. Winston P2.
- `1-10-followup-font-preload-tuning` — verify Fraunces italic 400 preload path resolves under fontsource v5+ at production runtime; add additional weight preloads if Lighthouse flags FOUT/FOIT. Performance-owned.
