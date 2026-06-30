# Landing Site — Inline Script Budget

_Story 1.10 Task 9.6 + Amelia BLOCKER #12. Enforced by the 0-JS-grep CI step at `ci-landing.yml` and the cookie-domain parity guard at `scripts/check-cookie-domain-parity.mjs`._

## Why this discipline exists

The Astro landing site is a static-HTML SEO surface. Every byte of JavaScript hurts the Core Web Vitals (LCP, CLS, TBT) of the conversion-critical first paint. The whole site ships ≤80 lines of inline JS — that's the budget.

There are **no Astro hydration directives** (`client:load`, `client:idle`, `client:visible`, `client:media`, `client:only`) anywhere under `src/`. A grep step in `ci-landing.yml` fails the build if one slips in without PM + reviewer sign-off.

## When to use `<script is:inline>` vs default `<script>`

| Pattern | Use when | Cost |
|---|---|---|
| `<script is:inline>` | The script MUST complete **before first paint** (cookie reads/writes, redirect decisions, `<html>` attribute setters for CSS reveal). | Lands raw in the HTML output, runs synchronously where placed. No bundling. Cannot import modules. |
| default `<script>` | The script only matters **post-mount** (scroll listeners, observers, post-paint UI behavior). | Becomes a deferred ES module — runs AFTER `DOMContentLoaded`. Bundles cleanly. Caches. |

Default Astro `<script>` is a deferred ES module — fine for non-blocking observers but **WRONG** for pre-paint cookie redirects (Amelia BLOCKER #12). A redirect placed in a default `<script>` causes a flash of landing-page paint before the bounce.

## The five inline scripts (≤80 lines total)

| # | Location | Discipline | Purpose | Line budget |
|---|---|---|---|---|
| 1 | `BaseLayout.astro` `<head>` ABOVE `<title>` | `is:inline` | AC4a hint-cookie redirect + AC4b `<html data-session-expired>` attribute setter (combined). MUST fire pre-paint. | ≤18 |
| 2 | `BaseLayout.astro` `<head>` bottom | `is:inline` | AC6 lang-cookie write. Must complete before CTA click; inline duplicate of `computeCookieDomain` (sentinel-guarded for parity with `classlite-web/src/lib/cookie-domain.ts`). | ≤15 |
| 3 | `PricingSection.astro` after the radio toggle | `is:inline` | AC6 billing-cycle hydration from `?billing=` URL param. Pre-paint to avoid a flash of monthly→annual swap. | ≤4 |
| 4 | `SessionExpiredBanner.astro` after the element | `is:inline` | AC4b `history.replaceState` URL-strip so refresh does not re-show the banner. | ≤3 |
| 5 | `StickyHeader.astro` after the markup | default `<script>` | AC3 IntersectionObserver scroll-state. Post-mount only — defer is fine. Wraps `transition: …` in `prefers-reduced-motion: no-preference` per AC9. | ≤30 |

Total budget: **≤80 lines** across the entire landing site.

## Reduced-motion discipline

Every `transition:` / `animation:` rule MUST be wrapped in `@media (prefers-reduced-motion: no-preference)`. The StickyHeader scroll-state observer also disables its transition via `style.transition = 'none'` when `(prefers-reduced-motion: reduce)` matches — instant state change, no animation.

## Cookie-domain parity

The lang-cookie inline script (#2) duplicates the body of `classlite-web/src/lib/cookie-domain.ts:computeCookieDomain` between the sentinel comments:

```
/* CL-COOKIE-DOMAIN-PARITY-START */
…
/* CL-COOKIE-DOMAIN-PARITY-END */
```

The CI script `scripts/check-cookie-domain-parity.mjs` (Task 9.7) extracts both bodies and asserts byte-identity. Drift fails the build with a readable diff. A future `@classlite/cookie-domain` workspace package would dedupe this — tracked as `1-10-followup-cookie-domain-package` (P2 per Winston STRONG).

## Asking permission to add JS

If a new feature genuinely needs an Astro hydration directive (`client:load` etc.) or pushes the inline JS budget past 80 lines:

1. Open an issue describing the failure mode of the 0-JS path.
2. Document the LCP / CLS / TBT impact measured locally.
3. PM (John) + a non-author reviewer must sign off in the PR before the 0-JS grep step is allowed an explicit `# allow-client-directive: <reason>` exemption.
4. Update this doc.

No silent slippage.
