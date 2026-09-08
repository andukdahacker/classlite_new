// ATDD RED-PHASE — Story 7-2b, Task 5 (s10 student detail). AC11-14.
//
// RED signal: `@/features/people/StudentDetailPage` does not exist yet.
// No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • data-testid="student-detail-skeleton" while loading
//   • the student name as an <h1>; an inline data-testid="perf-pill-{tone}" in the head
//   • data-testid="student-not-found" on 404 STUDENT_NOT_FOUND (NOT a crash) —
//     this is the teacher out-of-scope non-disclosure surface (7-2a D11)
//   • role="alert" on non-404 error
//   • data-testid="student-stat-strip" with 6 boxes
//   • data-testid="band-score-chart"; data-testid="band-delta-first-month" present
//     iff currentVsFirstDelta != null (OMITTED when null, D10)
//   • data-testid="skill-perf-bars" with a row per skill: data-testid="skill-bar-{skill}";
//     a null skill renders the em-dash token, never "0"
//   • data-testid="student-at-risk-reasons" surfacing atRisk.reasons (D12/AC14)
//   • enrolled-classes list from enrolledClasses[]
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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
import { StudentDetailPage } from '@/features/people/StudentDetailPage'
import {
  DEFAULT_CENTER_ID,
  STUDENT_NORMAL_ID,
  STUDENT_AT_RISK_ID,
  detailNormal,
  detailAtRisk,
  detailHandlers,
  detail404Handlers,
  detail500Handlers,
} from '@/features/people/api/__tests__/studentHandlers'

const STUB_USER: UserSummary = {
  id: 'user-viewer',
  email: 'viewer@example.com',
  fullName: 'Viewer',
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

function renderDetail(role: Role, id: string = STUDENT_NORMAL_ID): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        {/* Owner/admin URL; the same page also mounts at /students/:id (teacher). */}
        <MemoryRouter initialEntries={[`/people/students/${id}`]}>
          <Routes>
            <Route path="/people/students/:id" element={<StudentDetailPage />} />
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

describe('StudentDetailPage — AC11 trilogy + head', () => {
  test('P0 skeleton while loading', () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    expect(screen.getByTestId('student-detail-skeleton')).toBeInTheDocument()
  })

  test('P0 renders the head (name h1 + inline PerfPill) on success', async () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    expect(
      await screen.findByRole('heading', { level: 1, name: detailNormal.profile.name }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('perf-pill-normal')).toBeInTheDocument()
  })

  test('P0 404 STUDENT_NOT_FOUND renders a not-found state, not a crash (teacher out-of-scope)', async () => {
    server.use(...detail404Handlers)
    renderDetail('teacher', STUDENT_AT_RISK_ID)
    expect(await screen.findByTestId('student-not-found')).toBeInTheDocument()
  })

  test('P1 non-404 error renders an inline alert', async () => {
    server.use(...detail500Handlers)
    renderDetail('owner')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('StudentDetailPage — AC12 6-up stat strip', () => {
  test('P1 renders the 6-box stat strip', async () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    await screen.findByRole('heading', { level: 1, name: detailNormal.profile.name })
    const strip = screen.getByTestId('student-stat-strip')
    expect(within(strip).getAllByRole('group').length).toBeGreaterThanOrEqual(6)
  })

  test('P1 a null attendanceRate renders the em-dash token, never "0%"', async () => {
    server.use(...detailHandlers(detailAtRisk))
    renderDetail('owner', STUDENT_AT_RISK_ID)
    await screen.findByRole('heading', { level: 1, name: detailAtRisk.profile.name })
    const strip = screen.getByTestId('student-stat-strip')
    expect(within(strip).queryByText('0%')).not.toBeInTheDocument()
  })
})

describe('StudentDetailPage — AC13 perf-card (BandScoreChart + SkillPerfBars)', () => {
  test('P1 BandScoreChart shows the "vs first month" delta when currentVsFirstDelta != null', async () => {
    server.use(...detailHandlers()) // detailNormal.currentVsFirstDelta === 0.3
    renderDetail('owner')
    await screen.findByRole('heading', { level: 1, name: detailNormal.profile.name })
    expect(screen.getByTestId('band-score-chart')).toBeInTheDocument()
    expect(screen.getByTestId('band-delta-first-month')).toBeInTheDocument()
  })

  test('P0 the "vs first month" delta is OMITTED when currentVsFirstDelta is null (D10)', async () => {
    server.use(...detailHandlers(detailAtRisk)) // currentVsFirstDelta === null
    renderDetail('owner', STUDENT_AT_RISK_ID)
    await screen.findByRole('heading', { level: 1, name: detailAtRisk.profile.name })
    expect(screen.queryByTestId('band-delta-first-month')).not.toBeInTheDocument()
  })

  test('P1 no projection line is rendered (deferred to Epic 8, D14)', async () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    await screen.findByRole('heading', { level: 1, name: detailNormal.profile.name })
    expect(screen.queryByTestId('band-projection')).not.toBeInTheDocument()
  })

  test('P0 SkillPerfBars shows the 4 IELTS skills; a null skill renders em-dash not 0', async () => {
    server.use(...detailHandlers(detailAtRisk)) // speaking + writing are null
    renderDetail('owner', STUDENT_AT_RISK_ID)
    await screen.findByRole('heading', { level: 1, name: detailAtRisk.profile.name })
    const bars = screen.getByTestId('skill-perf-bars')
    for (const skill of ['reading', 'listening', 'writing', 'speaking'] as const) {
      expect(within(bars).getByTestId(`skill-bar-${skill}`)).toBeInTheDocument()
    }
    // The null speaking skill must not render a "0" value.
    expect(within(bars).getByTestId('skill-bar-speaking')).not.toHaveTextContent(/\b0\b/)
  })
})

describe('StudentDetailPage — AC14 at-risk reasons surfaced', () => {
  test('P1 an at-risk student surfaces atRisk.reasons near the head pill', async () => {
    server.use(...detailHandlers(detailAtRisk))
    renderDetail('owner', STUDENT_AT_RISK_ID)
    await screen.findByRole('heading', { level: 1, name: detailAtRisk.profile.name })
    expect(screen.getByTestId('perf-pill-at-risk')).toBeInTheDocument()
    expect(screen.getByTestId('student-at-risk-reasons')).toBeInTheDocument()
  })

  test('P1 the at-risk reason copy exists in BOTH en and vi (TEST-FE-4)', () => {
    for (const lng of ['en', 'vi'] as const) {
      expect(
        i18n.exists('people.student.atRisk.reason.attendanceBelowFloor', { lng }),
      ).toBe(true)
    }
  })
})
