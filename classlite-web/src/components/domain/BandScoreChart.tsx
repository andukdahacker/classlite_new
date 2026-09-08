/**
 * BandScoreChart — Story 7.2b (D10). The s10 perf-card overall block: an
 * oversized `overallBand` (Fraunces display face; `null` → "—") with an
 * "Avg band" caption and up to TWO trajectory deltas:
 *   (a) `currentVsFirstDelta` "vs first month" — OMITTED when null (7-2a D1:
 *       null below two released grades);
 *   (b) `overallBand − max(class targetBand)` "vs class target (X)" — omitted
 *       when there is no class target or no overall band.
 *
 * NO projection line ("on track to reach X by week N" is Epic 8, D14) — the
 * `band-projection` seam is deliberately never rendered. Domain tier, no
 * feature imports (FW-7).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

const UP = '▲'
const DOWN = '▼'

export interface BandScoreChartProps {
  overallBand: number | null
  currentVsFirstDelta: number | null
  /** Max targetBand across the student's enrolled classes; null when none carries one. */
  targetBand: number | null
}

function DeltaRow({
  testId,
  delta,
  label,
}: {
  testId: string
  delta: number
  label: string
}): ReactElement {
  // A zero delta is "no change" / "exactly at target" — neutral, not a green gain.
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const tone =
    direction === 'up'
      ? 'text-[color:var(--cl-green)]'
      : direction === 'down'
        ? 'text-[color:var(--cl-red)]'
        : 'text-slate-500'
  const glyph = direction === 'up' ? UP : direction === 'down' ? DOWN : null
  return (
    <p data-testid={testId} className={`text-sm ${tone}`}>
      {glyph !== null ? (
        <>
          <span aria-hidden="true">{glyph}</span>{' '}
        </>
      ) : null}
      <span className="font-mono">{Math.abs(delta).toFixed(1)}</span> {label}
    </p>
  )
}

export function BandScoreChart({
  overallBand,
  currentVsFirstDelta,
  targetBand,
}: BandScoreChartProps): ReactElement {
  const { t } = useTranslation()
  const vsTarget =
    overallBand !== null && targetBand !== null
      ? overallBand - targetBand
      : null
  return (
    <div data-testid="band-score-chart" className="flex flex-col gap-1">
      <p className="font-fraunces text-5xl leading-none text-slate-900">
        {overallBand !== null
          ? overallBand.toFixed(1)
          : t('people.student.band.empty')}
      </p>
      <p className="text-xs uppercase tracking-wide text-slate-400">
        {t('people.student.band.avgLabel')}
      </p>
      {currentVsFirstDelta !== null ? (
        <DeltaRow
          testId="band-delta-first-month"
          delta={currentVsFirstDelta}
          label={t('people.student.band.vsFirstMonth')}
        />
      ) : null}
      {vsTarget !== null && targetBand !== null ? (
        <DeltaRow
          testId="band-delta-class-target"
          delta={vsTarget}
          label={t('people.student.band.vsClassTarget', {
            target: targetBand.toFixed(1),
          })}
        />
      ) : null}
    </div>
  )
}
