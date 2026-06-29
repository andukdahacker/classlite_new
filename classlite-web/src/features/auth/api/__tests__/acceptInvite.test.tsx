/**
 * useAcceptInvite — Story 1-9c AC4 / AC5. Three tests covering happy / 404 /
 * 429. The full terminal-error matrix (410 / 409 family / 400) is exercised
 * end-to-end on InviteAcceptancePage tests, not here — the hook itself is a
 * thin apiFetch wrapper + cache write + navigate, so per-error-code unit
 * coverage here would duplicate the page coverage without exercising the
 * branching logic.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test to keep the
 * global singleton untouched.
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
import { createTestQueryClient } from '@/lib/query-client'
import { useAcceptInvite } from '@/features/auth/api/acceptInvite'
import { ApiError } from '@/lib/api-fetch'
import { MSW_ACCEPT_INVITE_DEFAULT } from '@/test/mocks/handlers'
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

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAcceptInvite (Story 1-9c AC4)', () => {
  test('happy path populates session cache with the MSW default body', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useAcceptInvite(), {
      wrapper: wrap(client),
    })

    result.current.mutate({
      inviteToken: 'abc123',
      fullName: 'Linh Nguyen',
      password: 'goodPass123',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData(authKeys.session()) as {
      user: { email: string }
      accessToken: string | null
    }
    expect(cached.user.email).toBe(MSW_ACCEPT_INVITE_DEFAULT.user.email)
    expect(cached.accessToken).toBe(MSW_ACCEPT_INVITE_DEFAULT.accessToken)
  })

  test('404 INVITE_NOT_FOUND surfaces ApiError + leaves session cache empty', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_NOT_FOUND',
              message: 'invite missing or revoked',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useAcceptInvite(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      inviteToken: 'dead-token',
      fullName: 'Linh Nguyen',
      password: 'goodPass123',
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(404)
    expect(err.code).toBe('INVITE_NOT_FOUND')
    expect(client.getQueryData(authKeys.session())).toBeUndefined()
  })

  test('429 RATE_LIMIT_EXCEEDED surfaces ApiError with retryAfterSeconds populated', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '45' } },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useAcceptInvite(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      inviteToken: 'abc123',
      fullName: 'Linh Nguyen',
      password: 'goodPass123',
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(429)
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(err.retryAfterSeconds).toBe(45)
  })
})
