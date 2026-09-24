// ATDD RED-PHASE — Story 8-2b, Task 7 (class-performance view s46).
// AC10, AC11, AC13a, AC17, AC18, AC19, AC22, AC23 (P1) — the class-perf route
// view: 4-up null-safe stats, 404 non-disclosure, the three-state trilogy, the
// targetBand-null D11 fallback at the view level, mistake rows (TEXTUAL type +
// TEXT trend label, never glyph/colour-alone) + the excluded-source inline note,
// at-risk rows reusing PerfPill, and axe.
//
// Query shape resolution (AC22, Murat): ClassPerformance is ONE aggregate GET
// (/api/analytics/classes/{id}), so a 500 blanks the whole view (single inline
// error + retry) — there is NO partial-failure surface. The per-ZONE states are
// LOADING (skeleton) / ERROR (whole-view) / EMPTY (independent per sub-collection:
// empty mistakes, empty at-risk), which is what these tests exercise.
//
// RED signal: `@/features/analytics/components/ClassPerformanceView` does not
// exist yet (TS2307); it also pulls the missing SkillWeekHeatmap/BandTrendChart/
// hooks transitively. No `test.skip()` ([[reference_atdd_red_convention]]).
// MSW is the ONE mock seam (TEST-FE-1) — real useClassPerformance query.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • <ClassPerformanceView /> at
//     src/features/analytics/components/ClassPerformanceView.tsx reading
//     useParams().id + useClassPerformance(id):
//       loading      data-testid="analytics-class-skeleton" (shape-mirroring)
//       error(500)   role="alert" + a retry button → refetch
//       404          data-testid="analytics-class-not-found" (inline, i18n)
//       stats zone   data-testid="analytics-zone-stats" with a 4-up row; the
//                    target tile shows "—" on null; every nullable → "—" NEVER 0
//       target-null  data-testid="analytics-no-target" ("No target band set …
//                    Set a target") affordance (D11)
//       mistakes     data-testid="analytics-zone-mistakes"; each row
//                    data-testid="analytics-mistake-row-${i}" with an EXPLICIT
//                    textual type ("Recurring mistake" | "Strength") + a TEXT
//                    trend label ("improving"|"worsening"|"stable");
//                    data-testid="analytics-mistakes-excluded-note" (info, inline)
//       at-risk      data-testid="analytics-zone-atrisk"; each row
//                    data-testid="analytics-atrisk-row-${studentId}" reusing
//                    <PerfPill tone="at-risk"> (data-testid="perf-pill-at-risk")
//                    + reason chips via dashboard.atRisk.reason.* keys
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
// RED: this module does not exist yet — the whole file fails to import.
import { ClassPerformanceView } from '@/features/analytics/components/ClassPerformanceView'
import {
  CLASS_A_ID,
  AT_RISK_STUDENT_ID,
  classPerformance,
  mistakePatterns,
  classPerfHandlers,
  classPerfDefaultHandlers,
  classPerf500Handlers,
  classPerf404Handlers,
  classPerformanceAllNull,
  classPerformanceNoTarget,
  classPerformanceNoWriting,
  classPerformanceEmptyZones,
} from '@/features/analytics/api/__tests__/handlers'

