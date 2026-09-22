// ATDD RED-PHASE — Story 8-2b, Task 5 (NET-NEW hand-built SVG/CSS heatmap).
// AC12, AC13, AC22a (P1) — the WCAG-1.4.1 + null-vs-0 heart of the heatmap:
// EVERY cell carries its numeric band as VISIBLE TEXT (colour never the sole
// signal — axe can't catch colour-only), a null cell is a DISTINCT kind from a
// graded cell with a "no grade" accessible label, the intensity buckets are
// distance-from-target monotonic (via the rendered data-bucket, tying the
// component to heatmapCellStyle), and a PERSISTENT target-anchored legend is
// always visible (not a hover tooltip).
//
// RED signal: `@/components/domain/SkillWeekHeatmap` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]). Domain tier — no feature
// imports (FW-7); consumes the shared week→x fn + heatmapCellStyle (D14d/D2).
//
// jsdom does not compute SVG layout, so we assert on EXPLICIT attributes the
// component sets from the pure scale fns (data-bucket, data-x, data-empty) and
// on visible text / accessible labels — never on computed geometry.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • <SkillWeekHeatmap heatmap={SkillHeatmap} targetBand={number|null} /> at
//     src/components/domain/SkillWeekHeatmap.tsx:
//       root            data-testid="skill-week-heatmap"
//       one cell each   data-testid="heatmap-cell-${criterion}-${weekStart}"
//         graded cell:  data-bucket="0..4" (from heatmapCellStyle), data-x set
//                       from createWeekAxis, and its numeric band as VISIBLE TEXT
//         null cell:    data-empty="true" (NO data-bucket, NO coloured 0) + an
//                       accessible "no grade" label (i18n analytics.heatmap.noGrade)
//       persistent      data-testid="heatmap-legend"  (always rendered, prints the
//                       target band value when targetBand !== null)
//     Criterion ROWS are i18n-labeled with <span lang="en"> on the IELTS terms.
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
// RED: this module does not exist yet — the whole file fails to import.
import { SkillWeekHeatmap } from '@/components/domain/SkillWeekHeatmap'
import {
  skillHeatmap,
  WEEKS,
  CRITERIA,
  TARGET_BAND,
} from '@/features/analytics/api/__tests__/handlers'

function renderHeatmap(targetBand: number | null = TARGET_BAND): void {
  render(
    <I18nextProvider i18n={i18n}>
      <SkillWeekHeatmap heatmap={skillHeatmap()} targetBand={targetBand} />
    </I18nextProvider>,
  )
}

describe('SkillWeekHeatmap — structure (AC12, P2)', () => {
  test('P2 renders one cell per {criterion, weekStart} (4 rows × N weeks)', () => {
    renderHeatmap()
    for (const criterion of CRITERIA) {
      for (const weekStart of WEEKS) {
        expect(screen.getByTestId(`heatmap-cell-${criterion}-${weekStart}`)).toBeInTheDocument()
      }
    }
  })
})

describe('SkillWeekHeatmap — every cell numeric-labeled (AC13 WCAG 1.4.1, P1)', () => {
  test('P1 a graded cell shows its band as VISIBLE TEXT (colour is not the only signal)', () => {
    renderHeatmap()
    // grammaticalRange @ WEEKS[0] has avgBand 3.0 in the fixture.
    const cell = screen.getByTestId(`heatmap-cell-grammaticalRange-${WEEKS[0]}`)
    expect(within(cell).getByText('3.0')).toBeInTheDocument()
  })

  test('P1 the persistent target-anchored legend is ALWAYS rendered (not a hover tooltip) and prints the target band', () => {
    renderHeatmap()
    const legend = screen.getByTestId('heatmap-legend')
    expect(legend).toBeInTheDocument()
    expect(legend).toHaveTextContent(String(TARGET_BAND))
  })
})

describe('SkillWeekHeatmap — null cell vs graded cell (AC22a, P1)', () => {
  test('P1 a null-band cell is DISTINCT from a graded cell — no coloured 0, marked empty, "no grade" label', () => {
    renderHeatmap()
    const nullCell = screen.getByTestId(`heatmap-cell-taskResponse-${WEEKS[0]}`)
    // Distinct kind: marked empty, and it carries NO colour bucket (never a coloured 0).
    expect(nullCell).toHaveAttribute('data-empty', 'true')
    expect(nullCell).not.toHaveAttribute('data-bucket')
    // Never a literal "0" painted in an empty cell.
    expect(within(nullCell).queryByText('0')).not.toBeInTheDocument()
    expect(within(nullCell).queryByText('0.0')).not.toBeInTheDocument()
    // Carries a text/aria "no grade" equivalent (a hatch alone fails 1.4.1).
    const noGrade = i18n.t('analytics.heatmap.noGrade') as string
    expect(nullCell).toHaveAccessibleName(new RegExp(noGrade, 'i'))
  })

  test('P1 intensity is distance-from-target monotonic via the rendered bucket (ties component to heatmapCellStyle, not inverted)', () => {
    renderHeatmap()
    // taskResponse @ WEEKS[2] = 6.5 → AT target (pale, low bucket).
    const atTarget = screen.getByTestId(`heatmap-cell-taskResponse-${WEEKS[2]}`)
    // grammaticalRange @ WEEKS[0] = 3.0 → FAR from target (saturated, high bucket).
    const far = screen.getByTestId(`heatmap-cell-grammaticalRange-${WEEKS[0]}`)
    const atBucket = Number(atTarget.getAttribute('data-bucket'))
    const farBucket = Number(far.getAttribute('data-bucket'))
    expect(atBucket).toBeLessThan(farBucket)
  })
})

describe('SkillWeekHeatmap — targetBand null neutral ramp (AC13a/D11, P1)', () => {
  test('P1 with no target the legend still renders (neutral ramp), cells still numeric-labeled, no crash', () => {
    renderHeatmap(null)
    expect(screen.getByTestId('skill-week-heatmap')).toBeInTheDocument()
    // Legend present but does NOT assert a target value (neutral absolute ramp).
    expect(screen.getByTestId('heatmap-legend')).toBeInTheDocument()
    // A graded cell still shows its band text.
    expect(
      within(screen.getByTestId(`heatmap-cell-grammaticalRange-${WEEKS[0]}`)).getByText('3.0'),
    ).toBeInTheDocument()
  })
})
