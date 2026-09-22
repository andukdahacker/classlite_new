// ATDD RED-PHASE — Story 8-2b, Task 5/6 (shared week-axis alignment, D14d).
// AC16, AC22b (P1) — from ONE fixture, render BOTH charts and prove the heatmap
// column x-positions and the sparkline point x-coords map to the SAME
// weekStart → x (same coordinate), so a teacher reads a criterion dip against
// the cohort trend in the SAME column. Alignment is proven by test, not prose;
// the pure `createWeekAxis` fn is separately unit-tested in weekAxis.test.ts.
//
// RED signal: neither `@/components/domain/SkillWeekHeatmap` nor
// `@/components/domain/BandTrendChart` exists yet (TS2307). No `test.skip()`
// ([[reference_atdd_red_convention]]).
//
// ── SEAMS (shared) ─────────────────────────────────────────────────────────
//   Both components build their x-axis via createWeekAxis(heatmap.weeks, width)
//   and expose data-x on their per-week elements (heatmap-cell-* / band-trend-point-*).
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
// RED: these modules do not exist yet.
import { SkillWeekHeatmap } from '@/components/domain/SkillWeekHeatmap'
import { BandTrendChart } from '@/components/domain/BandTrendChart'
import {
  skillHeatmap,
  bandOverTime,
  WEEKS,
  TARGET_BAND,
} from '@/features/analytics/api/__tests__/handlers'

describe('SkillWeekHeatmap + BandTrendChart — shared week axis (AC22b, P1)', () => {
  test('P1 the same weekStart maps to the same x in both charts', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <div>
          <SkillWeekHeatmap heatmap={skillHeatmap()} targetBand={TARGET_BAND} />
          <BandTrendChart points={bandOverTime()} weeks={WEEKS} targetBand={TARGET_BAND} />
        </div>
      </I18nextProvider>,
    )
    // WEEKS[1] is a gap in the trend (null band → no point), so compare the two
    // weeks plotted in BOTH charts.
    for (const weekStart of [WEEKS[0], WEEKS[2]]) {
      const cell = screen.getByTestId(`heatmap-cell-taskResponse-${weekStart}`)
      const point = screen.getByTestId(`band-trend-point-${weekStart}`)
      const cellX = cell.getAttribute('data-x')
      const pointX = point.getAttribute('data-x')
      expect(cellX).not.toBeNull()
      expect(cellX).toBe(pointX)
    }
  })
})
