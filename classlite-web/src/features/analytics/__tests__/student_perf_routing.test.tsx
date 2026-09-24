// Story 8-3b, Task 7 · P1 (AC1-4). Routing + the aggregate hooks + the real
// student body: StudentPerformanceDetail (teacher) three-state incl. 404
// non-disclosure + 403; MyPerformancePage now renders the real container (the
// placeholder testid is gone). Single-aggregate read (a 500 blanks the view).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { StudentPerformanceDetail } from '@/features/analytics/components/StudentPerformanceDetail'
import { MyPerformancePage } from '@/features/analytics/MyPerformancePage'
import {
  STUDENT_ID,
  studentPerfHandlers,
  studentPerf404Handlers,
  studentPerf403Handlers,
  myPerfHandlers,
  myPerformance,
  studentPerformance,
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

function renderMyPerformance() {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MyPerformancePage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('StudentPerformanceDetail routing + states (AC1/AC3, P1)', () => {
  test('renders the loading skeleton then the detail with EXACTLY two tabs (D2 — no Recommendations)', async () => {
    server.use(...studentPerfHandlers(studentPerformance()))
    renderDetail()
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
    expect(await screen.findByTestId('student-perf-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('student-perf-tab-mistakes')).toBeInTheDocument()
    // No third (Recommendations) tab / headstone.
    expect(screen.queryByTestId('student-perf-tab-recommendations')).not.toBeInTheDocument()
  })

  test('404 STUDENT_NOT_FOUND → an inline non-disclosure not-found (no fabricated payload)', async () => {
    server.use(...studentPerf404Handlers)
    renderDetail()
    expect(await screen.findByTestId('student-perf-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('student-perf-tab-overview')).not.toBeInTheDocument()
  })

  test('403 → the permission state', async () => {
    server.use(...studentPerf403Handlers)
    renderDetail()
    expect(await screen.findByTestId('student-perf-forbidden')).toBeInTheDocument()
  })
})

describe('MyPerformancePage real body (AC2/AC4, P1)', () => {
  test('renders the real student view (the placeholder testid is gone)', async () => {
    server.use(...myPerfHandlers(myPerformance()))
    renderMyPerformance()
    expect(await screen.findByTestId('my-performance')).toBeInTheDocument()
    expect(screen.queryByTestId('my-performance-placeholder')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-performance-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('my-performance-tab-patterns')).toBeInTheDocument()
  })
})
