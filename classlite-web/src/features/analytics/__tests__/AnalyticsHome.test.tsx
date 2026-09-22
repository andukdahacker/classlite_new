// ATDD RED-PHASE — Story 8-2b, Task 4 (analytics home s45).
// AC6, AC6a, AC7, AC9 and the D-TEST **P0** AC8/AC22c role-branch DOM-absence:
// the owner-only "Teacher performance" card must be ABSENT from a teacher's DOM
// (queryByTestId null — not merely hidden), POSITIVE-CONTROL-PAIRED with the
// owner render using the SAME locator/key, and the branch predicate proven with
// role null / undefined too (the leak hides in the predicate).
//
// RED signal: `@/features/analytics/components/AnalyticsHome` does not exist yet
// (TS2307). The pre-built <AnalyticsHomeShell>/<ScopeBar> ARE real (1d-4) — this
// component fills the shell's slot. No `test.skip()`
// ([[reference_atdd_red_convention]]).
//
// AnalyticsHome is a PRESENTATIONAL component over the already-fetched data
// (role + classes), so these tests pass `data` as a prop — no MSW needed here
// (the fetch is covered by AnalyticsRoute.test.tsx + useAnalyticsHome.test.tsx).
// It still renders through I18nextProvider (i18n key resolution, TEST-FE-4) and
// a MemoryRouter (the class-card navigate, AC9).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • <AnalyticsHome data={AnalyticsHome} /> at
//     src/features/analytics/components/AnalyticsHome.tsx — fills the
//     <AnalyticsHomeShell> slot; one card per data.classes:
//       data-testid="analytics-class-card-${classId}"
//     each showing className, studentCount, avgBand (null→"—" NEVER 0),
//     atRiskCount, onTimeRate (null→"—") via the D13 formatOrDash/i18n formatter.
//   • OWNER/ADMIN ONLY: a full-opacity "coming soon" card (D6, NOT dimmed):
//       data-testid="analytics-teacher-perf-card"
//     with a "not visible to teachers" tag. ABSENT from the DOM for a teacher.
//   • data.classes.length === 0 → an inline role-appropriate EMPTY state (D12):
//       data-testid="analytics-home-empty"  (icon + headline + one action)
//     NOT a blank, a skeleton, or an error.
//   • the ScopeBar is wired presentational (D15): the role scope renders as a
//     STATIC label (reuse scopeBar.* keys), the class-picker is the one live
//     control (onClassChange → navigate to /analytics/class/:id).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
// RED: this module does not exist yet — the whole file fails to import.
import { AnalyticsHome } from '@/features/analytics/components/AnalyticsHome'
import {
  teacherHomeData,
  ownerHomeData,
  adminHomeData,
  teacherHomeEmpty,
  CLASS_A_ID,
  CLASS_B_ID,
} from '@/features/analytics/api/__tests__/handlers'

type AnalyticsHomeData = components['schemas']['AnalyticsHome']

const TEACHER_PERF_CARD = 'analytics-teacher-perf-card'

