/**
 * AppLayout — Story 10-1b AC4 (inbox unread badge wiring). Seeds Session.role on
 * the module-singleton queryClient (the production useRole path) and lets the real
 * useInboxCount poller fetch `/api/inbox/count` via MSW (TEST-FE-1 — no hook mock).
 * Pins: the sidebar `/inbox` item shows the count badge when > 0, shows NO badge at
 * 0 (negative assertion), and the count query is DISABLED for a null/guest role
 * (no `/count` fetch → no 401-storm).
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'

import AppLayout from '@/components/shared/AppLayout'
import { __resetWarnTrackingForTests } from '@/components/shared/AppLayout-warn-tracking'
import { useUIStore } from '@/stores/uiStore'
import { useLanguageStore } from '@/stores/languageStore'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { queryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'
import i18n from '@/lib/i18n'

function seedSession(role: Role | null): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u-1', email: 'u@example.com', fullName: 'U', emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: 'c-1', name: 'C', shortCode: 'c', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role,
  })
}

function renderLayout(role: Role | null): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seedSession(role)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: () => <AppLayout />,
        children: [{ index: true, element: <div data-testid="route-child" /> }],
      },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  useUIStore.getState().reset()
  useLanguageStore.getState().reset()
  __resetWarnTrackingForTests()
  queryClient.removeQueries({ queryKey: authKeys.session() })
  queryClient.removeQueries({ queryKey: ['inbox'] })
})
afterEach(() => {
  useUIStore.getState().reset()
  useLanguageStore.getState().reset()
  queryClient.removeQueries({ queryKey: authKeys.session() })
  queryClient.removeQueries({ queryKey: ['inbox'] })
  server.resetHandlers()
})

describe('AppLayout — inbox badge wiring (AC4)', () => {
  test('sidebar /inbox item shows the unread count badge when > 0', async () => {
    server.use(
      http.get('/api/inbox/count', () =>
        HttpResponse.json({ data: { unread: 5 }, meta: { serverTime: '2026-10-07T12:00:00Z' } }),
      ),
    )
    renderLayout('owner')
    const item = await screen.findByTestId('sidebar-nav-inbox')
    await waitFor(() => expect(within(item).getByText('5')).toBeInTheDocument())
  })

  test('a 0 count renders NO badge (negative assertion)', async () => {
    server.use(
      http.get('/api/inbox/count', () =>
        HttpResponse.json({ data: { unread: 0 }, meta: { serverTime: '2026-10-07T12:00:00Z' } }),
      ),
    )
    renderLayout('student')
    const item = await screen.findByTestId('sidebar-nav-inbox')
    // settle the count fetch, then assert no numeric badge.
    await new Promise((r) => setTimeout(r, 30))
    expect(within(item).queryByText('0')).not.toBeInTheDocument()
  })

  test('the count query is DISABLED for a null/guest role (no /count fetch)', async () => {
    let calls = 0
    server.use(
      http.get('/api/inbox/count', () => {
        calls += 1
        return HttpResponse.json({ data: { unread: 1 }, meta: { serverTime: '2026-10-07T12:00:00Z' } })
      }),
    )
    renderLayout(null)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toBe(0)
  })
})
