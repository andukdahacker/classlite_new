/**
 * relativeTime — Story 10-1b DD4 / Task 3.2.
 *
 * Threshold logic for the inbox row timestamps ("just now" / "2m ago" /
 * "3h ago" / "5d ago"), falling back to the absolute `vnDate` (`dd/MM/yyyy`)
 * past ~7 days. Renders through the i18n `inbox.time.*` catalog rather than a
 * raw `Intl.RelativeTimeFormat` so every user-facing string stays under the
 * R38 parity ratchet (VN co-primary — UX-2); the `{{val, relativeTime}}`
 * formatter in `src/lib/i18n.ts` wraps this function.
 *
 * Placed in `src/lib/` (core) rather than `features/inbox/lib/` so the
 * formatter registration in `i18n.ts` imports it without a core→feature edge.
 * TS-6: the raw ISO stays a string until this formatter; the only date parse
 * here is for the diff, never for display (display routes through formatVnDate).
 */
import { formatVnDate } from '@/lib/formatVnDate'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

/** Minimal translator shape — `i18n.t` / `i18n.getFixedT(lng)` both satisfy it. */
type Translator = (key: string, options?: Record<string, unknown>) => string

/**
 * relativeTime renders `iso` as a locale-aware relative label.
 *
 * @param iso raw ISO timestamp (the notification `createdAt`)
 * @param t translator bound to the target locale
 * @param lng locale code (for the >7-day absolute-date fallback)
 * @param now epoch ms "now" (injectable for deterministic tests)
 */
export function relativeTime(
  iso: string,
  t: Translator,
  lng: string = 'en',
  now: number = Date.now(),
): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  if (diff < MINUTE_MS) return t('inbox.time.justNow')
  if (diff < HOUR_MS) return t('inbox.time.minutes', { count: Math.floor(diff / MINUTE_MS) })
  if (diff < DAY_MS) return t('inbox.time.hours', { count: Math.floor(diff / HOUR_MS) })
  if (diff < WEEK_MS) return t('inbox.time.days', { count: Math.floor(diff / DAY_MS) })
  return formatVnDate(iso, lng)
}
