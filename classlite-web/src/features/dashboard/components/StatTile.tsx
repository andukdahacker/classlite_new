/**
 * StatTile — a single KPI tile for the owner center-pulse row (Story 8-1b, s48).
 *
 * Per the `dataviz` form heuristic this is the "not a chart" case: a headline
 * magnitude reads best as a stat tile, not a plot. The numeral wears the ink
 * text token in Geist Mono (never a series color — text carries no identity
 * here), the label sits in muted ink beneath it. No hover/tooltip layer: a bare
 * stat tile with no plot is the one form the interaction rule exempts.
 */
import type { ReactElement } from 'react'

export interface StatTileProps {
  /** `pulse-stat-${key}` — keys the assert-absence + value tests. */
  testId: string
  /** Resolved metric label (caller owns i18n). */
  label: string
  /** The metric value (rendered in Geist Mono). */
  value: number
}

export function StatTile({ testId, label, value }: StatTileProps): ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
    >
      <span className="font-mono text-3xl leading-none text-[var(--cl-ink)]">
        {value}
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">{label}</span>
    </div>
  )
}
