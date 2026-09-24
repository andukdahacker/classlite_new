// Story 8-3b, Task 7 · P1 (AC11-12). StudentPatternsList (student softened) —
// coaching namespace, praise interleave, exampleQuote reveal, "own data only"
// note, NO practice-links (out of scope); the mixed-grain ghosted-frame global
// banner (gradedSubmissionCount < 3) via MyPerformanceContainer. The no-peer /
// no-red / no-"mistakes" scans are the F1 privacy gate.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { StudentPatternsList } from '@/features/analytics/components/StudentPatternsList'
import { StudentPerformanceOverview } from '@/features/analytics/components/StudentPerformanceOverview'
import { MyPerformanceContainer } from '@/features/analytics/components/MyPerformanceContainer'
import {
  mistakePattern,
  myPerfHandlers,
  myPerformance,
  studentSubmissionStats,
} from '@/features/analytics/api/__tests__/handlers'
import type { components } from '@/lib/api/client'

type MistakePattern = components['schemas']['MistakePattern']

const focus: MistakePattern = mistakePattern({
  type: 'error',
  affectedStudentCount: null,
  exampleQuote: 'Your conclusion restates the intro.',
  exampleNote: 'Try a forward-looking final sentence.',
})
const praise: MistakePattern = mistakePattern({
  skillSource: 'speaking',
  criterion: 'lexicalResource',
  type: 'praise',
  affectedStudentCount: null,
})

afterEach(() => server.resetHandlers())

function renderPatterns(patterns: MistakePattern[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <StudentPatternsList patterns={patterns} />
    </I18nextProvider>,
  )
}

describe('StudentPatternsList (AC11, P1)', () => {
  test('uses the coaching namespace (focus area / strength), not teacher keys', () => {
    renderPatterns([focus, praise])
    expect(screen.getByText(i18n.t('analytics.myPerformance.patterns.focusType') as string)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('analytics.myPerformance.patterns.strengthType') as string)).toBeInTheDocument()
  })

  test('interleaves praise rows in server order', () => {
    renderPatterns([focus, praise])
    expect(screen.getByTestId('student-pattern-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('student-pattern-row-1')).toBeInTheDocument()
  })

  test('reveals the exampleQuote + teacher tip, and the "own data only" note', () => {
    renderPatterns([focus])
    expect(within(screen.getByTestId('student-pattern-row-0')).getByTestId('student-pattern-quote-0')).toBeInTheDocument()
    expect(screen.getByTestId('student-patterns-own-data-note').textContent).toBe(
      i18n.t('analytics.myPerformance.patterns.ownDataNote'),
    )
  })

  test('empty patterns → an encouraging empty state', () => {
    renderPatterns([])
    expect(screen.getByTestId('student-patterns-empty')).toBeInTheDocument()
  })
})

describe('MyPerformanceContainer ghosted-frame (AC12, P1)', () => {
  function renderContainer() {
    const client = createTestQueryClient()
    return render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MyPerformanceContainer />
        </QueryClientProvider>
      </I18nextProvider>,
    )
  }

  test('gradedSubmissionCount < 3 → the global ghosted banner shows', async () => {
    server.use(
      ...myPerfHandlers(
        myPerformance({ submissionStats: studentSubmissionStats({ gradedSubmissionCount: 1 }) }),
      ),
    )
    renderContainer()
    expect(await screen.findByTestId('my-performance-ghosted-banner')).toBeInTheDocument()
  })

  test('gradedSubmissionCount >= 3 → no global ghosted banner', async () => {
    server.use(
      ...myPerfHandlers(
        myPerformance({ submissionStats: studentSubmissionStats({ gradedSubmissionCount: 9 }) }),
      ),
    )
    renderContainer()
    expect(await screen.findByTestId('my-performance')).toBeInTheDocument()
    expect(screen.queryByTestId('my-performance-ghosted-banner')).not.toBeInTheDocument()
  })
})

describe('Overview per-zone hasData dimming (AC12/AC24, code-review P7)', () => {
  test('a zone with hasData:false dims INDEPENDENTLY while graded >= 3 and other zones render', () => {
    // graded is WELL above the count threshold (9) — so anything dimmed here proves
    // PER-ZONE hasData gating, not the global gradedSubmissionCount<3 banner (AC24).
    const perf = myPerformance({
      submissionStats: studentSubmissionStats({
        gradedSubmissionCount: 9,
        hasData: {
          bandProgression: true,
          skillBreakdown: false, // this zone alone has no data
          mistakePatterns: true,
          submissionStats: true,
        },
      }),
    })
    render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={perf} />
      </I18nextProvider>,
    )
    // the breakdown zone shows its own empty state...
    expect(screen.getByTestId('student-perf-breakdown-empty')).toBeInTheDocument()
    // ...while the sibling zones (hasData:true) still render their content, NOT empties
    expect(screen.queryByTestId('student-perf-trend-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-perf-stats-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('student-perf-stat-graded')).toBeInTheDocument()
  })
})
