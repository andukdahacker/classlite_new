/**
 * useVerifyEmail — Story 1-9a AC6. Three tests covering happy / 410 / 404.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test.
 */
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { useVerifyEmail } from '@/features/auth/api/verifyEmail'
import { ApiError } from '@/lib/api-fetch'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useVerifyEmail (Story 1-9a AC6)', () => {
  test('happy path returns verified: true with email from the unwrapped envelope', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useVerifyEmail(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'valid-token' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.verified).toBe(true)
    expect(result.current.data?.email).toBe('msw@example.com')
  })

  test('410 VERIFICATION_TOKEN_EXPIRED surfaces ApiError with the expired code', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VERIFICATION_TOKEN_EXPIRED',
              message: 'Expired',
              details: null,
            },
          },
          { status: 410 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useVerifyEmail(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'expired-token' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(410)
    expect(err.code).toBe('VERIFICATION_TOKEN_EXPIRED')
  })

  test('404 VERIFICATION_TOKEN_INVALID surfaces ApiError with the invalid code', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VERIFICATION_TOKEN_INVALID',
              message: 'Invalid',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useVerifyEmail(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'never-existed' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(404)
    expect(err.code).toBe('VERIFICATION_TOKEN_INVALID')
  })
})
