/**
 * formatBand — the ONE null-vs-0 formatter for every nullable analytics field
 * (Story 8-2b, D13 / R-C / AC6 / AC10). All 10 nullable contract fields render
 * through this single helper so the "NEVER 0" invariant is enforced in one place,
 * not re-reviewed at 10 call sites: a `null` becomes a localized "—" (a resolved
 * i18n key, never a hardcoded dash), a number becomes a LOCALE-correct string.
 *
 * Guards the co-primary-locale decimal bug: band 6.5 must render "6,5" in
 * Vietnamese, not "6.5" — so every numeral goes through the Intl number
 * formatter for the active `i18n.language` (the PageHead / formatFileSize
 * precedent), never `String(value)`.
 */
import i18n from '@/lib/i18n'

const DASH_KEY = 'analytics.placeholder.dash'

/** The localized "—" placeholder. A resolved i18n key (en+vi), never literal. */
function dash(): string {
  return i18n.t(DASH_KEY)
}

/**
 * Formats an IELTS band to one decimal place in the active locale, or the "—"
 * placeholder on `null`. Band `0` is a REAL score → "0.0", distinct from `null`.
 *
 * @param value - the band, or `null` for no score
 * @returns e.g. en "6.5" / vi "6,5", or the localized dash
 */
export function formatBandOrDash(value: number | null): string {
  if (value === null) return dash()
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * Formats a nullable numeric field, or the "—" placeholder on `null`. A `null`
 * rate is "—" (no assignments due), NEVER "0%" (a real zero on-time rate) — the
 * lie R-C guards.
 *
 * @param value - the value, or `null`
 * @param opts.style - `'percent'` treats `value` as a 0..1 fraction; default `'decimal'`
 * @returns the localized number (e.g. "82%"), or the localized dash
 */
export function formatOrDash(
  value: number | null,
  opts: { style?: 'decimal' | 'percent' } = {},
): string {
  if (value === null) return dash()
  const style = opts.style ?? 'decimal'
  if (style === 'percent') {
    return new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(value)
  }
  return new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  }).format(value)
}
