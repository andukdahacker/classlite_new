// Story 8-3b, Task 7 · P1 (AC13). Mobile "glance not work" — STRUCTURAL checks
// (pixel-exact layout is handed to manual/TA per the 8-2b AC24 precedent): the
// student glance keeps charts in overflow-x-auto containers with an above-fold
// band hero; the teacher detail carries an honest md:hidden desktop hint.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { StudentPerformanceOverview } from '@/features/analytics/components/StudentPerformanceOverview'
import { StudentPerformanceDetail } from '@/features/analytics/components/StudentPerformanceDetail'
import {
  STUDENT_ID,
  studentPerfHandlers,
  studentPerformance,
  myPerformance,
} from '@/features/analytics/api/__tests__/handlers'

afterEach(() => server.resetHandlers())

describe('mobile glance (AC13, P1 structural)', () => {
  test('student Overview keeps the band hero above the fold + charts in overflow-x-auto', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={myPerformance()} />
      </I18nextProvider>,
    )
    // above-fold overall-band hero
    expect(screen.getByTestId('student-perf-overall')).toBeInTheDocument()
    // charts do not overflow the body — each trend sits in its own scroll box
    expect(container.querySelectorAll('.overflow-x-auto').length).toBeGreaterThan(0)
    // student glance NEVER hides its dense zones — the charts stay visible on phone
    expect(screen.getByTestId('student-perf-trend').className).not.toContain('hidden')
  })

  test('teacher Overview HIDES the dense trend zone on phone so the desktop hint replaces it (AC13, P8)', () => {
    // studentPerformance() carries framing:'teacher'. The dense per-skill trend zone
    // must be display:none at <md (hidden md:flex) — a squished chart is the degraded
    // screen §11.1 forbids; the md:hidden desktop hint stands in its place.
    render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={studentPerformance()} />
      </I18nextProvider>,
    )
    const trend = screen.getByTestId('student-perf-trend')
    expect(trend.className).toContain('hidden')
    expect(trend.className).toContain('md:flex')
  })

  test('teacher detail carries an honest md:hidden desktop hint (does not overlay at ≥md)', async () => {
    server.use(...studentPerfHandlers(studentPerformance()))
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
    const hint = await screen.findByTestId('student-perf-desktop-hint')
    expect(hint).toBeInTheDocument()
    // CSS-hidden at ≥md (stays in the DOM — assert the class, mirroring 8-2b AC24).
    expect(hint.className).toContain('md:hidden')
  })
})
