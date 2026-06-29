/**
 * sanitizeCenterName — Story 1-9c AC4 / Task 3.3 (Sally party-mode 2026-06-26).
 *
 * The `/invite/:token?c=centerName` query-param ribbon is sender-controlled —
 * the center owner embeds it in the email template they generate. We render
 * it as the H1 ("Join {{centerName}}" / "Tham gia {{centerName}}") when it
 * survives sanitization. There is NO backend preview-endpoint round-trip;
 * this is a pure cosmetic bridge between the email and the landing page so
 * the user sees the center name at the trust-critical moment rather than a
 * generic "You've been invited."
 *
 * The sanitization rules are conservative — accept what's plausibly a center
 * name, reject anything else:
 *
 *   1. `null` / empty / pure-whitespace → return `null` (page renders the
 *      generic `auth.invite.title` fallback H1).
 *   2. `.trim()` → Unicode `.normalize('NFC')` — normalizes Vietnamese
 *      diacritic composition so the regex character class matches.
 *   3. Length 1–60 chars (post-normalize).
 *   4. Character class `[\p{L}\p{N}\s\-'.]` — Unicode letters / digits /
 *      whitespace / hyphen / apostrophe / period only. Excludes `&`, `<`,
 *      `>`, `/`, `\`, `(`, `)`, `:`, `;`, `,`, `@`, `#`, `$`, `*`, emoji,
 *      null bytes, control chars, every other non-alphanumeric.
 *
 * Why reject `&` and `()`: real center names often contain those (e.g.
 * "IELTS & Friends"), but the conservative-default value is higher than
 * the edge-case coverage value. A center owner whose name fails
 * sanitization sees the generic H1 instead — no broken render, no XSS
 * surface. Story 7-1 (real staff-invite delivery) can revisit if we land
 * a server-side endpoint that gives us a verified name.
 *
 * The regex is the ONLY ratchet against the value reaching the DOM —
 * we render the result via React's text node (auto-escaped), so the
 * regex is defense-in-depth, not the sole XSS gate.
 */

const CENTER_NAME_REGEX = /^[\p{L}\p{N}\s\-'.]{1,60}$/u

export function sanitizeCenterName(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const normalized = trimmed.normalize('NFC')
  if (!CENTER_NAME_REGEX.test(normalized)) return null
  return normalized
}
