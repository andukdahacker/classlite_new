/**
 * useRoleLoading — Story 2.6 (AC3, Murat-STRONG-3 amendment).
 *
 * 4 explicit cases:
 *   1. isLoading=true, session=null           → true (boot probe in flight)
 *   2. isLoading=false, session.role='owner',
 *      session.center!=null                   → false (real session)
 *   3. isLoading=false, session.role=null,
 *      session.center=null                    → false (unauthenticated)
 *   4. isLoading=false, session.role=null,
 *      session.center!=null                   → true (deploy-window belt:
 *                                                    session hydrated but
 *                                                    role hasn't landed yet)
 *
 * The boot-probe case uses `runBootProbe` from auth-refresh to flip the
 * shared bootProbeInFlight flag that `useAuth().isLoading` reads.
 * Cases 2-4 don't need it — the flag defaults to false.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useRoleLoading } from '@/hooks/useRole'
import {
  authKeys,
  type CenterSummary,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import { queryClient as moduleQueryClient } from '@/lib/query-client'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { server } from '@/test/msw-server'
import { http } from 'msw'

const STUB_USER: UserSummary = {
  id: 'u-1',
  email: 'trang@example.com',
  fullName: 'Trang',
  emailVerified: true,
}
const STUB_CENTER: CenterSummary = {
  id: 'c-1',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format fixture
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

// useRole/useRoleLoading (Story 2.6 Task 6.3) subscribe to the module-
// singleton queryClient — seed the singleton so the hook observes the
// value under test.
function makeClient(session: Session | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (session) {
    moduleQueryClient.setQueryData<Session>(authKeys.session(), session)
  } else {
    moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
  }
  return client
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  __resetAuthRefreshStateForTests()
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('useRoleLoading — Story 2.6 AC3 explicit 4-case matrix', () => {
  test('Case 1: isLoading=true + session=null → true (boot probe in flight)', async () => {
    // Stall the refresh so the boot probe stays in flight while we read
    // the hook. Never resolves within the test — teardown clears it.
    server.use(
      http.post('/api/auth/refresh', () =>
        new Promise<Response>(() => {
          // never resolves — the boot probe stays in flight for the
          // duration of this test render
        }),
      ),
    )
    const client = makeClient(null)
    // Fire the boot probe (fire-and-forget) so `bootProbeInFlight` flips.
    const { runBootProbe } = await import('@/lib/auth-refresh')
    void runBootProbe()
    const wrapper = wrapperFor(client)
    const { result } = renderHook(() => useRoleLoading(), { wrapper })
    expect(result.current).toBe(true)
  })

  test('Case 2: isLoading=false + session.role=owner + center non-null → false', () => {
    const client = makeClient({
      user: STUB_USER,
      accessToken: 'a.b.c',
      center: STUB_CENTER,
      role: 'owner',
    })
    const { result } = renderHook(() => useRoleLoading(), {
      wrapper: wrapperFor(client),
    })
    expect(result.current).toBe(false)
  })

  test('Case 3: isLoading=false + session.role=null + center null → false (unauthenticated)', () => {
    const client = makeClient({
      user: STUB_USER,
      accessToken: null,
      center: null,
      role: null,
    })
    const { result } = renderHook(() => useRoleLoading(), {
      wrapper: wrapperFor(client),
    })
    expect(result.current).toBe(false)
  })

  test('Case 4: isLoading=false + session.role=null + center non-null → true (deploy-window belt)', () => {
    // Pre-Story 2.6 session cache entry — user has a center (onboarded)
    // but role hasn't landed yet. useRoleLoading MUST return true so the
    // RouteRoleGate renders the loading fallback instead of PermissionDenied.
    const client = makeClient({
      user: STUB_USER,
      accessToken: 'a.b.c',
      center: STUB_CENTER,
      role: null,
    })
    const { result } = renderHook(() => useRoleLoading(), {
      wrapper: wrapperFor(client),
    })
    expect(result.current).toBe(true)
  })
})
