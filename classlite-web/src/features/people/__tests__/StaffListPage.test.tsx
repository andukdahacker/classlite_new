// ATDD RED-PHASE — Story 7-1b, Task 4 (s39 staff list). AC3–7.
//
// RED signal: `@/features/people/StaffListPage` does not exist yet (TS2307 /
// Vitest import failure). Every other symbol here is real. No `test.skip()` —
// repo convention is compile-fail red ([[reference_atdd_red_convention]]).
//
// Harness mirrors ClassesPage.test.tsx EXACTLY: role is seeded on the
// MODULE-SINGLETON queryClient via setQueryData(authKeys.session(), …) because
// useRole subscribes to the singleton; the page's own useQuery runs against a
// SEPARATE createTestQueryClient() provider. MSW is the ONE mock seam (TEST-FE-1
// — never mock useQuery).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • data-testid="staff-row-skeleton" (≥1 while loading; row-shaped, NOT a spinner)
//   • data-testid="staff-row-{userId}" per member row
//   • data-testid="pending-invite-row-{inviteId}" per pending row (dimmed `??` avatar)
//   • role="tab" buttons named All / Active / Pending / Archived (i18n keys), with
//     mono count superscripts; aria-current / aria-selected on the active tab
//   • data-testid="staff-empty" empty-state shell w/ the "Invite staff" action
//   • role="alert" inline error + a retry button that calls refetch
//   • data-testid="owner-excluded-note" (AC6)
//   • data-testid="load-meter" rendering the "N/cap" label (e.g. "7/10")
//   • member name is a link/navigates to /people/staff/{userId}; pending row is inert
//   • all copy via i18n keys under people.staff.* (TEST-FE-4)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
// RED: this module does not exist yet — the whole file fails to import.
import { StaffListPage } from '@/features/people/StaffListPage'
import {
  DEFAULT_CENTER_ID,
  ADMIN_A_ID,
  TEACHER_ACTIVE_ID,
  TEACHER_HEAVY_ID,
  PENDING_INVITE_ID,
  memberActiveTeacher,
  memberArchivedTeacher,
  rosterHandlers,
  rosterEmptyHandlers,
  roster500Handlers,
} from '@/features/people/api/__tests__/handlers'

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

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderList(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/people/staff']}>
          <LocationProbe />
          <Routes>
            <Route path="/people/staff" element={<StaffListPage />} />
            <Route
              path="/people/staff/:userId"
              element={<div data-testid="detail-stub" />}
            />
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

describe('StaffListPage — AC5 three-state trilogy (UX-1, TEST-FE-2)', () => {
  test('P0 renders row-shaped skeletons while loading (never a spinner)', () => {
    server.use(...rosterHandlers())
    renderList('owner')
    expect(screen.getAllByTestId(/^staff-row-skeleton/).length).toBeGreaterThanOrEqual(1)
  })

  test('P0 renders member rows on success', async () => {
    server.use(...rosterHandlers())
    renderList('owner')
    expect(await screen.findByText(memberActiveTeacher.name)).toBeInTheDocument()
    expect(screen.getByTestId(`staff-row-${TEACHER_ACTIVE_ID}`)).toBeInTheDocument()
  })

  test('P1 renders a role-appropriate empty state with the Invite CTA', async () => {
    server.use(...rosterEmptyHandlers)
    renderList('owner')
    expect(await screen.findByTestId('staff-empty')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('people.staff.list.inviteCta') }),
    ).toBeInTheDocument()
  })

  test('P0 renders an inline error alert with a working retry on 500', async () => {
    server.use(...roster500Handlers)
    renderList('owner')
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // Retry re-issues the GET; swap to a good handler and assert data lands.
    server.use(...rosterHandlers())
    await userEvent.click(
      within(alert).getByRole('button', { name: i18n.t('people.staff.list.retry') }),
    )
    expect(await screen.findByText(memberActiveTeacher.name)).toBeInTheDocument()
  })
})

