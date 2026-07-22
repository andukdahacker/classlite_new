/**
 * formatSessionTime — Story 3.4 (TS-6). Localizes session date-time wire
 * strings (ISO date-time WITH offset) for display, pinned to the single app
 * render timezone so a teacher in any browser zone sees the center's clock.
 *
 * Session times are full instants (offset on the wire), so `new Date(iso)` is
 * the correct instant here — unlike date-ONLY strings (formatClassDate), which
 * must avoid UTC-midnight parsing. Rendering timeZone is pinned to keep the
 * grid consistent across viewer zones (v1 single-TZ; recurrenceTz captured for
 * a future per-center render story).
 */
const RENDER_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** "9:00 AM" — time of day only. */
export function formatSessionTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: RENDER_TIME_ZONE,
  }).format(date)
}

/** "Aug 16, 2026, 9:00 AM" — full date + time. */
export function formatSessionDateTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: RENDER_TIME_ZONE,
  }).format(date)
}

/** "9:00 AM – 10:30 AM" — start–end time range. */
export function formatSessionTimeRange(startIso: string, endIso: string, locale: string): string {
  return `${formatSessionTime(startIso, locale)} – ${formatSessionTime(endIso, locale)}`
}
