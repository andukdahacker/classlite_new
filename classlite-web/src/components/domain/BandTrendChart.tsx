/**
 * BandTrendChart — NET-NEW hand-built (SVG/CSS, no chart library — D4/NFR-3)
 * band-over-time sparkline (Story 8-2b, Task 6, AC15/22f). A weekly `avgBand`
 * LINE across the dense Monday-anchored `weeks` axis (D3), with a horizontal
 * target-band reference line.
 *
 * Honest degenerate handling (D14b): an empty week (`avgBand: null`) renders NO
 * point and the line does NOT bridge across it (a real gap, never a plotted 0);
 * 0 points → an empty zone (no line); 1 point → a DOT (a line needs ≥2). The
 * target line's y is the SAME band y-scale applied to `targetBand` (not pinned
 * top/bottom, not the raw value) — omitted with a "no target" caption when
 * `targetBand` is null (D11). Consumes the SHARED `createWeekAxis` (D14d) so its
 * x-coords align with `SkillWeekHeatmap` by construction. Domain tier (FW-7).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import {
  createWeekAxis,
  DEFAULT_CHART_WIDTH,
} from '@/lib/analytics/weekAxis'

type BandOverTimePoint = components['schemas']['BandOverTimePoint']

export interface BandTrendChartProps {
  points: BandOverTimePoint[]
  weeks: readonly string[]
  targetBand: number | null
}

const CHART_HEIGHT = 120
const BAND_MIN = 0
const BAND_MAX = 9

/** Band → y (inverted: a higher band sits higher on screen, smaller y). */
function bandToY(band: number): number {
  const fraction = (band - BAND_MIN) / (BAND_MAX - BAND_MIN)
  return CHART_HEIGHT * (1 - fraction)
}

interface PlottedPoint {
  weekStart: string
  x: number
  y: number
  weekIndex: number
}

export function BandTrendChart({
  points,
  weeks,
  targetBand,
}: BandTrendChartProps): ReactElement {
  const { t } = useTranslation()
  const axis = createWeekAxis(weeks, DEFAULT_CHART_WIDTH)
  const weekIndex = new Map<string, number>()
  weeks.forEach((week, index) => weekIndex.set(week, index))

  const plotted: PlottedPoint[] = points
    .filter((point) => point.avgBand !== null)
    .map((point) => ({
      weekStart: point.weekStart,
      x: axis.x(point.weekStart),
      y: bandToY(point.avgBand as number),
      weekIndex: weekIndex.get(point.weekStart) ?? 0,
    }))

  // 0 points → an empty zone (no line, no target line).
  if (plotted.length === 0) {
    return (
      <div
        data-testid="band-trend-empty"
        className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--cl-border)] text-sm text-[var(--cl-ink-soft)]"
      >
        {t('analytics.trend.empty')}
      </div>
    )
  }

  const isSinglePoint = plotted.length === 1
  // Line segments bridge ONLY axis-adjacent plotted weeks — a null week between
  // two grades leaves a real gap (D3), never a bridged path.
  const segments: Array<{ from: PlottedPoint; to: PlottedPoint }> = []
  for (let i = 1; i < plotted.length; i += 1) {
    const from = plotted[i - 1]
    const to = plotted[i]
    if (to.weekIndex - from.weekIndex === 1) segments.push({ from, to })
  }

  const targetY = targetBand !== null ? bandToY(targetBand) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          data-testid="band-trend-chart"
          viewBox={`0 0 ${DEFAULT_CHART_WIDTH} ${CHART_HEIGHT}`}
          width={DEFAULT_CHART_WIDTH}
          height={CHART_HEIGHT}
          role="img"
          aria-label={t('analytics.trend.ariaLabel')}
          className="min-w-[20rem]"
        >
          {targetY !== null ? (
            <line
              data-testid="band-trend-target-line"
              x1={0}
              y1={targetY}
              x2={DEFAULT_CHART_WIDTH}
              y2={targetY}
              stroke="var(--cl-ink-soft)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : null}

          {segments.map((segment) => (
            <line
              key={`${segment.from.weekStart}-${segment.to.weekStart}`}
              x1={segment.from.x}
              y1={segment.from.y}
              x2={segment.to.x}
              y2={segment.to.y}
              stroke="var(--cl-accent)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}

          {plotted.map((point) => (
            <circle
              key={point.weekStart}
              data-testid={
                isSinglePoint
                  ? 'band-trend-dot'
                  : `band-trend-point-${point.weekStart}`
              }
              data-x={point.x}
              data-y={point.y}
              cx={point.x}
              cy={point.y}
              r={4}
              fill="var(--cl-accent)"
            />
          ))}
        </svg>
      </div>

      {targetBand === null ? (
        <p
          data-testid="band-trend-no-target"
          className="text-xs text-[var(--cl-ink-soft)]"
        >
          {t('analytics.trend.noTarget')}
        </p>
      ) : null}
    </div>
  )
}