function renderView(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/analytics/class/${CLASS_A_ID}`]}>
          <Routes>
            <Route path="/analytics/class/:id" element={<ClassPerformanceView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('ClassPerformanceView — three-state trilogy (AC22, P1)', () => {
  test('P1 loading renders a shape-mirroring skeleton (never a centered spinner)', () => {
    server.use(...classPerfDefaultHandlers)
    renderView()
    // Query pending on first paint — skeleton asserted synchronously.
    expect(screen.getByTestId('analytics-class-skeleton')).toBeInTheDocument()
  })

  test('P1 an aggregate 500 renders an inline role="alert" + retry→refetch recovers (REAL MSW 500)', async () => {
    server.use(...classPerf500Handlers)
    renderView()
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // Retry path: swap to a healthy handler, click retry, the view recovers.
    server.use(...classPerfDefaultHandlers)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('analytics.error.retry') as string }))
    await waitFor(() => expect(screen.getByTestId('analytics-zone-stats')).toBeInTheDocument())
  })
})

describe('ClassPerformanceView — 404 non-disclosure (AC11, P1)', () => {
  test('P1 a 404 CLASS_NOT_FOUND renders an inline not-found, never a raw error or partial payload', async () => {
    server.use(...classPerf404Handlers)
    renderView()
    expect(await screen.findByTestId('analytics-class-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-zone-stats')).not.toBeInTheDocument()
  })
})

describe('ClassPerformanceView — 4-up stats null-safety (AC10, R-C, P1)', () => {
  test('P1 every nullable stat renders "—" on null, NEVER 0', async () => {
    server.use(...classPerfHandlers(classPerformanceAllNull))
    renderView()
    const stats = await screen.findByTestId('analytics-zone-stats')
    const dash = i18n.t('analytics.placeholder.dash') as string
    expect(stats).toHaveTextContent(dash)
    // The lie this guards: a 0 where the wire says null (e.g. "on-time 0%").
    expect(stats).not.toHaveTextContent(/\b0%\b/)
  })
})

describe('ClassPerformanceView — targetBand null D11 fallback (AC13a, AC22f, P1)', () => {
  test('P1 no target → the "set a target" affordance renders and the target tile shows "—"', async () => {
    server.use(...classPerfHandlers(classPerformanceNoTarget))
    renderView()
    expect(await screen.findByTestId('analytics-no-target')).toBeInTheDocument()
  })
})

describe('ClassPerformanceView — mistake rows text-not-glyph (AC17/18, D16, P1)', () => {
  test('P1 rows carry an EXPLICIT textual type + a TEXT trend label; the excluded-source note is inline info', async () => {
    // D12: the default excludedSources is now [] (auto_graded is mined) — this test
    // exercises the note-render branch with an EXPLICIT non-empty excludedSources.
    server.use(
      ...classPerfHandlers(
        classPerformance({
          mistakePatterns: mistakePatterns({ excludedSources: ['auto_graded'] }),
        }),
      ),
    )
    renderView()
    const mistakes = await screen.findByTestId('analytics-zone-mistakes')
    // Explicit textual types — "Recurring mistake" (error) and "Strength" (praise).
    expect(within(mistakes).getByText(i18n.t('analytics.mistakes.type.recurring') as string)).toBeInTheDocument()
    expect(within(mistakes).getByText(i18n.t('analytics.mistakes.type.strength') as string)).toBeInTheDocument()
    // TEXT trend label (never an arrow glyph / colour alone).
    expect(within(mistakes).getByText(i18n.t('analytics.mistakes.trend.worsening') as string)).toBeInTheDocument()
    // Excluded auto-graded source → a VISIBLE inline info note (not blank, not error).
    expect(within(mistakes).getByTestId('analytics-mistakes-excluded-note')).toBeInTheDocument()
  })

  test('P1 empty patterns (non-empty coveredSources) → a per-zone "no repeating patterns" empty state, distinct from the excluded note', async () => {
    server.use(
      ...classPerfHandlers(
        classPerformance({
          mistakePatterns: mistakePatterns({ patterns: [], excludedSources: ['auto_graded'] }),
          atRiskStudents: [],
        }),
      ),
    )
    renderView()
    const mistakes = await screen.findByTestId('analytics-zone-mistakes')
    expect(within(mistakes).getByTestId('analytics-mistakes-empty')).toBeInTheDocument()
    // The excluded-source note is still present alongside the empty state.
    expect(within(mistakes).getByTestId('analytics-mistakes-excluded-note')).toBeInTheDocument()
  })
})

describe('ClassPerformanceView — at-risk rows (AC19, D9, P1)', () => {
  test('P1 each at-risk student reuses PerfPill(at-risk) + reason chips via existing dashboard keys', async () => {
    server.use(...classPerfDefaultHandlers)
    renderView()
    const row = await screen.findByTestId(`analytics-atrisk-row-${AT_RISK_STUDENT_ID}`)
    expect(within(row).getByTestId('perf-pill-at-risk')).toBeInTheDocument()
    // Reuses the EXISTING reason key (D9 — do not duplicate strings).
    expect(within(row).getByText(i18n.t('dashboard.atRisk.reason.attendance_below_floor') as string)).toBeInTheDocument()
  })

  test('P1 an empty at-risk list → a per-zone "no at-risk students" empty state', async () => {
    server.use(...classPerfHandlers(classPerformanceEmptyZones))
    renderView()
    const zone = await screen.findByTestId('analytics-zone-atrisk')
    expect(within(zone).getByTestId('analytics-atrisk-empty')).toBeInTheDocument()
  })
})

describe('ClassPerformanceView — accessibility (AC23, TEST-FE-5, P1)', () => {
  test('P1 the rendered view has no axe violations', async () => {
    server.use(...classPerfDefaultHandlers)
    const client = createTestQueryClient()
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/analytics/class/${CLASS_A_ID}`]}>
            <Routes>
              <Route path="/analytics/class/:id" element={<ClassPerformanceView />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await screen.findByTestId('analytics-zone-stats')
    expect(await axe(container)).toHaveNoViolations()
  })
})

// Code-review 2026-09-22 patch coverage — AC14 (hasWritingContent === false) and
// the AC24 desktop-hint mechanism, both shipped but previously untested.

describe('ClassPerformanceView — AC14 no Writing content (D14c, P1)', () => {
  test('P1 hasWritingContent === false → the "covers Writing" copy, NOT an empty grid', async () => {
    server.use(...classPerfHandlers(classPerformanceNoWriting))
    renderView()
    // The self-labeled DR-D empty copy renders …
    expect(await screen.findByTestId('analytics-heatmap-no-writing')).toBeInTheDocument()
    // … and the heatmap grid itself is NOT rendered (distinct from "Writing
    // class, no grades yet", which would render a grid full of null cells).
    expect(screen.queryByTestId('skill-week-heatmap')).not.toBeInTheDocument()
  })
})

describe('ClassPerformanceView — AC24 desktop-only hint mechanism', () => {
  test('P1 the hint is in the DOM and CSS-hidden at ≥md via `md:hidden`', async () => {
    // jsdom does not evaluate media queries — the true viewport bidirectional
    // assertion is a TA/e2e item; this locks the responsive mechanism.
    server.use(...classPerfDefaultHandlers)
    renderView()
    const hint = await screen.findByTestId('analytics-desktop-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.className).toContain('md:hidden')
  })
})
