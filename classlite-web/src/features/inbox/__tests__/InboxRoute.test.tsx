/**
 * InboxRoute — Story 10-1b AC1 (role dispatch, no gate). Seeds role on the
 * module-singleton queryClient (useRole subscribes to it); the inbox data query
 * runs against a separate test client + MSW. Pins: exactly the caller's role view
 * mounts (TEST-FE-6 assert-absence), the checking state shows mid-hydration, and a
 * settled-null role redirects to /login (the route is ungated — every role has an
 * inbox).
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'

import { InboxRoute } from '../InboxRoute'

const EMPTY_LIST = {
  data: [],
  meta: { serverTime: '2026-10-07T12:00:00Z', pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
}

function seedSession(role: Role | null): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u1', email: 'u@example.com', fullName: 'U', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'C',
      shortCode: 'c',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function renderRoute(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inbox']}>
          <Routes>
            <Route path="/inbox" element={<InboxRoute />} />
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.use(http.get('/api/inbox', () => HttpResponse.json(EMPTY_LIST)))
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

describe('InboxRoute — role dispatch (AC1)', () => {
  test.each([
    ['student', 'inbox-view-student'],
    ['teacher', 'inbox-view-teacher'],
    ['admin', 'inbox-view-admin'],
    ['owner', 'inbox-view-owner'],
  ] as const)('%s mounts exactly its own role view', async (role, testid) => {
    seedSession(role)
    renderRoute()
    expect(await screen.findByTestId(testid)).toBeInTheDocument()
    for (const other of ['inbox-view-student', 'inbox-view-teacher', 'inbox-view-admin', 'inbox-view-owner']) {
      if (other !== testid) expect(screen.queryByTestId(other)).not.toBeInTheDocument()
    }
  })

  test('role unresolved (role null, center present) shows the checking state, not a view', () => {
    seedSession(null)
    renderRoute()
    expect(screen.getByTestId('inbox-checking')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-view-student')).not.toBeInTheDocument()
  })

  test('settled null role (unauthenticated) redirects to /login — the route is ungated', async () => {
    // no session seeded → useRole null, useRoleLoading false.
    renderRoute()
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-checking')).not.toBeInTheDocument()
  })
})
