/**
 * sanitizeNextParam — Story 1-9d AC4 (R-NEW=15 open-redirect discharge, OWASP CWE-601).
 *
 * The `?next=` param on `/login?session_expired=1&next=...` carries the URL the
 * user was on when silent refresh failed (set by `auth-refresh.ts:onAuthFailure`
 * at lines 293-317). The post-login `navigate()` consumer reads it via this
 * sanitizer; without the whitelist, `/login?session_expired=1&next=//evil.example.com`
 * lands the post-login navigate on an external origin.
 *
 * The whitelist is strictly intra-origin path:
 *   1. `null` / empty → `/dashboard` fallback
 *   2. Malformed `decodeURIComponent` → `/dashboard` fallback
 *   3. Must start with `/`
 *   4. Must NOT start with `//` (protocol-relative open-redirect)
 *   5. Must NOT start with `/\` (back-slash protocol-relative variant)
 *   6. Must NOT have leading whitespace/control chars after the leading slash
 *      that HTML5 URL parsers strip before the protocol check
 *
 * See SEC-5 (CORS allowlist) for the analogous explicit-allowlist posture on
 * the network side; this helper extends the same posture to client-side
 * navigation redirects.
 */
export function sanitizeNextParam(raw: string | null): string {
  if (!raw) return '/dashboard'
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/dashboard'
  }
  if (!decoded.startsWith('/')) return '/dashboard'
  if (decoded.startsWith('//')) return '/dashboard'
  if (decoded.startsWith('/\\')) return '/dashboard'
  // Leading-whitespace / control-char ratchet (Murat M2 BLOCKER pin) — HTML5
  // URL parsers strip tab / space / NUL / leading-CRLF BEFORE the protocol
  // check, so `/\t//evil` decodes to a string that passes startsWith('/')
  // but the consumer router may follow it as protocol-relative. The
  // \x00-\x1f range is intentional — those are the exact bytes the
  // URL-parser preamble strips.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\x00-\x1f]/.test(decoded.slice(1, 3))) return '/dashboard'
  return decoded
}

/**
 * postLoginTarget — where to send a user after login / boot-probe hydrate.
 *
 * A user with no center (`center == null`) has not completed onboarding and CANNOT use the
 * dashboard (no tenant → role-less guest shell + 403 data). Routing them to `/dashboard` (the
 * sanitizeNextParam default) produced the dashboard↔login flicker loop: a freshly-verified user
 * who logs in fresh (not via the register flow, which DOES enter the wizard) lands on a broken
 * dashboard that bounces to /login, where the still-valid session bounces back. Send them into
 * the onboarding wizard instead. The symmetry is intentional: `OnboardingLayout` already guards
 * the other direction (`session.center != null` → `/dashboard`), so a user who DOES have a
 * center that somehow reaches `/welcome` bounces straight back — the two guards can't deadlock.
 *
 * Everyone with a center honors their sanitized `?next=` (default `/dashboard`).
 */
export function postLoginTarget(center: unknown, nextParam: string | null): string {
  if (center == null) return '/welcome'
  return sanitizeNextParam(nextParam)
}