function renderHome(data: AnalyticsHomeData) {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics']}>
          <AnalyticsHome data={data} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('AnalyticsHome — AC6 class summary cards (P1)', () => {
  test('P1 renders one card per class with null-safe mini-stats ("—" NEVER 0)', () => {
    renderHome(teacherHomeData)
    // One card per class:
    expect(screen.getByTestId(`analytics-class-card-${CLASS_A_ID}`)).toBeInTheDocument()
    const cardB = screen.getByTestId(`analytics-class-card-${CLASS_B_ID}`)
    expect(cardB).toBeInTheDocument()
    // Class B has avgBand:null + onTimeRate:null → the placeholder dash, NEVER "0".
    const dash = i18n.t('analytics.placeholder.dash') as string
    expect(cardB).toHaveTextContent(dash)
    // The lie this guards: a "0" where the wire says null.
    expect(cardB).not.toHaveTextContent(/\b0%?\b/)
  })
})

describe('AnalyticsHome — AC6a empty-classes state (D12, P1)', () => {
  test('P1 classes:[] renders the inline empty state — NOT a blank, skeleton, or error', () => {
    renderHome(teacherHomeEmpty)
    expect(screen.getByTestId('analytics-home-empty')).toBeInTheDocument()
    // No class cards, and NOT an error alert.
    expect(screen.queryByTestId(`analytics-class-card-${CLASS_A_ID}`)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('AnalyticsHome — AC8/AC22c owner-only card DOM-absence (P0, positive-control-paired)', () => {
  test('P0 OWNER render: the Teacher-performance card IS present (the positive control)', () => {
    renderHome(ownerHomeData)
    expect(screen.getByTestId(TEACHER_PERF_CARD)).toBeInTheDocument()
  })

  test('P0 ADMIN render: the Teacher-performance card IS present (owner+admin share it)', () => {
    renderHome(adminHomeData)
    expect(screen.getByTestId(TEACHER_PERF_CARD)).toBeInTheDocument()
  })

  test('P0 TEACHER render: the Teacher-performance card is ABSENT from the DOM (not hidden) — SAME key as the owner control', () => {
    renderHome(teacherHomeData)
    expect(screen.queryByTestId(TEACHER_PERF_CARD)).not.toBeInTheDocument()
  })

  // AC22c predicate sweep — the leak hides in the predicate. A lazy
  // `role !== 'teacher'` gate would LEAK the owner card to an unresolved role.
  // The wire type forbids null/undefined, so we cast with justification to prove
  // the runtime predicate is an explicit owner|admin allowlist, not a denylist.
  test('P0 predicate sweep: role null / undefined must NOT render the owner-only card', () => {
    const nullRole = { ...teacherHomeData, role: null } as unknown as AnalyticsHomeData // justify: prove predicate is an allowlist, not `!== teacher`
    renderHome(nullRole)
    expect(screen.queryByTestId(TEACHER_PERF_CARD)).not.toBeInTheDocument()

    const undefinedRole = { ...teacherHomeData, role: undefined } as unknown as AnalyticsHomeData // justify: same — a denylist predicate leaks here
    renderHome(undefinedRole)
    expect(screen.queryByTestId(TEACHER_PERF_CARD)).not.toBeInTheDocument()
  })
})

// Code-review 2026-09-22 patch coverage — D15 honesty, role-appropriate empty
// action (D12/AC6a), axe-per-role (AC23), and the AC24 desktop-hint mechanism.

describe('AnalyticsHome — D15 ScopeBar honesty (AC6/AC9)', () => {
  test('scope renders as a STATIC label, never a toggle-looking pill', () => {
    renderHome(teacherHomeData)
    expect(screen.getByTestId('scope-bar-scope-label')).toBeInTheDocument()
    // The interactive pills must be ABSENT — nothing pretends to switch scope.
    expect(screen.queryByTestId('scope-bar-pill-mine')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar-pill-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar-pill-center-wide')).not.toBeInTheDocument()
  })

  test('the date range renders as a STATIC period label, never a dead date-range control', () => {
    renderHome(teacherHomeData)
    expect(screen.getByTestId('scope-bar-period-label')).toBeInTheDocument()
    // The interactive-looking date-range button must be ABSENT (no dead control).
    expect(screen.queryByTestId('scope-bar-date-range')).not.toBeInTheDocument()
  })
})

describe('AnalyticsHome — AC6a role-appropriate empty action (D12)', () => {
  const createLabel = i18n.t('analytics.home.empty.action') as string

  test('a teacher with no classes → a hint, NOT a "Create a class" CTA', () => {
    renderHome(teacherHomeEmpty)
    expect(screen.getByTestId('analytics-home-empty')).toBeInTheDocument()
    expect(screen.getByTestId('analytics-home-empty-teacher-hint')).toBeInTheDocument()
    // Teachers don't create classes — the CTA must be absent.
    expect(screen.queryByRole('button', { name: createLabel })).not.toBeInTheDocument()
  })

  test('an owner with no classes → the "Create a class" CTA (positive control)', () => {
    renderHome({ ...ownerHomeData, classes: [] })
    expect(screen.getByRole('button', { name: createLabel })).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-home-empty-teacher-hint')).not.toBeInTheDocument()
  })
})

describe('AnalyticsHome — AC23 no axe violations (each role)', () => {
  test.each([
    ['teacher', teacherHomeData],
    ['owner', ownerHomeData],
    ['admin', adminHomeData],
  ] as const)('%s render has no axe violations', async (_role, data) => {
    const { container } = renderHome(data)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AnalyticsHome — AC24 desktop-only hint mechanism', () => {
  test('the hint is in the DOM and CSS-hidden at ≥md via `md:hidden`', () => {
    // jsdom does not evaluate media queries, so the true bidirectional
    // present-below / hidden-at-or-above viewport assertion is a TA/e2e item.
    // This locks the RESPONSIVE MECHANISM: deleting the hint or its `md:hidden`
    // utility fails here (a "toBeVisible" check would false-pass at every width).
    renderHome(teacherHomeData)
    const hint = screen.getByTestId('analytics-desktop-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.className).toContain('md:hidden')
  })
})
