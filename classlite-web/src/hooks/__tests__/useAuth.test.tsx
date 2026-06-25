/**
 * useAuth — cache-subscribing version (Story 1-8 AC5).
 *
 * Per Murat #1 mandate, every test under hooks/auth/features uses
 * `createTestQueryClient()` + its own `<QueryClientProvider>`. The
 * global singleton `queryClient` is NEVER touched here — the
 * `afterEach(queryClient.clear())` in `vitest-setup.ts` is the
 * suspenders; this is the belt.
 */
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { createTestQueryClient } from '@/lib/query-client'
import { useAuth } from '@/hooks/useAuth'
import {
  __resetAuthRefreshStateForTests,
  runBootProbe,
} from '@/lib/auth-refresh'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  __resetAuthRefreshStateForTests()
})

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

const verifiedSession: Session = {
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    fullName: 'Alice Tran',
    emailVerified: true,
  },
  accessToken: 'jwt.access',
}

const unverifiedSession: Session = {
  user: {
    id: 'user-2',
    email: 'bob@example.com',
    fullName: 'Bob Nguyen',
    emailVerified: false,
  },
  accessToken: null,
}

describe('useAuth — cache-subscribing version (Story 1-8 AC5)', () => {
  test('returns { user: null, isAuthenticated: false } when session cache is empty (initialData: null)', () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(client),
    })
    expect(result.current).toEqual({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })
  })

  test('returns user shape with displayName mapped from session.user.fullName', () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), verifiedSession)
    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(client),
    })
    expect(result.current.user).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice Tran',
      emailVerified: true,
    })
  })

  test('isAuthenticated is true only when user.emailVerified === true (NOT when accessToken is truthy alone)', () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), {
      ...verifiedSession,
      // Truthy accessToken, but emailVerified false — must NOT authenticate.
      user: { ...verifiedSession.user, emailVerified: false },
    })
    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(client),
    })
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user?.emailVerified).toBe(false)
  })

  test('isAuthenticated is false for a registered-but-unverified user (user present, accessToken null, emailVerified false)', () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), unverifiedSession)
    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(client),
    })
    expect(result.current.user).not.toBeNull()
    expect(result.current.user?.displayName).toBe('Bob Nguyen')
    expect(result.current.isAuthenticated).toBe(false)
  })

  test('isLoading flips true while runBootProbe is in flight and back to false on resolution (D2 amendment)', async () => {
    let resolveRefresh: (value: unknown) => void = () => {}
    server.use(
      http.post('/api/auth/refresh', () => {
        return new Promise<Response>((resolve) => {
          resolveRefresh = (value) => {
            resolve(value as Response)
          }
        })
      }),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(client),
    })
    expect(result.current.isLoading).toBe(false)
    // Fire the probe — flag should transition to true synchronously
    // (the wrapper sets bootProbeInFlight before awaiting).
    const probe = act(async () => {
      void runBootProbe()
      // Wait a microtask so the listener fires and React commits.
      await Promise.resolve()
    })
    await probe
    expect(result.current.isLoading).toBe(true)
    await act(async () => {
      resolveRefresh(
        HttpResponse.json({
          data: {
            accessToken: 'jwt.probe',
            user: {
              id: 'u',
              email: 'a@a.com',
              fullName: 'A',
              emailVerified: true,
            },
          },
        }),
      )
      // Two microtasks — one for the refresh await, one for the
      // bootProbeInFlight = false transition.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.isLoading).toBe(false)
  })

  test('useAuth re-renders sibling consumer when setQueryData fires from a separate component tree (Murat #5)', async () => {
    const client = createTestQueryClient()

    function Sibling() {
      const { isAuthenticated, user } = useAuth()
      return (
        <div>
          <span data-testid="auth-state">
            {isAuthenticated ? 'authenticated' : 'guest'}
          </span>
          <span data-testid="user-name">{user?.displayName ?? 'no-user'}</span>
        </div>
      )
    }

    render(
      <QueryClientProvider client={client}>
        <Sibling />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('auth-state').textContent).toBe('guest')
    expect(screen.getByTestId('user-name').textContent).toBe('no-user')

    // A separate component tree (e.g., a useLogin mutation) writes the
    // session cache. The sibling MUST re-render — this is the cache
    // subscription contract that makes the mutations work without
    // prop-drilling the session.
    await act(async () => {
      client.setQueryData(authKeys.session(), verifiedSession)
    })

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated')
    expect(screen.getByTestId('user-name').textContent).toBe('Alice Tran')
  })
})
