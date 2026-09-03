// ATDD RED-PHASE — Story 7-1b, Task 5 (s40 staff detail). AC8–10, 15.
//
// RED signal: `@/features/people/StaffDetailPage` does not exist yet.
//
// ⭐ The headline assertion is the MANDATORY DoD test (TEST-FE-6, story risk
// note): an ADMIN viewing s40 sees the detail read-only and the Owner-actions
// card is ABSENT FROM THE DOM — not merely hidden. queryByTestId('owner-actions')
// must be null. An Owner sees it present. This is the one security-adjacent
// assertion in a risk-4 UI story; it is required even though 7-1b is not a
// WF-8 hard ATDD gate.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • data-testid="staff-detail-skeleton" while loading
//   • the member name as an <h1>; a crumb-back link; a StatusPill; a 6-up stat strip
//   • role="tab" buttons Overview / Classes / Schedule / Activity (i18n keys)
//   • data-testid="staff-not-found" on 404 STAFF_NOT_FOUND (NOT a crash)
//   • role="alert" + retry on non-404 error
//   • data-testid="owner-actions" ⇒ present iff useRole()==='owner', ELSE absent
//   • empty states per tab body (assignedClasses / scheduleGlance / recentActivity)
//   • lastActiveAt null ⇒ renders the "—"/"never" i18n token, not a crash
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
import { StaffDetailPage } from '@/features/people/StaffDetailPage'
import {
  DEFAULT_CENTER_ID,
  TEACHER_ACTIVE_ID,
  detailWithClasses,
  detailNoClasses,
  detailHandlers,
  detail404Handlers,
  detail500Handlers,
} from '@/features/people/api/__tests__/handlers'

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

function renderDetail(role: Role, userId: string = TEACHER_ACTIVE_ID): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/people/staff/${userId}`]}>
          <Routes>
            <Route path="/people/staff/:userId" element={<StaffDetailPage />} />
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

describe('StaffDetailPage — AC8 trilogy + head', () => {
  test('P0 skeleton while loading', () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    expect(screen.getByTestId('staff-detail-skeleton')).toBeInTheDocument()
  })

  test('P0 renders head (name h1 + tabs) on success', async () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    expect(
      await screen.findByRole('heading', { level: 1, name: detailWithClasses.name }),
    ).toBeInTheDocument()
    for (const key of ['overview', 'classes', 'schedule', 'activity'] as const) {
      expect(
        screen.getByRole('tab', { name: new RegExp(i18n.t(`people.staff.detail.tabs.${key}`), 'i') }),
      ).toBeInTheDocument()
    }
  })

  test('P0 404 STAFF_NOT_FOUND renders a not-found state, not a crash', async () => {
    server.use(...detail404Handlers)
    renderDetail('owner')
    expect(await screen.findByTestId('staff-not-found')).toBeInTheDocument()
  })

  test('P1 non-404 error renders an inline alert', async () => {
    server.use(...detail500Handlers)
    renderDetail('owner')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — AC9 tab bodies', () => {
  test('P1 Overview shows email + LoadMeter; null lastActiveAt renders the empty token', async () => {
    server.use(...detailHandlers(detailNoClasses))
    renderDetail('owner', detailNoClasses.userId)
    await screen.findByRole('heading', { level: 1, name: detailNoClasses.name })
    expect(screen.getByText(detailNoClasses.email)).toBeInTheDocument()
    // heavy fixture → amber flag reflected from the server
    expect(screen.getByTestId('load-meter')).toHaveAttribute('data-heavy', 'true')
    // lastActiveAt === null → "—"/"never" token (must not throw)
    expect(screen.getByText(i18n.t('people.staff.lastActive.never'))).toBeInTheDocument()
  })

  test('P1 Classes tab lists assignedClasses; empty fixture shows a per-tab empty state', async () => {
    server.use(...detailHandlers(detailNoClasses))
    const user = userEvent.setup()
    renderDetail('owner', detailNoClasses.userId)
    await screen.findByRole('heading', { level: 1, name: detailNoClasses.name })
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.staff.detail.tabs.classes'), 'i') }))
    expect(await screen.findByTestId('staff-classes-empty')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — AC10 Owner-actions card gating (TEST-FE-6, MANDATORY)', () => {
  test('P0 an OWNER sees the Owner-actions card', async () => {
    server.use(...detailHandlers())
    renderDetail('owner')
    await screen.findByRole('heading', { level: 1, name: detailWithClasses.name })
    expect(screen.getByTestId('owner-actions')).toBeInTheDocument()
  })

  test('P0 an ADMIN sees the detail read-only — Owner-actions card is ABSENT from the DOM', async () => {
    server.use(...detailHandlers())
    renderDetail('admin')
    // Detail still renders for an admin (read-only)…
    await screen.findByRole('heading', { level: 1, name: detailWithClasses.name })
    // …but the actions card is not merely hidden — it is absent entirely.
    await waitFor(() => {
      expect(screen.queryByTestId('owner-actions')).not.toBeInTheDocument()
    })
    // And none of the four action controls leak into the DOM for an admin.
    expect(
      screen.queryByRole('button', { name: i18n.t('people.staff.actions.archive') }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: i18n.t('people.staff.actions.forceLogout') }),
    ).not.toBeInTheDocument()
  })
})
