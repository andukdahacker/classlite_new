/**
 * weekAxis — the ONE shared pure `week → x` mapping both analytics charts
 * consume (Story 8-2b, D14d / AC16 / AC22b). `SkillWeekHeatmap` and
 * `BandTrendChart` build their x-axis from the SAME `createWeekAxis(weeks,
 * width)` so a criterion dip in the heatmap sits in the exact column as the
 * cohort-trend point for that week — alignment BY CONSTRUCTION, not by a shared
 * pixel scale. Unit-testable in isolation (weekAxis.test.ts) so a lazy per-chart
 * axis can't fake the shared-function guarantee.
 *
 * Pure geometry only — no React, no `Date` (weekStart stays an ISO string per
 * TS-6; the axis maps by ordinal position, never by parsed calendar math).
 */

/** The inner plot width both charts pass to `createWeekAxis` so their per-week
 *  x-coordinates are identical (the alignment contract, AC22b). */
export const DEFAULT_CHART_WIDTH = 320

export interface WeekAxis {
  /** Center x for that week's column (heatmap) / point (sparkline). */
  x(weekStart: string): number
  /** Px between adjacent week centers. */
  step: number
  weeks: readonly string[]
}

/**
 * Builds a week axis over `weeks` across `innerWidth` px. `x()` is monotonic
 * increasing in `weeks` order, deterministic (same args → same x), and every
 * returned x lies within `[0, innerWidth]` (each week is centered in its own
 * equal-width column).
 *
 * @param weeks - ordered, dense, Monday-anchored week starts (ISO date strings)
 * @param innerWidth - the plot's inner width in px
 * @returns a {@link WeekAxis} both charts consume
 */
export function createWeekAxis(
  weeks: readonly string[],
  innerWidth: number,
): WeekAxis {
  const count = weeks.length
  const step = count > 0 ? innerWidth / count : 0
  const indexByWeek = new Map<string, number>()
  weeks.forEach((week, index) => {
    if (!indexByWeek.has(week)) indexByWeek.set(week, index)
  })
  return {
    weeks,
    step,
    x(weekStart: string): number {
      const index = indexByWeek.get(weekStart) ?? 0
      // Center of the week's column: keeps every x strictly inside [0, width].
      return step * (index + 0.5)
    },
  }
}

/**
 * Formats a Monday-anchored ISO week-start (`YYYY-MM-DD`) to a short localized
 * column label (e.g. "Aug 31"). Shared by both charts so the week axis carries
 * ONE label source (D14d). Parsing lives here in the formatter layer — never
 * `new Date(...).toLocaleDateString()` scattered in a render path (TS-6).
 *
 * @param weekStart - ISO date string (`YYYY-MM-DD`)
 * @param locale - the active `i18n.language`
 */
export function formatWeekLabel(weekStart: string, locale: string): string {
  const date = new Date(`${weekStart}T00:00:00`)
  if (Number.isNaN(date.getTime())) return weekStart
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}