describe('StaffListPage — AC3 columns + LoadMeter (D8)', () => {
  test('P1 a member row shows the LoadMeter "N/cap" label', async () => {
    server.use(...rosterHandlers())
    renderList('owner')
    const row = await screen.findByTestId(`staff-row-${TEACHER_ACTIVE_ID}`)
    expect(within(row).getByTestId('load-meter')).toHaveTextContent('7/10')
  })

  test('P1 LoadMeter amber styling is driven by server load.heavy, not a client threshold', async () => {
    server.use(...rosterHandlers())
    renderList('owner')
    const heavyRow = await screen.findByTestId(`staff-row-${TEACHER_HEAVY_ID}`)
    // heavy fixture: heavy===true. The FE computes NO threshold — it reflects the flag.
    expect(within(heavyRow).getByTestId('load-meter')).toHaveAttribute(
      'data-heavy',
      'true',
    )
    const activeRow = screen.getByTestId(`staff-row-${TEACHER_ACTIVE_ID}`)
    expect(within(activeRow).getByTestId('load-meter')).toHaveAttribute(
      'data-heavy',
      'false',
    )
  })
})

describe('StaffListPage — AC4 tabs + client-side counts', () => {
  test('P1 renders All/Active/Pending/Archived tabs', async () => {
    server.use(...rosterHandlers())
    renderList('owner')
    await screen.findByText(memberActiveTeacher.name)
    for (const key of ['all', 'active', 'pending', 'archived'] as const) {
      expect(
        screen.getByRole('tab', { name: new RegExp(i18n.t(`people.staff.tabs.${key}`), 'i') }),
      ).toBeInTheDocument()
    }
  })

  test('P1 Pending tab lists pendingInvites with a dimmed `??` avatar; row is non-navigable (AC7)', async () => {
    server.use(...rosterHandlers())
    const user = userEvent.setup()
    renderList('owner')
    await screen.findByText(memberActiveTeacher.name)

    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.staff.tabs.pending'), 'i') }))
    const pendingRow = await screen.findByTestId(`pending-invite-row-${PENDING_INVITE_ID}`)
    expect(within(pendingRow).getByText('??')).toBeInTheDocument()

    // A pending row has no member detail yet — clicking it must not navigate.
    await user.click(pendingRow)
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument()
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/people/staff')
  })

  test('P1 Archived tab shows the archived member and NOT the active member (negative)', async () => {
    server.use(...rosterHandlers())
    const user = userEvent.setup()
    renderList('owner')
    await screen.findByText(memberActiveTeacher.name)

    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.staff.tabs.archived'), 'i') }))
    expect(await screen.findByText(memberArchivedTeacher.name)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(memberActiveTeacher.name)).not.toBeInTheDocument()
    })
  })
})

describe('StaffListPage — AC6 owner exclusion', () => {
  test('P1 no owner row is rendered and an explanatory note is present', async () => {
    server.use(...rosterHandlers())
    renderList('owner')
    await screen.findByText(memberActiveTeacher.name)
    // The seeded owner (owner@example.com) must never appear as a roster row.
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument()
    expect(screen.getByTestId('owner-excluded-note')).toBeInTheDocument()
    // Admin members DO appear (they are staff).
    expect(screen.getByTestId(`staff-row-${ADMIN_A_ID}`)).toBeInTheDocument()
  })
})

describe('StaffListPage — AC7 row navigation', () => {
  test('P0 clicking a member row navigates to /people/staff/{userId}', async () => {
    server.use(...rosterHandlers())
    const user = userEvent.setup()
    renderList('owner')
    const nameLink = await screen.findByRole('link', { name: memberActiveTeacher.name })
    expect(nameLink).toHaveAttribute('href', `/people/staff/${TEACHER_ACTIVE_ID}`)
    await user.click(nameLink)
    expect(await screen.findByTestId('detail-stub')).toBeInTheDocument()
  })
})
