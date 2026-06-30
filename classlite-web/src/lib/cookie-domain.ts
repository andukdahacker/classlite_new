/**
 * cookie-domain — shared `Domain` attribute helper for non-credential
 * cross-subdomain cookies (Story 1.10 Task 1).
 *
 * ## Why this module exists
 *
 * Two cookies need to be readable on both `classlite.app` (Astro landing,
 * Story 1.10) and `my.classlite.app` (dashboard, Stories 1-7c + 1-9d):
 *
 *   1. `lang` — language preference (Story 1-7c). Written by both surfaces.
 *   2. `logged_in` — UX-DR18 hint cookie (Story 1.10). Written by the
 *      dashboard (`useHintCookieWrite`); read by landing's
 *      `<script is:inline>` to short-circuit authenticated visitors
 *      to the dashboard.
 *
 * Both cookies live on `Domain=.classlite.app` (or `.classlite.localhost`
 * in dev) so they're shared across the apex + every subdomain. The Domain
 * decision is identical for both — duplicating the logic across two
 * call sites invites silent drift, so it's centralized here.
 *
 * The landing site cannot import this file (WF-7 cross-service ban).
 * Instead, `classlite-landing/src/layouts/BaseLayout.astro` embeds a
 * **byte-identical** inline copy of the function body between the
 * `CL-COOKIE-DOMAIN-PARITY-START / END` sentinel comments below. The
 * landing CI (Story 1.10 Task 9.7 `check-cookie-domain-parity.mjs`)
 * fails on drift.
 *
 * ## Lax vs Strict asymmetry (the contract to remember)
 *
 *   - **Writes** (`writeLanguageCookie` / `useHintCookieWrite`) use
 *     `SameSite=Lax`. This is required so a top-level navigation from
 *     `classlite.app` → `my.classlite.app/dashboard` sends the cookie
 *     on the *first* cross-subdomain request. `Strict` would withhold
 *     the cookie on cross-site navigations and break the handoff.
 *
 *   - **Clears** (`LoginPage` defensive clear in Story 1-9d) use
 *     `SameSite=Strict`. This is safe because the clear executes
 *     same-site on `my.classlite.app` — no cross-site request is
 *     involved. The Strict attribute on the clear matches the rest of
 *     the dashboard's defensive-clear convention.
 *
 * Both flavors target the same `Domain`, which is why the helper
 * doesn't need to know the operation — it only computes the host.
 *
 * ## Hosts handled
 *
 *   - `classlite.app` / `*.classlite.app`       → `.classlite.app`
 *   - `classlite.localhost` / `*.classlite.localhost` → `.classlite.localhost`
 *   - everything else (bare `localhost`, jsdom, Codespaces, IP literals)
 *     → `null` (no Domain attribute; cookie defaults to current host)
 */

/* CL-COOKIE-DOMAIN-PARITY-START */
export function computeCookieDomain(): string | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
    .toLowerCase()
    .replace(/\.$/, '')
  if (host === 'classlite.app' || host.endsWith('.classlite.app')) {
    return '.classlite.app'
  }
  if (
    host === 'classlite.localhost' ||
    host.endsWith('.classlite.localhost')
  ) {
    return '.classlite.localhost'
  }
  return null
}
/* CL-COOKIE-DOMAIN-PARITY-END */
