// ATDD RED-PHASE — Story 8-1b, Task 6 + Task 7 (StudentDashboard s29 + s62
// first-login welcome). AC12, AC13, AC14, AC15, AC16 (+ AC20 countdown
// serverTime, axe).
//
// RED NATURE: `StudentDashboard.tsx` is REWORKED IN PLACE (today a 27-line
// placeholder), so this file imports an EXISTING default export — the RED is
// RUNTIME / assertion-level (the placeholder renders only a heading, not the
// s29 rails / s62 welcome). No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • root data-testid="student-dashboard" (replaces the placeholder heading).
//   • greeting + read-only week-strip glance (data-testid="dashboard-week-strip")
//     over student.upcomingSessions.
//   • data-testid="rail-due-soon": soonest deadline first; each item shows
//       title + skill + a countdown element data-testid={`due-countdown-${assignmentId}`}
//       computed from meta.serverTime (D16); a deep-link (D15):
//         submissionId != null → data-testid={`due-continue-${assignmentId}`} (→ writing editor /…/write)
//         submissionId == null → data-testid={`due-start-${assignmentId}`}    (→ start the assignment)
//   • data-testid="rail-recent-feedback": assignmentTitle + overallBand (mono);
//       CALMER treatment, decline NEVER red (UX-DR22).
//   • data-testid="rail-my-questions": content + status + "N ago".
//   • READ-ONLY: no management actions; NO peer/classmate/class-average data —
//       data-testid="peer-comparison" / "class-average" must NEVER exist.
//       glance disclaimer via i18n dashboard.student.glanceDisclaimer.
//   • s62 welcome: gate on localStorage['dashboard.student.welcomed:{userId}'] via
//       useStudentWelcome(userId). ABSENT → data-testid="student-welcome" renders
//       (coexists with real data). Dismiss (CTA data-testid="student-welcome-dismiss"
//       or first meaningful navigation) → sets the flag → never again. Flag SET →
//       hidden. POSITIVE signal only: an all-empty payload with the flag SET must
//       render NO welcome (empty-inference is forbidden, D12).
//   • trilogy: dashboard-skeleton / encouraging per-card empty state / role="alert" retry.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import StudentDashboard from '@/features/dashboard/StudentDashboard'
import {
  studentHandlers,
  dashboardHandlers,
  dashboard500Handlers,
  studentDataEmpty,
  DUE_ASSIGNMENT_DRAFTED_ID,
  DUE_ASSIGNMENT_UNSTARTED_ID,
  MY_QUESTION_ID,
} from '@/features/dashboard/api/__tests__/handlers'

const STUDENT_USER_ID = 'user-student-1'
const WELCOME_FLAG_KEY = `dashboard.student.welcomed:${STUDENT_USER_ID}`

function seedSession(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: STUDENT_USER_ID, email: 'student@example.com', fullName: 'Mai Anh', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'student',
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

function renderStudent(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<StudentDashboard />} />
            <Route path="/assignments/:assignmentId/write" element={<div data-testid="write-stub" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  clearSession()
  window.localStorage.clear()
})
afterEach(() => {
  clearSession()
  window.localStorage.clear()
  server.resetHandlers()
})

describe('StudentDashboard — AC12 s29 cards', () => {
  test('P0 renders greeting + week-strip glance + all three rail cards', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    expect(await screen.findByTestId('dashboard-week-strip')).toBeInTheDocument()
    expect(screen.getByTestId('rail-due-soon')).toBeInTheDocument()
    expect(screen.getByTestId('rail-recent-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('rail-my-questions')).toBeInTheDocument()
  })

  test('P0 due-soon countdown is derived from meta.serverTime (D16), per item', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    const rail = await screen.findByTestId('rail-due-soon')
    // deadlineAt is 2h after the injected FIXED_SERVER_TIME — the countdown must
    // exist and be serverTime-derived, never Date.now().
    expect(within(rail).getByTestId(`due-countdown-${DUE_ASSIGNMENT_DRAFTED_ID}`)).toBeInTheDocument()
  })

  test('P1 a drafted item shows "Continue writing" → writing editor; an unstarted item shows "Start" (D15)', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    const rail = await screen.findByTestId('rail-due-soon')
    // submissionId != null → Continue writing (resume the draft in the editor)
    const cont = within(rail).getByTestId(`due-continue-${DUE_ASSIGNMENT_DRAFTED_ID}`)
    expect(cont).toHaveAttribute('href', expect.stringContaining('/write'))
    // submissionId == null → Start (no continue link for this one)
    expect(within(rail).getByTestId(`due-start-${DUE_ASSIGNMENT_UNSTARTED_ID}`)).toBeInTheDocument()
    expect(within(rail).queryByTestId(`due-continue-${DUE_ASSIGNMENT_UNSTARTED_ID}`)).not.toBeInTheDocument()
  })

  test('P1 my-questions renders content + status + a serverTime "N ago"', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    const rail = await screen.findByTestId('rail-my-questions')
    expect(within(rail).getByText(/coherence/i)).toBeInTheDocument()
    expect(within(rail).getByTestId(`question-age-${MY_QUESTION_ID}`)).toBeInTheDocument()
  })
})

