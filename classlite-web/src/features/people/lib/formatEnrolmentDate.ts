/**
 * Enrolment history date formatters — Story 7.3b (TS-6). Dates stay ISO on the
 * wire and are localized only at render via `Intl.DateTimeFormat` (never a raw
 * `new Date(iso)` in a JSX text node). Two shapes:
 *
 *   - `effectiveDate` is date-only (`YYYY-MM-DD`) → pin to LOCAL midnight so the
 *     boundary doesn't slip ~7h early in Asia/Ho_Chi_Minh (UTC+7), mirroring the
 *     shipped `formatClassDate` precedent.
 *   - `performedAt` is a full timestamp (`…Z`) → a genuine instant, formatted
 *     with date + time in the viewer's locale/zone (mirrors `formatSessionTime`).
 *
 * Both fall back to the raw wire string when unparseable.
 */

function parseIsoDateLocal(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Formats a date-only wire string (`YYYY-MM-DD`), or returns `iso` verbatim. */
export function formatEnrolmentDate(iso: string, locale: string): string {
  const date = parseIsoDateLocal(iso)
  if (!date) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** Formats a full timestamp (`…Z`) with date + time, or returns `iso` verbatim. */
export function formatEnrolmentDateTime(iso: string, locale: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant)
}
