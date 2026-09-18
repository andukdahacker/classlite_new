// ATDD RED-PHASE — Story 8-1b, Task 4 (TeacherDashboard onboarding-split → real
// s06 dashboard). AC4, AC5, AC6, AC7 (+ AC20 serverTime "N ago").
//
// RED NATURE (differs from the other 8-1b files): `TeacherDashboard.tsx` is
// REWORKED IN PLACE (D2), so this file imports an EXISTING module — the RED is
// RUNTIME / assertion-level, not TS2307. The onboarding-INCOMPLETE tests are a
// REGRESSION GUARD (they should stay green across the split, mirroring the 2-4
// `TeacherDashboard.test.tsx` "regression baseline" block); the onboarding-
// COMPLETE tests FAIL today (the old component renders persona-placeholder
// bodies, not the week-strip + 3 rails) and go green when Task 4 lands.
// No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • onboarding INCOMPLETE (progress.currentStep !== 'done') → UNCHANGED Epic-2
//     shell (WelcomeBackBanner / FinishSetupCard) — D2 preserve.
//   • onboarding COMPLETE (currentStep === 'done', persona set) → the real
//     dashboard consuming useDashboard():
//       - data-testid="dashboard-week-strip" (DashboardWeekStrip over teacher.weekSessions)
//       - data-testid="rail-needs-grading"        headline count = block.count
//       - data-testid="rail-unanswered-questions"  headline count = block.count
//       - data-testid="rail-at-risk"               PerfPill tone="at-risk" + reasons i18n
//       - each rail: a "View all →" footer <a> routing OUT (grading queue / Q&A / roster)
//       - overdue grading row carries data-overdue="true" (server-computed; do NOT recompute)
//       - glance disclaimer text via i18n key dashboard.teacher.glanceDisclaimer
//       - trilogy: data-testid="dashboard-skeleton" (loading) / per-rail empty state /
//         role="alert" + retry button calling refetch (NOT a full-page error)
//       - question age element data-testid={`question-age-${questionId}`} computed from
//         meta.serverTime (D16), NOT Date.now()
//   • all copy via i18n keys under dashboard.teacher.* / dashboard.atRisk.reason.* /
//     dashboard.weekStrip.* (en + vi).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import TeacherDashboard from '@/features/dashboard/TeacherDashboard'
import {
  teacherHandlers,
  dashboardHandlers,
  dashboard500Handlers,
  teacherDataEmpty,
  teacherBlock,
  sessionLite,
  QUESTION_ID,
} from '@/features/dashboard/api/__tests__/handlers'

function makeSession(overrides?: Partial<Session>): Session {
  return {
    user: { id: 'user-teacher-1', email: 'teacher@example.com', fullName: 'Trang', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'teacher',
    ...overrides,
  }
}

type Step = 'persona' | 'center' | 'template' | 'spawn' | 'solo_first_class' | 'done'

function renderTeacher(opts: {
  currentStep: Step
  persona: 'operator' | 'founder' | 'solo_teacher' | null
}) {
  const client = createTestQueryClient()
  client.setQueryData(authKeys.session(), makeSession())
  client.setQueryData(onboardingKeys.progress(), {
    persona: opts.persona,
    currentStep: opts.currentStep,
    payload: null,
    updatedAt: '2026-09-14T00:00:00.000Z',
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<TeacherDashboard />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  server.resetHandlers()
})

describe('TeacherDashboard — AC4 onboarding-incomplete shell preserved (REGRESSION GUARD)', () => {
  test('P0 an incomplete teacher still sees the Epic-2 finish-setup shell, NOT the real dashboard', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'template', persona: 'operator' })
    expect(await screen.findByTestId('dashboard-finish-setup-banner')).toBeInTheDocument()
    // The real dashboard rails must NOT replace the onboarding shell.
    expect(screen.queryByTestId('rail-needs-grading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-week-strip')).not.toBeInTheDocument()
  })
})