describe('StudentDashboard — AC13 read-only, no peer data (§8.4)', () => {
  test('P0 the glance disclaimer renders and NO peer/class-average surfaces exist', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    await screen.findByTestId('student-dashboard')
    expect(
      screen.getByText(i18n.t('dashboard.student.glanceDisclaimer') as string),
    ).toBeInTheDocument()
    // No classmate / class-average / peer-comparison data anywhere.
    expect(screen.queryByTestId('peer-comparison')).not.toBeInTheDocument()
    expect(screen.queryByTestId('class-average')).not.toBeInTheDocument()
  })
})

describe('StudentDashboard — AC14 trilogy (encouraging tone)', () => {
  test('P0 renders skeletons while loading (never a spinner)', () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
  })

  test('P1 each empty rail renders an encouraging (student-tone) empty state', async () => {
    server.use(...dashboardHandlers(studentDataEmpty))
    seedSession()
    renderStudent()
    const rail = await screen.findByTestId('rail-due-soon')
    expect(within(rail).getByTestId('rail-empty')).toBeInTheDocument()
  })

  test('P0 fetch error renders an inline role="alert" retry', async () => {
    server.use(...dashboard500Handlers)
    seedSession()
    renderStudent()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('StudentDashboard — AC15/AC16 s62 first-login welcome (D12)', () => {
  test('P1 welcome renders when the localStorage flag is ABSENT, coexisting with real data', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    expect(await screen.findByTestId('student-welcome')).toBeInTheDocument()
    // additive — coexists with real data, never blocks the cards.
    expect(screen.getByTestId('rail-due-soon')).toBeInTheDocument()
  })

  test('P0 welcome is HIDDEN when the flag is already SET (returning student)', async () => {
    window.localStorage.setItem(WELCOME_FLAG_KEY, '1')
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    await screen.findByTestId('student-dashboard')
    expect(screen.queryByTestId('student-welcome')).not.toBeInTheDocument()
  })

  test('P0 dismissing the welcome sets the flag and hides it', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    const welcome = await screen.findByTestId('student-welcome')
    await userEvent.click(within(welcome).getByTestId('student-welcome-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('student-welcome')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(WELCOME_FLAG_KEY)).not.toBeNull()
  })

  // Review P7 / AC16: dismissal also fires on "first meaningful navigation" — a
  // student who clicks into work (a due-soon deep-link) without hitting the CTA
  // must still have the flag set so they are not re-welcomed next visit.
  test('P1 (review) navigating via a due-soon deep-link dismisses the welcome (sets the flag)', async () => {
    server.use(...studentHandlers)
    seedSession()
    renderStudent()
    await screen.findByTestId('student-welcome')
    expect(window.localStorage.getItem(WELCOME_FLAG_KEY)).toBeNull()
    // studentHandlers' dueSoon has a drafted item → "Continue writing" deep-link.
    await userEvent.click(screen.getByTestId(`due-continue-${DUE_ASSIGNMENT_DRAFTED_ID}`))
    expect(window.localStorage.getItem(WELCOME_FLAG_KEY)).not.toBeNull()
  })

  test('P0 NEGATIVE: an all-empty payload with the flag SET renders NO welcome (empty-inference forbidden)', async () => {
    window.localStorage.setItem(WELCOME_FLAG_KEY, '1')
    server.use(...dashboardHandlers(studentDataEmpty))
    seedSession()
    renderStudent()
    await screen.findByTestId('student-dashboard')
    // A returning student between terms (empty data) must NOT re-trigger s62.
    expect(screen.queryByTestId('student-welcome')).not.toBeInTheDocument()
  })
})

describe('StudentDashboard — AC20 accessibility (TEST-FE-5)', () => {
  test('P1 has no axe violations on the loaded student dashboard', async () => {
    server.use(...studentHandlers)
    seedSession()
    const client = createTestQueryClient()
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/dashboard" element={<StudentDashboard />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await screen.findByTestId('student-dashboard')
    expect(await axe(container)).toHaveNoViolations()
  })
})
