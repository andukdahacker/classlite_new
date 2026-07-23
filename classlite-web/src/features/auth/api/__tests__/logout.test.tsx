/**
 * useLogout — sign-out tears down BOTH server + client session state.
 *
 * Guards the fix for the onboarding "Sign out" affordance, which used to
 * navigate to a bare `/logout` URL (a 404, and never called the API — so the
 * refresh cookie was never cleared). These tests pin that the hook (1) POSTs
 * to /api/auth/logout and (2) clears the session cache — on both the success
 * and the failure path (best-effort teardown).
 *
 * Per-test `createTestQueryClient()` discipline — the global singleton is
 * never mutated.
 */
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { createTestQueryClient } from '@/lib/query-client'
import { useLogout } from '@/features/auth/api/logout'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, null, children),
    )
  }
}

function seedSession(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: {
      id: 'u1',
      email: 'trang@example.com',
      fullName: 'Trang',
      emailVerified: true,
    } as unknown as Session['user'],
    accessToken: 'a.b.c',
    center: null,
    role: 'owner',
  })
}

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('useLogout', () => {
  test('POSTs /api/auth/logout and clears the session cache to null', async () => {
    let logoutCalled = 0
    server.use(
      http.post('/api/auth/logout', () => {
        logoutCalled++
        return HttpResponse.json({ data: { loggedOut: true } })
      }),
    )
    const client = createTestQueryClient()
    seedSession(client)
    const { result } = renderHook(() => useLogout(), { wrapper: wrap(client) })

    await result.current.mutateAsync()

    expect(logoutCalled).toBe(1)
    // `null`, NOT `undefined` — the App.tsx boot probe distinguishes an
    // explicitly-logged-out session from a never-hydrated one.
    expect(client.getQueryData(authKeys.session())).toBeNull()
  })

  test('best-effort: clears the session cache even when the API call fails', async () => {
    server.use(
      http.post('/api/auth/logout', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', details: null } },
          { status: 500 },
        ),
      ),
    )
    const client = createTestQueryClient()
    seedSession(client)
    const { result } = renderHook(() => useLogout(), { wrapper: wrap(client) })

    await result.current.mutateAsync().catch(() => {})

    await waitFor(() =>
      expect(client.getQueryData(authKeys.session())).toBeNull(),
    )
  })
})
