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
