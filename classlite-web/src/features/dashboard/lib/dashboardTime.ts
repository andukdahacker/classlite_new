/**
 * dashboardTime — the serverTime clock for every relative-time affordance on
 * the role dashboards (Story 8-1b, D16). ALL of these take the envelope's
 * `meta.serverTime` as the reference instant and NEVER read `Date.now()` /
 * `new Date()` — the server already tz-bucketed the day/week, and using the
 * client wall-clock would reintroduce the skew + hydration bugs TS-6 forbids.
 *
 * `Date.parse` on the ISO wire strings is arithmetic (diff math against
 * serverTime), not locale formatting — the i18n formatter still owns any
 * absolute date rendering.
 */
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

/**
 * True when `serverTime` falls in the half-open `[startsAt, endsAt)` window —
 * the owner "live now" test (D16). A session that has ended (serverTime ===
 * endsAt) is NOT live.
 */
export function isLiveNow(
  startsAt: string,
  endsAt: string,
  serverTime: string,
): boolean {
  const now = Date.parse(serverTime)
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)
  if (Number.isNaN(now) || Number.isNaN(start) || Number.isNaN(end)) {
    return false
  }
  return start <= now && now < end
}

/**
 * A compact magnitude+unit for a duration in milliseconds — `{ count, unit }`
 * so the caller resolves the i18n string (`dashboard.time.*`) with the count
 * interpolated. Rounds DOWN to the coarsest whole unit (90 min → "1h").
 */
export interface CompactDuration {
  count: number
  unit: 'now' | 'minutes' | 'hours' | 'days'
}

export function compactDuration(ms: number): CompactDuration {
  // Guard against a NaN delta (an unparseable wire timestamp): without this the
  // `abs < …` comparisons are all false and the fall-through yields count NaN →
  // "NaNd ago"/"NaNd left" in the UI. Degrade to "now" rather than render NaN.
  if (Number.isNaN(ms)) return { count: 0, unit: 'now' }
  const abs = Math.abs(ms)
  if (abs < MS_PER_MINUTE) return { count: 0, unit: 'now' }
  if (abs < MS_PER_HOUR) {
    return { count: Math.floor(abs / MS_PER_MINUTE), unit: 'minutes' }
  }
  if (abs < MS_PER_DAY) {
    return { count: Math.floor(abs / MS_PER_HOUR), unit: 'hours' }
  }
  return { count: Math.floor(abs / MS_PER_DAY), unit: 'days' }
}

/** Elapsed since `pastISO` measured against serverTime (question "N ago"). */
export function elapsedSince(pastISO: string, serverTime: string): CompactDuration {
  return compactDuration(Date.parse(serverTime) - Date.parse(pastISO))
}

/**
 * Remaining until `deadlineISO` measured against serverTime (due countdown).
 * `overdue` is true once serverTime has passed the deadline.
 */
export interface Countdown extends CompactDuration {
  overdue: boolean
}

export function remainingUntil(deadlineISO: string, serverTime: string): Countdown {
  const delta = Date.parse(deadlineISO) - Date.parse(serverTime)
  return { ...compactDuration(delta), overdue: delta < 0 }
}

// ---------------------------------------------------------------------------
// Zoned display helpers. These render a UTC instant in the CENTER's timezone
// for the week-strip labels. This is presentation (showing an instant in local
// time), NOT re-bucketing which sessions belong to the week — that membership
// is server-owned (D16). `en-CA` yields an ISO-ordered `YYYY-MM-DD` day key.
// ---------------------------------------------------------------------------
const DAY_KEY_FORMAT = { year: 'numeric', month: '2-digit', day: '2-digit' } as const
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false } as const

/**
 * The week-strip day-column anchoring (D5, 8-1b review):
 *   - `'today'` → 7 columns starting at the caller's zoned "today" (student
 *     `upcomingSessions`, a rolling `[now, now+7d)` window).
 *   - `'week'` → 7 columns starting at the Monday of the caller's zoned week
 *     (teacher `weekSessions`, the `[startOfWeek, +7d)` calendar-week window the
 *     backend `computeBounds` sends). Without this, a today-anchored strip drops
 *     this-week's already-passed sessions and renders phantom empty future days.
 */
export type WeekStripAnchor = 'today' | 'week'

/** `YYYY-MM-DD` for an ISO instant in the given IANA timezone (`''` on a bad ISO). */
export function zonedDayKey(iso: string, timezone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-CA', { ...DAY_KEY_FORMAT, timeZone: timezone }).format(ms)
}

/** `HH:MM` (24h) for an ISO instant in the given IANA timezone (`''` on a bad ISO). */
export function zonedTimeLabel(iso: string, timezone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-GB', { ...TIME_FORMAT, timeZone: timezone }).format(ms)
}

/** Day-of-month digits (`1`..`31`) for an ISO instant in the given timezone (`''` on a bad ISO). */
export function zonedDayOfMonth(iso: string, timezone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: timezone }).format(ms)
}

/**
 * The `YYYY-MM-DD` day keys for the 7 columns of the week strip, anchored per
 * `anchor` (default `'today'`). `[]` when `serverTime` is unparseable (degrade to
 * an empty strip rather than throw inside `Intl.format`).
 */
export function weekDayKeys(
  serverTime: string,
  timezone: string,
  anchor: WeekStripAnchor = 'today',
): string[] {
  const todayKey = zonedDayKey(serverTime, timezone)
  if (todayKey === '') return []
  let startMs = Date.parse(`${todayKey}T00:00:00.000Z`)
  if (anchor === 'week') {
    // Monday-based week start, mirroring the backend `(Weekday()+6)%7` (D8).
    const dayOfWeek = new Date(startMs).getUTCDay() // 0=Sun … 6=Sat
    const daysSinceMonday = (dayOfWeek + 6) % 7
    startMs -= daysSinceMonday * MS_PER_DAY
  }
  const keys: string[] = []
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    keys.push(new Date(startMs + dayOffset * MS_PER_DAY).toISOString().slice(0, 10))
  }
  return keys
}
