/**
 * formatStaffDateTime — Story 7.1b (TS-6). Localizes a date-time wire string
 * (RFC3339, e.g. `2026-08-29T10:00:00Z`) via `Intl.DateTimeFormat` at render
 * time. Dates stay ISO on the wire and are formatted only here — never
 * `new Date(iso).toLocaleString()` scattered in a render path (TS-6).
 *
 * Used for the roster `lastActiveAt` timestamp and the s40 schedule-glance
 * start/end times. Falls back to the raw wire string when unparseable so a
 * malformed value never crashes a render. A `null` timestamp is the caller's
 * concern (roster/detail render the `people.staff.lastActive.never` token).
 */
export function formatStaffDateTime(iso: string, locale: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}
