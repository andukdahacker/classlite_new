/**
 * SkillWeekHeatmap — NET-NEW hand-built (SVG/CSS, no chart library — D4/NFR-3)
 * Writing-criteria × week heatmap (Story 8-2b, Task 5, AC12/13/13a/22a). Four
 * IELTS Writing criteria as ROWS × the dense Monday-anchored `weeks` as COLUMNS,
 * one cell per (criterion, week).
 *
 * Colour model (D2, dataviz sequential ramp — ONE hue, light→dark): DISTANCE
 * from the class target drives intensity — pale = at/near target, saturated =
 * FAR (draws the eye to where to intervene). The bucket comes from the pure
 * `heatmapCellStyle` fn so the ramp is testable by ORDERING, not by hex.
 *
 * WCAG 1.4.1 — colour is NEVER the sole signal: EVERY graded cell prints its
 * numeric band as visible text, a `null` cell is a DISTINCT hatch (never a
 * coloured 0) carrying a "no grade" accessible label, and a PERSISTENT
 * target-anchored legend (not a hover tooltip) is always visible. When
 * `targetBand` is null (D11) the ramp falls back to a neutral absolute-band
 * scale. Domain tier — consumes the shared `createWeekAxis` + `heatmapCellStyle`
 * (D14d) so its columns align with `BandTrendChart` by construction.
 */
import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { formatBandOrDash } from '@/lib/analytics/formatBand'
import {
  heatmapCellStyle,
  type HeatmapBucket,
} from '@/lib/analytics/heatmapScale'
import {
  createWeekAxis,
  formatWeekLabel,
  DEFAULT_CHART_WIDTH,
} from '@/lib/analytics/weekAxis'

type SkillHeatmap = components['schemas']['SkillHeatmap']
type SkillHeatmapCell = components['schemas']['SkillHeatmapCell']

export interface SkillWeekHeatmapProps {
  heatmap: SkillHeatmap
  targetBand: number | null
}

/** Sequential amber ramp (one hue, light→dark) — index by distance bucket. */
const BUCKET_BACKGROUND: Record<HeatmapBucket, string> = {
  0: 'rgba(217, 119, 6, 0.10)',
  1: 'rgba(217, 119, 6, 0.28)',
  2: 'rgba(217, 119, 6, 0.46)',
  3: 'rgba(217, 119, 6, 0.68)',
  4: 'rgba(217, 119, 6, 0.90)',
}
/** Text flips to light on the two darkest steps so the numeric label stays legible. */
const HIGH_CONTRAST_BUCKET = 3

const CRITERION_LABEL_KEY: Record<string, string> = {
  taskResponse: 'criterion.taskResponse',
  coherenceCohesion: 'criterion.coherenceCohesion',
  lexicalResource: 'criterion.lexicalResource',
  grammaticalRange: 'criterion.grammaticalRange',
}

function cellKey(criterion: string, weekStart: string): string {
  return `${criterion}|${weekStart}`
}

export function SkillWeekHeatmap({
  heatmap,
  targetBand,
}: SkillWeekHeatmapProps): ReactElement {
  const { t, i18n } = useTranslation()
  const axis = createWeekAxis(heatmap.weeks, DEFAULT_CHART_WIDTH)

  const cellByKey = new Map<string, SkillHeatmapCell>()
  for (const cell of heatmap.cells) {
    cellByKey.set(cellKey(cell.criterion, cell.weekStart), cell)
  }

  return (
    <div data-testid="skill-week-heatmap" className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-center">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t('analytics.heatmap.criterionColumn')}
              </th>
              {heatmap.weeks.map((weekStart) => (
                <th
                  key={weekStart}
                  scope="col"
                  className="min-w-[3.5rem] px-1 text-xs font-medium text-[var(--cl-ink-soft)]"
                >
                  {formatWeekLabel(weekStart, i18n.language)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.criteria.map((criterion) => (
              <tr key={criterion}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-2 text-left text-xs font-medium text-[var(--cl-ink)]"
                >
                  <span lang="en">
                    {t(CRITERION_LABEL_KEY[criterion] ?? criterion)}
                  </span>
                </th>
                {heatmap.weeks.map((weekStart) => {
                  const cell = cellByKey.get(cellKey(criterion, weekStart))
                  const avgBand = cell?.avgBand ?? null
                  const sampleCount = cell?.sampleCount ?? 0
                  const x = axis.x(weekStart)
                  const style = heatmapCellStyle(avgBand, targetBand)
                  const weekLabel = formatWeekLabel(weekStart, i18n.language)
                  const criterionLabel = t(
                    CRITERION_LABEL_KEY[criterion] ?? criterion,
                  )

                  if (style.kind === 'empty') {
                    // Hatch (visual) + a "no grade" accessible label — a hatch
                    // alone would fail 1.4.1. NEVER a coloured 0.
                    const hatch: CSSProperties = {
                      backgroundImage:
                        'repeating-linear-gradient(45deg, var(--cl-line-soft) 0, var(--cl-line-soft) 1px, transparent 1px, transparent 6px)',
                    }
                    return (
                      <td
                        key={weekStart}
                        data-testid={`heatmap-cell-${criterion}-${weekStart}`}
                        data-x={x}
                        data-empty="true"
                        aria-label={`${t('analytics.heatmap.noGrade')} — ${criterionLabel}, ${weekLabel}`}
                        className="h-9 min-w-[3.5rem] rounded border border-[var(--cl-border)] text-[10px] text-[var(--cl-ink-soft)]"
                        style={hatch}
                      />
                    )
                  }

                  const isDark = style.bucket >= HIGH_CONTRAST_BUCKET
                  return (
                    <td
                      key={weekStart}
                      data-testid={`heatmap-cell-${criterion}-${weekStart}`}
                      data-x={x}
                      data-bucket={style.bucket}
                      aria-label={t('analytics.heatmap.cellLabel', {
                        criterion: criterionLabel,
                        week: weekLabel,
                        band: formatBandOrDash(avgBand),
                        count: sampleCount,
                      })}
                      className="h-9 min-w-[3.5rem] rounded border border-[var(--cl-border)] font-mono text-xs"
                      style={{
                        backgroundColor: BUCKET_BACKGROUND[style.bucket],
                        color: isDark ? 'var(--cl-paper)' : 'var(--cl-ink)',
                      }}
                    >
                      {formatBandOrDash(avgBand)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Persistent target-anchored legend (NOT a hover tooltip) — the D2
          metaphor is counterintuitive enough that it must always be visible. */}
      <div
        data-testid="heatmap-legend"
        className="flex items-center gap-2 text-xs text-[var(--cl-ink-soft)]"
      >
        <span>{t('analytics.heatmap.legend.atTarget')}</span>
        <span
          aria-hidden="true"
          className="h-3 w-24 rounded"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(217,119,6,0.10), rgba(217,119,6,0.90))',
          }}
        />
        <span>{t('analytics.heatmap.legend.farFromTarget')}</span>
        {targetBand !== null ? (
          <span className="ml-2 font-medium text-[var(--cl-ink)]">
            {t('analytics.heatmap.legend.target', {
              band: formatBandOrDash(targetBand),
            })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
