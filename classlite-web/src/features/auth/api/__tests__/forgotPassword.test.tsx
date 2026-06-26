/**
 * useForgotPassword — Story 1-9b AC3 / AC4. Three tests covering happy /
 * 422 / 429.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test to keep
 * the global singleton untouched.
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
import { useForgotPassword } from '@/features/auth/api/forgotPassword'
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

describe('useForgotPassword (Story 1-9b AC3 / AC4)', () => {
  test('happy path returns the unwrapped { sent: true } envelope', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ email: 'alice@example.com' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.sent).toBe(true)
  })

  test('422 VALIDATION_ERROR surfaces ApiError without retryAfterSeconds', async () => {
    server.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'email format invalid',
              details: null,
            },
          },
          { status: 422 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ email: 'not-an-email' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(422)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.retryAfterSeconds).toBeNull()
  })

  test('429 RATE_LIMIT_EXCEEDED surfaces ApiError with retryAfterSeconds populated', async () => {
    server.use(
      http.post('/api/auth/forgot-password', () =>
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
    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ email: 'alice@example.com' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(429)
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(err.retryAfterSeconds).toBe(45)
  })
})
