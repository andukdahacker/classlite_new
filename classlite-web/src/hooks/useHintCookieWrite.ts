/**
 * useHintCookieWrite — UX-DR18 cross-subdomain handoff (dashboard half).
 *
 * Writes `logged_in=1` on `.classlite.app` whenever the user is
 * authenticated, so the Astro landing site (`classlite.app`) can
 * short-circuit authenticated visitors straight to
 * `my.classlite.app/dashboard` via a `<script is:inline>` cookie read
 * in its `<head>` (Story 1.10 AC4a).
 *
 * ## Contract (Story 1.10 AC4c + AC4d)
 *
 *   - Fires when `useAuth().isAuthenticated` is `true` AND the per-mount
 *     `useRef<boolean>(false)` latch has not yet flipped. Under React 19
 *     `<StrictMode>`, the pass-2 effect invocation within a single
 *     mount sees the ref set and skips the duplicate write — so a
 *     single mount with `isAuthenticated === true` yields exactly ONE
 *     cookie write.
 *   - The latch lives in `useRef`, so a fresh mount creates a fresh
 *     ref. Re-mounting with `isAuthenticated === true` re-writes the
 *     cookie. This is the recovery path for a user who manually cleared
 *     the cookie via DevTools — the next remount asserts it again.
 *   - When a sibling tab broadcasts `login-succeeded` on the
 *     `BroadcastChannel('classlite_auth')` carried by
 *     `auth-refresh.ts`, this tab's `useAuth` hydrates from cache, this
 *     hook's effect re-runs, and the cookie write fires here too — so
 *     a user who logs in on tab A also gets the hint cookie set from
 *     tab B (Amelia STRONG #10).
 *
 * ## Cookie shape (the load-bearing contract)
 *
 *   `logged_in=1; Max-Age=31536000; Path=/; SameSite=Lax; Domain=<computed>`
 *
 * Domain comes from `cookie-domain.ts:computeCookieDomain` so it
 * mirrors the `lang` cookie byte-for-byte. `Lax` (not `Strict`) because
 * the landing site at `classlite.app` is a cross-site read relative to
 * `my.classlite.app` — `Strict` would withhold the cookie on the very
 * navigation that needs it. The 1-9d defensive clear at
 * `LoginPage` uses `SameSite=Strict` and `Max-Age=0`; that asymmetry
 * is intentional and documented in `cookie-domain.ts`.
 *
 * No `Secure` attribute — matches `language-cookie.ts` for the dev
 * surface (`http://*.classlite.localhost`). The cookie is a UX hint,
 * not a credential — the real auth lives in `HttpOnly` JWT cookies set
 * by the backend.
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { computeCookieDomain } from '@/lib/cookie-domain'

const HINT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export function useHintCookieWrite(): void {
  const { isAuthenticated } = useAuth()
  const wroteForThisMount = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const domain = computeCookieDomain()

    if (!isAuthenticated) {
      /* Reset the latch so a subsequent re-login in the same mount
         re-asserts the cookie. Then clear `logged_in=1` so the landing
         page does not redirect a logged-out user back into the
         dashboard/landing bounce cycle. Same Domain + Path as the
         write so the browser deletes the same cookie record. P2 + P8
         from code review 2026-06-30. */
      wroteForThisMount.current = false
      const clearParts = ['logged_in=', 'Max-Age=0', 'Path=/', 'SameSite=Lax']
      if (domain) clearParts.push(`Domain=${domain}`)
      document.cookie = clearParts.join('; ')
      return
    }

    if (wroteForThisMount.current) return
    wroteForThisMount.current = true
    const parts = [
      'logged_in=1',
      `Max-Age=${HINT_COOKIE_MAX_AGE_SECONDS}`,
      'Path=/',
      'SameSite=Lax',
    ]
    if (domain) parts.push(`Domain=${domain}`)
    document.cookie = parts.join('; ')
  }, [isAuthenticated])
}
