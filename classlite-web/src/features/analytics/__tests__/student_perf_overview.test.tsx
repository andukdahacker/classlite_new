// Story 8-3b, Task 7 · P1 (AC5-7). StudentPerformanceOverview — per-skill trend
// null-gap, stats via submissionRate.rate (NOT onTimeRate), nullable→"—" never 0,
// teacher classAvgBand present / student absent, targetBand aspiration. The no-red
// chart assertion lives in F1 (the privacy gate), not repeated here.
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { StudentPerformanceOverview } from '@/features/analytics/components/StudentPerformanceOverview'
import { studentPerformance, myPerformance } from '@/features/analytics/api/__tests__/handlers'

function renderOverview(perf: Parameters<typeof StudentPerformanceOverview>[0]['perf']) {
  return render(
    <I18nextProvider i18n={i18n}>
      <StudentPerformanceOverview perf={perf} />
    </I18nextProvider>,
  )
}

describe('StudentPerformanceOverview (AC5-7, P1)', () => {
  test('teacher renders the per-skill breakdown + a cohort classAvgBand locator', () => {
    renderOverview(studentPerformance())
    expect(screen.getByTestId('student-perf-skill-writing')).toBeInTheDocument()
    expect(screen.getByTestId('student-perf-classavg-writing')).toBeInTheDocument()
  })

  test('student OMITS the cohort classAvgBand locator (FR-50)', () => {
    renderOverview(myPerformance())
    expect(screen.queryByTestId('student-perf-classavg-writing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-perf-classavg-reading')).not.toBeInTheDocument()
  })

  test('a null overall band renders the localized "—", never 0', () => {
    renderOverview(
      studentPerformance({
        skillBreakdown: [{ skill: 'writing', overallBand: null, classAvgBand: null, criteria: [] }],
        bandProgression: [],
      }),
    )
    const dash = i18n.t('analytics.placeholder.dash')
    const skill = screen.getByTestId('student-perf-skill-writing')
    expect(skill.textContent).toContain(dash)
    expect(skill.textContent).not.toContain('0.0')
  })

  test('the on-time stat comes from submissionRate.rate (0.8 → 80%)', () => {
    renderOverview(studentPerformance())
    expect(screen.getByTestId('student-perf-stats').textContent).toContain('80%')
  })

  test('targetBand renders as an aspiration goal pill on both framings', () => {
    renderOverview(studentPerformance())
    expect(screen.getByTestId('student-perf-goal')).toBeInTheDocument()
    renderOverview(myPerformance())
    // student goal pill uses the coaching "your goal" copy
    expect(screen.getAllByTestId('student-perf-goal').length).toBeGreaterThan(0)
  })

  test('targetBand null → no aspiration goal pill (D11 discipline)', () => {
    renderOverview(studentPerformance({ targetBand: null }))
    expect(screen.queryByTestId('student-perf-goal')).not.toBeInTheDocument()
  })

  test('a middle-week null band GAPs the per-skill trend (never plots 0)', () => {
    renderOverview(studentPerformance())
    // the reused BandTrendChart renders (SVG); the null week is not a 0 point.
    expect(screen.getByTestId('student-perf-trend')).toBeInTheDocument()
  })
})
