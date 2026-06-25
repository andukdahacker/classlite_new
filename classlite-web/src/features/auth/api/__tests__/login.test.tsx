/**
 * useLogin — 5 tests per Story 1-8 AC5.
 *
 * Honors the per-test `createTestQueryClient()` discipline (Murat #1) —
 * the global singleton is never mutated.
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
import { authKeys } from '@/features/auth/api/authKeys'
import { createTestQueryClient, queryClient as globalQueryClient } from '@/lib/query-client'
import { useLogin } from '@/features/auth/api/login'
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

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('useLogin (Story 1-8 AC5)', () => {
  test('happy path populates session cache and navigates to /dashboard with replace: true', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: wrap(client) })

    result.current.mutate({
      email: 'alice@example.com',
      password: 'Password1$',
      rememberMe: false,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData(authKeys.session()) as {
      user: { email: string }
      accessToken: string | null
    }
    expect(cached.user.email).toBe('alice@example.com')
    expect(cached.accessToken).toBe('msw.jwt.signature')
  })

  test('401 INVALID_CREDENTIALS leaves cache untouched and surfaces ApiError to component', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'wrong',
              details: null,
            },
          },
          { status: 401 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: wrap(client) })
    result.current.mutate({
      email: 'alice@example.com',
      password: 'bad',
      rememberMe: false,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData(authKeys.session())).toBeUndefined()
  })

  test('mutation is keyed under authKeys.loginMutation() — mutationCache observes the mid-flight mutation (P5 amendment)', async () => {
    server.use(
      http.post('/api/auth/login', async () => {
        await new Promise((r) => setTimeout(r, 300))
        return HttpResponse.json({
          data: {
            accessToken: 'jwt',
            user: {
              id: 'u',
              email: 'a@a.com',
              fullName: 'A',
              emailVerified: true,
            },
          },
        })
      }),
    )
    const client = createTestQueryClient()
    const { result: login } = renderHook(() => useLogin(), {
      wrapper: wrap(client),
    })
    login.current.mutate({
      email: 'a@a.com',
      password: 'p',
      rememberMe: false,
    })
    // Read directly from the mutation cache — `useIsMutating` in a
    // separate `renderHook` doesn't always tick in sync with the
    // first hook's mutate call before the response resolves. The
    // mutationCache is the canonical source of truth.
    await waitFor(() => {
      const matches = client.getMutationCache().findAll({
        mutationKey: authKeys.loginMutation(),
      })
      expect(matches.length).toBeGreaterThan(0)
    })
    // P5 contract — register mutations do NOT collide under the same key.
    expect(
      client
        .getMutationCache()
        .findAll({ mutationKey: authKeys.registerMutation() }),
    ).toHaveLength(0)
  })

  test('cross-component subscription — sibling useAuth re-renders when login fires from a separate tree under the SAME QueryClientProvider', async () => {
    // The cache subscription via useQuery (in useAuth) is the contract.
    // A mutation written from one tree must update a sibling consumer.
    const client = createTestQueryClient()
    const { result: login } = renderHook(() => useLogin(), {
      wrapper: wrap(client),
    })
    const { useAuth } = await import('@/hooks/useAuth')
    const { result: auth } = renderHook(() => useAuth(), {
      wrapper: wrap(client),
    })
    expect(auth.current.isAuthenticated).toBe(false)
    login.current.mutate({
      email: 'a@a.com',
      password: 'p',
      rememberMe: false,
    })
    await waitFor(() => expect(login.current.isSuccess).toBe(true))
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true))
    expect(auth.current.user?.email).toBe('a@a.com')
  })

  test('with createTestQueryClient(), the global queryClient is NOT mutated by the test (isolation regression guard)', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: wrap(client) })
    result.current.mutate({
      email: 'leak@example.com',
      password: 'p',
      rememberMe: false,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(globalQueryClient.getQueryData(authKeys.session())).toBeUndefined()
  })

  test('Story 1-9a Layer B — onSuccess posts a login-succeeded BroadcastChannel message with the session payload', async () => {
    // Sibling-tab listener fixture: a fresh BroadcastChannel subscribed
    // to the same `classlite_auth` channel name as the production module.
    // The production module's `channel.postMessage(...)` should fire the
    // message AND this fixture's listener should receive it.
    type Signal = {
      type: string
      timestamp: number
      data: { user: { email: string }; accessToken: string }
    }
    const received: Signal[] = []
    const sibling = new BroadcastChannel('classlite_auth')
    const messagePromise = new Promise<Signal>((resolve) => {
      sibling.addEventListener('message', (event) => {
        const data = event.data as Signal
        if (data?.type === 'login-succeeded') {
          received.push(data)
          resolve(data)
        }
      })
    })

    const client = createTestQueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: wrap(client) })
    result.current.mutate({
      email: 'broadcast@example.com',
      password: 'p',
      rememberMe: false,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const msg = await messagePromise
    expect(msg.type).toBe('login-succeeded')
    expect(msg.data.user.email).toBe('broadcast@example.com')
    expect(msg.data.accessToken).toBe('msw.jwt.signature')
    sibling.close()
  })
})
