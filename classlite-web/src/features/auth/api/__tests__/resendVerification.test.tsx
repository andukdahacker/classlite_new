/**
 * useResendVerification — Story 1-9a AC4. Three tests covering happy /
 * 429 / 422.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test (Murat #1)
 * to keep the global singleton untouched.
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
import { useResendVerification } from '@/features/auth/api/resendVerification'
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

describe('useResendVerification (Story 1-9a AC4)', () => {
  test('happy path returns the new verifyPollId from the unwrapped envelope', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useResendVerification(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ email: 'alice@example.com' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.verifyPollId).toBe(
      '00000000-0000-0000-0000-poll00000099',
    )
  })

  test('200 with verifyPollId: null (anti-enumeration) resolves as success with null value', async () => {
    server.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json({ data: { verifyPollId: null } }, { status: 200 }),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useResendVerification(), {
      wrapper: wrap(client),
    })
    result.current.mutate({ email: 'unknown@example.com' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.verifyPollId).toBeNull()
  })

  test('429 RATE_LIMIT_EXCEEDED surfaces ApiError with retryAfterSeconds populated', async () => {
    server.use(
      http.post('/api/auth/resend-verification', () =>
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
    const { result } = renderHook(() => useResendVerification(), {
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
