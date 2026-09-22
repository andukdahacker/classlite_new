// ATDD RED-PHASE — Story 8-2b, Task 6 (NET-NEW hand-built band-over-time chart).
// AC15, AC22f (P1) — the falsifiable trend geometry: a LINE sparkline where an
// empty week is a GAP (never plotted as 0), the degenerate 0-point (empty zone)
// and 1-point (a dot, a line needs ≥2) cases, and a target-band line whose y is
// the SAME y-scale applied to the target (not pinned top/bottom, not the raw
// value) — proven by coinciding with a data point at the same band.
//
// RED signal: `@/components/domain/BandTrendChart` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]). Consumes the SHARED
// createWeekAxis so its x-coords align with the heatmap by construction (D14d).
//
// jsdom has no SVG layout — assert on EXPLICIT data-x/data-y attributes the
// component sets from the scale fns, never on computed geometry.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • <BandTrendChart points={BandOverTimePoint[]} weeks={string[]}
//       targetBand={number|null} /> at src/components/domain/BandTrendChart.tsx:
//       root                 data-testid="band-trend-chart"
//       per PLOTTED point    data-testid="band-trend-point-${weekStart}"
//                            data-x (createWeekAxis), data-y (band y-scale)
//       empty week (null)    → NO point element (the path does not bridge it)
//       target line          data-testid="band-trend-target-line" (<line>, y1==y2)
//                            omitted when targetBand === null + a
//                            data-testid="band-trend-no-target" caption instead
//       0 points             → data-testid="band-trend-empty" (empty zone, no line)
//       1 point              → data-testid="band-trend-dot" (a dot, not a line)
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
// RED: this module does not exist yet — the whole file fails to import.
import { BandTrendChart } from '@/components/domain/BandTrendChart'
import {
  bandOverTime,
  WEEKS,
  TARGET_BAND,
} from '@/features/analytics/api/__tests__/handlers'

function renderChart(
  points = bandOverTime(),
  targetBand: number | null = TARGET_BAND,
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <BandTrendChart points={points} weeks={WEEKS} targetBand={targetBand} />
    </I18nextProvider>,
  )
}

describe('BandTrendChart — empty week is a GAP, never 0 (AC15, P1)', () => {
  test('P1 the null-band week renders NO point (the line gaps, does not plot 0)', () => {
    renderChart() // wk1 avgBand is null in the fixture
    expect(screen.getByTestId(`band-trend-point-${WEEKS[0]}`)).toBeInTheDocument()
    expect(screen.getByTestId(`band-trend-point-${WEEKS[2]}`)).toBeInTheDocument()
    // The gap: no point for the null week.
    expect(screen.queryByTestId(`band-trend-point-${WEEKS[1]}`)).not.toBeInTheDocument()
  })
})

describe('BandTrendChart — degenerate cases (D14b, AC15, P1)', () => {
  test('P1 zero points → an empty-zone state, no line', () => {
    renderChart([])
    expect(screen.getByTestId('band-trend-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('band-trend-target-line')).not.toBeInTheDocument()
  })

  test('P1 a single point → a DOT, not a zero-length line', () => {
    renderChart([{ weekStart: WEEKS[0], avgBand: 6.0, submissionCount: 10 }])
    expect(screen.getByTestId('band-trend-dot')).toBeInTheDocument()
  })
})

describe('BandTrendChart — target-band line position (AC22f, P1)', () => {
  test('P1 the target line y equals the y-scale applied to the target band (coincides with a same-band point), NOT pinned/raw', () => {
    renderChart() // wk2 avgBand 6.5 === TARGET_BAND 6.5; wk0 avgBand 5.5
    const targetLine = screen.getByTestId('band-trend-target-line')
    const pointAtTarget = screen.getByTestId(`band-trend-point-${WEEKS[2]}`) // band 6.5
    const pointLower = screen.getByTestId(`band-trend-point-${WEEKS[0]}`) // band 5.5

    const targetY = Number(targetLine.getAttribute('y1'))
    const targetYEnd = Number(targetLine.getAttribute('y2'))
    const yAtTarget = Number(pointAtTarget.getAttribute('data-y'))
    const yLower = Number(pointLower.getAttribute('data-y'))

    // Horizontal line.
    expect(targetY).toBe(targetYEnd)
    // Same y-scale: target band 6.5 lands exactly where the 6.5 point plots.
    expect(targetY).toBe(yAtTarget)
    // Real scaling (inverted y): the higher band (6.5) sits ABOVE the lower (5.5).
    expect(yAtTarget).toBeLessThan(yLower)
    // Not the raw value painted as a coordinate.
    expect(targetY).not.toBe(TARGET_BAND)
    expect(Number.isFinite(targetY)).toBe(true)
  })

  test('P1 targetBand null → NO target line, a "no target" caption instead (D11)', () => {
    renderChart(bandOverTime(), null)
    expect(screen.queryByTestId('band-trend-target-line')).not.toBeInTheDocument()
    expect(screen.getByTestId('band-trend-no-target')).toBeInTheDocument()
  })
})
