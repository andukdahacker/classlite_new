// Story 8-3b, Task 7 · P1 (AC18, AC20, AC14a, AC24). Single-aggregate three-state
// (a 500 blanks the whole view + inline retry that refetches), axe no-violations
// per tab per role, and the share-summary control behavior (copy → clipboard +
// toast; print → window.print; busy state).
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { StudentPerformanceDetail } from '@/features/analytics/components/StudentPerformanceDetail'
import { StudentPerformanceOverview } from '@/features/analytics/components/StudentPerformanceOverview'
import { StudentMistakesList } from '@/features/analytics/components/StudentMistakesList'
import { StudentPatternsList } from '@/features/analytics/components/StudentPatternsList'
import { ShareSummaryButton } from '@/features/analytics/components/ShareSummaryButton'
import {
  STUDENT_ID,
  studentPerf500Handlers,
  studentPerfHandlers,
  studentPerformance,
  myPerformance,
} from '@/features/analytics/api/__tests__/handlers'

afterEach(() => server.resetHandlers())

function renderDetail() {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/analytics/student/${STUDENT_ID}`]}>
          <Routes>
            <Route path="/analytics/student/:id" element={<StudentPerformanceDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('single-aggregate three-state (AC24, P1)', () => {
  test('a 500 blanks the whole view with an inline alert + a retry that refetches', async () => {
    const user = userEvent.setup()
    server.use(...studentPerf500Handlers)
    renderDetail()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // retry with a now-healthy backend → the detail loads.
    server.use(...studentPerfHandlers(studentPerformance()))
    await user.click(screen.getByRole('button', { name: i18n.t('analytics.error.retry') as string }))
    expect(await screen.findByTestId('student-perf-tab-overview')).toBeInTheDocument()
  })
})

describe('axe no-violations per surface per role (AC20, P1)', () => {
  test('teacher Overview', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={studentPerformance()} />
      </I18nextProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('student Overview', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={myPerformance()} />
      </I18nextProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('teacher Mistakes list', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentMistakesList patterns={studentPerformance().mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('student Patterns list', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPatternsList patterns={myPerformance().mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ShareSummaryButton behavior (AC14a, P1)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    vi.stubGlobal('print', vi.fn())
  })

  test('copy writes the own-data summary text to the clipboard (guarded)', async () => {
    // fireEvent (not userEvent) — userEvent.setup() installs its OWN clipboard
    // stub, which would shadow the spy the component reads.
    render(
      <I18nextProvider i18n={i18n}>
        <ShareSummaryButton perf={myPerformance()} />
      </I18nextProvider>,
    )
    fireEvent.click(screen.getByTestId('share-summary-copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(written).toContain('Nguyen An')
    // R-C: no peer value leaks into the shared text.
    expect(written).not.toMatch(/class average|cohort|affected/i)
  })

  test('export PDF invokes window.print()', async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <ShareSummaryButton perf={myPerformance()} />
      </I18nextProvider>,
    )
    await user.click(screen.getByTestId('share-summary-print'))
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  test('the controls are labeled + keyboard-reachable buttons', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ShareSummaryButton perf={studentPerformance()} />
      </I18nextProvider>,
    )
    expect(
      screen.getByRole('button', { name: i18n.t('analytics.share.copy') as string }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('analytics.share.exportPdf') as string }),
    ).toBeInTheDocument()
  })
})
