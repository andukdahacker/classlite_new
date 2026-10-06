/**
 * formatVnDateLong — render an ISO date-time as a long, human day like `12 Oct 2026`
 * (Story 9.3, M7 / TS-6), in the center's Vietnam-local wall clock.
 *
 * Distinct from `formatVnDate` (short `dd/MM/yyyy`): the grace-strip day-7 deadline reads
 * better as a spelled-out month, and it must be DERIVED from the raw `graceEndsAt` ISO string
 * — never a server-baked `deadlineLabel` (M7: a vi owner would otherwise see a non-localized
 * English date). Wired into the i18n layer as the `{{val, vnDateLong}}` format token. A
 * malformed value returns unchanged so a bad wire string never renders `Invalid Date`.
 */
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'

/** formatVnDateLong formats an ISO string as e.g. `12 Oct 2026` in VN-local time. */
export function formatVnDateLong(iso: string, locale: string): string {
  const parsedMs = Date.parse(iso)
  if (Number.isNaN(parsedMs)) return iso
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: VN_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsedMs)
}
