/**
 * useResetPassword — Story 1-9b AC5 / AC6. Three tests covering happy /
 * 410 expired / 409 consumed.
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
import { useResetPassword } from '@/features/auth/api/resetPassword'
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

describe('useResetPassword (Story 1-9b AC5 / AC6)', () => {
  test('happy path returns the unwrapped { reset: true } envelope', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useResetPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'abc123', newPassword: 'newStrong123' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.reset).toBe(true)
  })

  test('410 RESET_TOKEN_EXPIRED surfaces ApiError(410, RESET_TOKEN_EXPIRED)', async () => {
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_EXPIRED',
              message: 'reset link expired',
              details: null,
            },
          },
          { status: 410 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useResetPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'expired', newPassword: 'newStrong123' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(410)
    expect(err.code).toBe('RESET_TOKEN_EXPIRED')
  })

  test('409 RESET_TOKEN_CONSUMED surfaces ApiError(409, RESET_TOKEN_CONSUMED)', async () => {
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_CONSUMED',
              message: 'reset link already used',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useResetPassword(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ token: 'used', newPassword: 'newStrong123' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(err).toBeInstanceOf(ApiError)
    if (!(err instanceof ApiError)) throw new Error('expected ApiError')
    expect(err.status).toBe(409)
    expect(err.code).toBe('RESET_TOKEN_CONSUMED')
  })
})
