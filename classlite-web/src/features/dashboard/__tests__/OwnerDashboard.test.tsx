// ATDD RED-PHASE — Story 8-1b, Task 5 (OwnerDashboard: owner+admin, s48).
// AC8, AC9, AC10, AC11 (+ AC20 owner+admin render, live-now serverTime, axe).
//
// RED signal: `@/features/dashboard/OwnerDashboard` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • <OwnerDashboard> at src/features/dashboard/OwnerDashboard.tsx — one
//     component serves owner AND admin (D9). Root data-testid="owner-dashboard".
//   • data-testid="owner-pulse" with 4-up StatTiles (Geist Mono):
//       data-testid={`pulse-stat-${key}`} for activeClasses / studentsEnrolled /
//       staffActiveToday / sessionsThisWeek (or sessionsToday). (load `dataviz` first)
//   • data-testid="today-sessions" list; a session with startsAt<=serverTime<endsAt
//       carries data-testid={`session-live-${sessionId}`} + amber treatment (D16).
//       teacherName + enrolledCount rendered (both non-null on owner.todaySessions).
//   • data-testid="needs-attention-card" (pre-bundled block, D8) with zones:
//       unassigned / at-risk / storage capacity / pending invites — each an action
//       link routing OUT. data-testid="storage-capacity-meter" shows
//       Math.round(percentUsed*100)+"%" + human bytes; data-approaching="true"
//       ⇒ amber when capacity.approaching.
//   • NO Q&A rail anywhere (D10). NeedsAttentionList is NOT mounted — the page
//       must make exactly ONE fetch (/api/dashboard); /api/enrollments/attention
//       is NEVER called (D8).
//   • trilogy: dashboard-skeleton / per-zone empty copy / role="alert" + retry.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
// RED: this module does not exist yet — the whole file fails to import.
import { OwnerDashboard } from '@/features/dashboard/OwnerDashboard'
import {
  ownerHandlers,
  adminHandlers,
  dashboardHandlers,
  dashboard500Handlers,
  ownerDataEmpty,
  ownerData,
  ownerBlock,
  needsAttentionBlock,
  capacityApproaching,
  SESSION_LIVE_ID,
  SESSION_PAST_ID,
} from '@/features/dashboard/api/__tests__/handlers'

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'user-owner-1', email: 'owner@example.com', fullName: 'Center Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
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

function renderOwner(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<OwnerDashboard />} />
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

describe('OwnerDashboard — AC8 center-pulse row', () => {
  test('P1 renders the 4-up pulse from owner.pulse', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    const pulse = await screen.findByTestId('owner-pulse')
    expect(within(pulse).getByTestId('pulse-stat-activeClasses')).toHaveTextContent('12')
    expect(within(pulse).getByTestId('pulse-stat-studentsEnrolled')).toHaveTextContent('148')
    expect(within(pulse).getByTestId('pulse-stat-staffActiveToday')).toHaveTextContent('5')
  })
})

