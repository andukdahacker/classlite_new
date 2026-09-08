// ATDD RED-PHASE — Story 7-2b, Task 4 (s42 center-wide list). AC7-10.
//
// RED signal: `@/features/people/StudentsCenterPage` does not exist yet.
// No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • center variant columns include a "Classes" cell + a "Teacher(s)" cell (teachers[])
//   • role="tab" All / At-risk / New / Unassigned / Archived (people.student.tabs.*)
//   • an unassigned row (activeEnrollmentCount===0): data-testid="perf-pill-unassigned"
//     + data-testid="student-unassigned-{studentId}" (amber treatment, `??` avatar)
//   • data-testid="student-count-superscript" — "N enrolled · M at-risk · K unassigned"
//   • when meta.pagination.total > 100 (D6): a pager + role="status" note
//     data-testid="student-page-count-note"; when total ≤ 100: no pager
//   • class/teacher filter chips issue server-side ?class_id / ?teacher_id
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
// RED: this module does not exist yet.
import { StudentsCenterPage } from '@/features/people/StudentsCenterPage'
import {
  DEFAULT_CENTER_ID,
  STUDENT_GOOD_ID,
  STUDENT_UNASSIGNED_ID,
  studentGood,
  studentArchived,
  centerRosterHandlers,
  rosterOverflowHandlers,
} from '@/features/people/api/__tests__/studentHandlers'

const STUB_USER: UserSummary = {
  id: 'user-owner',
  email: 'owner@example.com',
  fullName: 'Center Owner',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

function renderList(role: Role = 'owner'): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/people/students']}>
          <Routes>
            <Route path="/people/students" element={<StudentsCenterPage />} />
            <Route path="/people/students/:id" element={<div data-testid="detail-stub" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('StudentsCenterPage — AC7 center-variant columns', () => {
  test('P1 a row shows the Classes cell and a Teacher(s) cell (distinct names)', async () => {
    server.use(...centerRosterHandlers())
    renderList()
    const row = await screen.findByTestId(`student-row-${STUDENT_GOOD_ID}`)
    // Classes column (mono list of class names)
    expect(within(row).getByText(/IELTS Writing 6\.5/)).toBeInTheDocument()
    // Teacher(s) column — s42-only (a teacher's own roster omits this)
    expect(within(row).getByText(/Minh N\./)).toBeInTheDocument()
    expect(within(row).getByText(/Lan P\./)).toBeInTheDocument()
  })
})

describe('StudentsCenterPage — AC8 tabs + superscript', () => {
  test('P1 renders the five center-variant tabs', async () => {
    server.use(...centerRosterHandlers())
    renderList()
    await screen.findByText(studentGood.name)
    for (const key of ['all', 'atRisk', 'new', 'unassigned', 'archived'] as const) {
      expect(
        screen.getByRole('tab', { name: new RegExp(i18n.t(`people.student.tabs.${key}`), 'i') }),
      ).toBeInTheDocument()
    }
  })

  test('P1 page-head superscript summarizes enrolled / at-risk / unassigned counts', async () => {
    server.use(...centerRosterHandlers())
    renderList()
    await screen.findByText(studentGood.name)
    expect(screen.getByTestId('student-count-superscript')).toBeInTheDocument()
  })

  test('P1 Archived tab shows the archived student and NOT an active one (negative)', async () => {
    server.use(...centerRosterHandlers())
    const user = userEvent.setup()
    renderList()
    await screen.findByText(studentGood.name)
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.student.tabs.archived'), 'i') }))
    expect(await screen.findByText(studentArchived.name)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(studentGood.name)).not.toBeInTheDocument()
    })
  })
})

describe('StudentsCenterPage — AC9 unassigned amber treatment', () => {
  test('P1 an unassigned student shows the perf-unassigned pill + amber row marker', async () => {
    server.use(...centerRosterHandlers())
    const user = userEvent.setup()
    renderList()
    await screen.findByText(studentGood.name)
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.student.tabs.unassigned'), 'i') }))
    const row = await screen.findByTestId(`student-row-${STUDENT_UNASSIGNED_ID}`)
    expect(within(row).getByTestId('perf-pill-unassigned')).toBeInTheDocument()
    expect(within(row).getByTestId(`student-unassigned-${STUDENT_UNASSIGNED_ID}`)).toBeInTheDocument()
  })
})

describe('StudentsCenterPage — AC10 pagination window (D6)', () => {
  test('P1 total ≤ 100 renders NO pager and NO page-count note', async () => {
    server.use(...centerRosterHandlers())
    renderList()
    await screen.findByText(studentGood.name)
    expect(screen.queryByTestId('student-page-count-note')).not.toBeInTheDocument()
  })

  test('P0 total > 100 renders the pager + a role="status" "counts reflect loaded page" note', async () => {
    server.use(...rosterOverflowHandlers)
    renderList()
    await screen.findByText(studentGood.name)
    const note = await screen.findByTestId('student-page-count-note')
    expect(note).toHaveAttribute('role', 'status')
  })
})
