/**
 * scheduleDates — the ONE named date utility for the schedule workspace
 * (Winston: no raw-`Date` week-start / boundary math). Wraps date-fns v4 (an
 * existing dependency — no new runtime dep) so week/month grid boundaries and
 * the [from, to) list window are computed in one place.
 *
 * Single app timezone (Asia/Ho_Chi_Minh, no DST) is the v1 rendering contract;
 * the grid math runs on local `Date` values and the wire carries ISO date-time
 * with offset, so instants are unambiguous.
 */
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format as dfFormat,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export type CalendarView = 'day' | 'week' | 'month'

// Weeks start Monday (IELTS-center norm). date-fns weekStartsOn: 1 = Monday.
const WEEK_STARTS_ON = 1 as const

// APP_TZ_OFFSET_MINUTES is the fixed offset of the single app render zone
// (Asia/Ho_Chi_Minh, no DST). Grid geometry and modal authoring anchor to it so
// layout + authored instants match the HCMC-pinned display for ALL browsers, not
// just +07:00 ones (CR-3-4 FD1). Mirrors the backend FixedZone (P5/P6).
export const APP_TZ_OFFSET_MINUTES = 7 * 60

/**
 * App-zone wall-clock parts of an ISO instant. Shifts the instant by the fixed
 * offset and reads UTC fields, so the returned hour/minute/day are the center's
 * clock regardless of the viewer's browser zone.
 */
export function appZoneParts(iso: string): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
} {
  const shifted = new Date(new Date(iso).getTime() + APP_TZ_OFFSET_MINUTES * 60000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  }
}

/**
 * Builds an ISO instant from an app-zone wall clock (date=YYYY-MM-DD, time=HH:mm).
 * The fixed +07:00 offset is exact (no DST), so a teacher who types "09:00"
 * always authors 09:00 center time no matter what zone their browser is in.
 */
export function appZoneWallClockToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+07:00`).toISOString()
}

/** True when an ISO instant falls on `day`'s calendar date in the app zone. */
export function isAppZoneSameDay(iso: string, day: Date): boolean {
  const p = appZoneParts(iso)
  return p.year === day.getFullYear() && p.month === day.getMonth() && p.day === day.getDate()
}

/** The inclusive day span rendered for a view anchored at `anchor`. */
export function visibleDays(anchor: Date, view: CalendarView): Date[] {
  switch (view) {
    case 'day':
      return [startOfDay(anchor)]
    case 'week': {
      const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
      return eachDayOfInterval({ start, end: endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }) })
    }
    case 'month': {
      // Full weeks covering the month so the grid is rectangular.
      const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
      const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
      return eachDayOfInterval({ start: gridStart, end: gridEnd })
    }
  }
}

/** The half-open [from, to) wire window (YYYY-MM-DD) that covers a view. */
export function rangeWindow(anchor: Date, view: CalendarView): { from: string; to: string } {
  const days = visibleDays(anchor, view)
  const first = days[0]
  const last = days[days.length - 1]
  return { from: toIsoDate(first), to: toIsoDate(addDays(last, 1)) }
}

/** Steps the anchor one period in `direction` (-1 prev, +1 next). */
export function stepAnchor(anchor: Date, view: CalendarView, direction: -1 | 1): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, direction)
    case 'week':
      return addDays(anchor, direction * 7)
    case 'month':
      return addMonths(anchor, direction)
  }
}

/** YYYY-MM-DD in local time (no UTC shift). */
export function toIsoDate(d: Date): string {
  return dfFormat(d, 'yyyy-MM-dd')
}

export { addDays, isSameDay, startOfDay }