describe('OwnerDashboard — AC20/D9 owner AND admin both render OwnerDashboard', () => {
  test('P0 admin session renders the same owner surfaces', async () => {
    server.use(...adminHandlers)
    seedSession('admin')
    renderOwner()
    expect(await screen.findByTestId('owner-dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('owner-pulse')).toBeInTheDocument()
  })
})

describe('OwnerDashboard — AC9 today-across-the-center + live-now (serverTime, D16)', () => {
  test('P1 the in-progress session is marked live; the ended session is NOT', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    const today = await screen.findByTestId('today-sessions')
    // live = startsAt <= serverTime(10:00Z) < endsAt — asserted against the
    // INJECTED meta.serverTime, never a real clock.
    expect(within(today).getByTestId(`session-live-${SESSION_LIVE_ID}`)).toBeInTheDocument()
    expect(within(today).queryByTestId(`session-live-${SESSION_PAST_ID}`)).not.toBeInTheDocument()
    // teacherName + enrolledCount are non-null on owner.todaySessions.
    expect(within(today).getByText('Pham Teacher')).toBeInTheDocument()
    expect(within(today).getByText(/18/)).toBeInTheDocument()
  })
})

describe('OwnerDashboard — AC10 needs-attention (D8) + storage capacity (D7)', () => {
  test('P0 renders the pre-bundled needs-attention zones (no NeedsAttentionList mount)', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    const card = await screen.findByTestId('needs-attention-card')
    expect(within(card).getByTestId('storage-capacity-meter')).toBeInTheDocument()
    // pending invites count + unassigned zone present.
    expect(within(card).getByText('Do Dung')).toBeInTheDocument()
  })

  test('P0 storage meter shows percentUsed*100 (fraction→percent) — never the raw fraction', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    const meter = await screen.findByTestId('storage-capacity-meter')
    // capacity fixture: percentUsed 0.6 → "60%", NOT "0.6" and NOT "0.6%".
    expect(meter).toHaveTextContent('60%')
    expect(meter).not.toHaveTextContent('0.6%')
  })

  test('P1 capacity turns amber only when approaching===true (server-driven)', async () => {
    const approachingData = {
      ...ownerData,
      owner: ownerBlock({
        needsAttention: needsAttentionBlock({ capacity: capacityApproaching }),
      }),
    }
    server.use(...dashboardHandlers(approachingData))
    seedSession('owner')
    renderOwner()
    const meter = await screen.findByTestId('storage-capacity-meter')
    expect(meter).toHaveAttribute('data-approaching', 'true')
    expect(meter).toHaveTextContent('92%')
  })

  test('P0 there is NO Q&A rail on the owner dashboard (D10)', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    await screen.findByTestId('owner-dashboard')
    expect(screen.queryByTestId('rail-unanswered-questions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-my-questions')).not.toBeInTheDocument()
  })

  test('P0 the page NEVER calls /api/enrollments/attention (NeedsAttentionList not mounted — no 2nd fetch)', async () => {
    let attentionCalled = false
    server.use(
      ...ownerHandlers,
      http.get('/api/enrollments/attention', () => {
        attentionCalled = true
        return HttpResponse.json({ data: null })
      }),
    )
    seedSession('owner')
    renderOwner()
    await screen.findByTestId('needs-attention-card')
    expect(attentionCalled).toBe(false)
  })
})

describe('OwnerDashboard — AC11 trilogy', () => {
  test('P0 renders skeletons while loading (never a spinner)', () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderOwner()
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
  })

  test('P1 empty needs-attention zones render per-zone empty copy (AC11)', async () => {
    server.use(...dashboardHandlers(ownerDataEmpty))
    seedSession('owner')
    renderOwner()
    const card = await screen.findByTestId('needs-attention-card')
    // Per-zone empty copy — NOT a single aggregate "all clear" (AC11): every
    // actionable zone surfaces its own empty line so a clear zone never masks
    // another that still needs attention.
    expect(within(card).getByTestId('attention-unassigned-empty')).toBeInTheDocument()
    expect(within(card).getByTestId('attention-at-risk-empty')).toBeInTheDocument()
    expect(within(card).getByTestId('attention-over-capacity-empty')).toBeInTheDocument()
    expect(within(card).getByTestId('attention-pending-invites-empty')).toBeInTheDocument()
    // The old aggregate empty state is gone.
    expect(within(card).queryByTestId('needs-attention-empty')).not.toBeInTheDocument()
  })

  test('P0 fetch error renders an inline role="alert" retry', async () => {
    server.use(...dashboard500Handlers)
    seedSession('owner')
    renderOwner()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('OwnerDashboard — AC20 accessibility (TEST-FE-5)', () => {
  test('P1 has no axe violations on the loaded owner dashboard', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    const { container } = (() => {
      const client = createTestQueryClient()
      return render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/dashboard']}>
              <Routes>
                <Route path="/dashboard" element={<OwnerDashboard />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>,
      )
    })()
    await screen.findByTestId('owner-dashboard')
    expect(await axe(container)).toHaveNoViolations()
  })
})