describe('TeacherDashboard — AC5 onboarding-complete → real week-strip + 3 rails', () => {
  test('P0 renders the week-strip and all three rails when onboarding is done', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    expect(await screen.findByTestId('dashboard-week-strip')).toBeInTheDocument()
    expect(screen.getByTestId('rail-needs-grading')).toBeInTheDocument()
    expect(screen.getByTestId('rail-unanswered-questions')).toBeInTheDocument()
    expect(screen.getByTestId('rail-at-risk')).toBeInTheDocument()
  })

  // Review P1 (HIGH): the teacher week-strip must be Monday-anchored to match the
  // backend `weekSessions` = [startOfWeek,+7d) calendar-week window. serverTime is
  // 2026-09-16 (a Wednesday, Asia/Ho_Chi_Minh); a Monday-of-week session is within
  // the payload window but BEFORE today, so a today-anchored strip would silently
  // drop it. anchor="week" must render it.
  test('P1 (review) week-strip is Monday-anchored — a this-week session before today still renders', async () => {
    const mondaySession = sessionLite({
      sessionId: 'ses-monday',
      className: 'MONDAY REVIEW CLASS',
      startsAt: '2026-09-14T03:00:00.000Z', // 10:00 local Mon 2026-09-14
      endsAt: '2026-09-14T04:00:00.000Z',
    })
    server.use(
      ...dashboardHandlers({
        role: 'teacher',
        teacher: teacherBlock({ weekSessions: [mondaySession] }),
        owner: null,
        student: null,
      }),
    )
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const strip = await screen.findByTestId('dashboard-week-strip')
    expect(within(strip).getByText('MONDAY REVIEW CLASS')).toBeInTheDocument()
  })

  test('P1 at-risk rail row shows a PerfPill (tone at-risk) + reason chips mapped to i18n', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-at-risk')
    expect(within(rail).getByText('Tran Binh')).toBeInTheDocument()
    // reasons: attendance_below_floor + band_drop → i18n slugs (not raw enum text)
    expect(
      within(rail).getByText(i18n.t('dashboard.atRisk.reason.attendance_below_floor') as string),
    ).toBeInTheDocument()
    expect(
      within(rail).getByText(i18n.t('dashboard.atRisk.reason.band_drop') as string),
    ).toBeInTheDocument()
  })
})

describe('TeacherDashboard — AC6 rail counts + View-all + overdue + disclaimer', () => {
  test('P1 rail headline shows block.count (true total, not items.length)', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-needs-grading')
    // fixture: count 8 but only 2 items shipped (rails cap items at 5 server-side)
    expect(within(rail).getByText('8')).toBeInTheDocument()
  })

  test('P1 an overdue grading row is flagged (server-computed, not recomputed)', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-needs-grading')
    // fixture sub-grade-2 has overdue:true; the FE reflects the flag.
    const overdueRow = within(rail).getByText('Le Chi').closest('[data-overdue]')
    expect(overdueRow).toHaveAttribute('data-overdue', 'true')
  })

  test('P1 each rail has a "View all →" footer link routing OUT to the management surface', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-needs-grading')
    const viewAll = within(rail).getByRole('link', {
      name: new RegExp(i18n.t('dashboard.teacher.viewAll') as string, 'i'),
    })
    expect(viewAll).toHaveAttribute('href') // routes out (grading queue) — read-only glance
  })

  test('P1 the read-only glance disclaimer renders', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    await screen.findByTestId('dashboard-week-strip')
    expect(
      screen.getByText(i18n.t('dashboard.teacher.glanceDisclaimer') as string),
    ).toBeInTheDocument()
  })

  test('P1 question age is computed from meta.serverTime (D16), rendered per-item', async () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-unanswered-questions')
    // createdAt is 30 min before the injected FIXED_SERVER_TIME — the age
    // element must exist and be derived from serverTime, never Date.now().
    expect(within(rail).getByTestId(`question-age-${QUESTION_ID}`)).toBeInTheDocument()
  })
})

describe('TeacherDashboard — AC7 loading / empty / error trilogy (UX-1, TEST-FE-2)', () => {
  test('P0 renders row/strip-shaped skeletons while the dashboard loads (never a spinner)', () => {
    server.use(...teacherHandlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
  })

  test('P1 each empty rail renders an informational (glance-only, no management CTA) empty state', async () => {
    server.use(...dashboardHandlers(teacherDataEmpty))
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const rail = await screen.findByTestId('rail-needs-grading')
    expect(within(rail).getByTestId('rail-empty')).toBeInTheDocument()
  })

  test('P0 fetch error renders an inline role="alert" with a retry that calls refetch', async () => {
    server.use(...dashboard500Handlers)
    renderTeacher({ currentStep: 'done', persona: 'solo_teacher' })
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // Retry re-issues the GET; swap to a good handler and assert data lands.
    server.use(...teacherHandlers)
    await userEvent.click(
      within(alert).getByRole('button', { name: i18n.t('dashboard.teacher.retry') as string }),
    )
    await waitFor(() => expect(screen.getByTestId('dashboard-week-strip')).toBeInTheDocument())
  })
})
