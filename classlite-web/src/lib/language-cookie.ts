/**
 * language-cookie — UX-DR17 cross-subdomain handoff (dashboard half).
 *
 * The `lang` cookie carries the user's chosen language across the
 * landing site (`classlite.app`, Astro) and the dashboard
 * (`my.classlite.app`, this codebase). Both subdomains share the cookie
 * by setting `Domain=.classlite.app` (or `.classlite.localhost` in dev).
 *
 * The cookie is NOT a session credential — it's a preference. We
 * deliberately omit the `Secure` attribute so the dev surface
 * (`http://*.classlite.localhost`) can write it; production HTTPS
 * accepts `SameSite=Lax` cookies regardless of `Secure`.
 *
 * Story 1.10 (Astro landing) writes this cookie on the landing-site
 * language toggle. Story 1-7c (this file) reads it on dashboard boot
 * and writes it from the dashboard's `LanguageToggle`.
 */

import { computeCookieDomain } from './cookie-domain'

export type Language = 'en' | 'vi'

const COOKIE_NAME = 'lang'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * Compute the cookie `Domain` attribute for the current host. Delegates
 * to `cookie-domain.ts:computeCookieDomain` — the lang cookie and the
 * `logged_in` hint cookie (Story 1.10) share this Domain decision so
 * both surfaces hand off cleanly across subdomains.
 */
export { computeCookieDomain as languageCookieDomain }

/**
 * Read the `lang` cookie value. Returns `null` when absent or malformed.
 *
 * Safe to call at module load (the i18n.ts seed reads via this) — both
 * Node and browser environments are guarded.
 */
export function readLanguageCookie(): Language | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`),
  )
  const value = match?.[1]
  if (value === 'en' || value === 'vi') return value
  return null
}

/**
 * Write the `lang` cookie. Idempotent — re-writes the same value cheap.
 */
export function writeLanguageCookie(value: Language): void {
  if (typeof document === 'undefined') return
  const domain = computeCookieDomain()
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
  ]
  if (domain) parts.push(`Domain=${domain}`)
  document.cookie = parts.join('; ')
}
