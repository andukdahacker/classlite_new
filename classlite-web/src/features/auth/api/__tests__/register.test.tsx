/**
 * useRegister — 4 tests per Story 1-8 AC5.
 */
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { authKeys } from '@/features/auth/api/authKeys'
import { createTestQueryClient } from '@/lib/query-client'
import { useRegister } from '@/features/auth/api/register'
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

describe('useRegister (Story 1-8 AC5)', () => {
  test('happy path populates session cache with accessToken: null (registered-but-unverified)', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useRegister(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      email: 'newbie@example.com',
      password: 'Password1$',
      fullName: 'Newbie Tran',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData(authKeys.session()) as {
      user: { email: string; emailVerified: boolean }
      accessToken: string | null
    }
    expect(cached.user.email).toBe('newbie@example.com')
    expect(cached.user.emailVerified).toBe(false)
    expect(cached.accessToken).toBeNull()
  })

  test('isAuthenticated stays false after register because user.emailVerified === false', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useRegister(), {
      wrapper: wrap(client),
    })
    const { useAuth } = await import('@/hooks/useAuth')
    const { result: auth } = renderHook(() => useAuth(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      email: 'newbie@example.com',
      password: 'Password1$',
      fullName: 'Newbie Tran',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(auth.current.user?.email).toBe('newbie@example.com')
    expect(auth.current.isAuthenticated).toBe(false)
  })

  test('409 EMAIL_ALREADY_REGISTERED surfaces ApiError without populating cache', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'taken',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useRegister(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      email: 'taken@example.com',
      password: 'Password1$',
      fullName: 'Dup',
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData(authKeys.session())).toBeUndefined()
  })

  test('422 VALIDATION_ERROR exposes details array on ApiError (per-field setError consumer pattern)', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad',
              details: [
                { field: 'password', message: 'too short' },
                { field: 'email', message: 'malformed' },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useRegister(), {
      wrapper: wrap(client),
    })
    result.current.mutate({
      email: 'bad',
      password: 'p',
      fullName: 'X',
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error as Error & {
      details?: Array<{ field: string; message: string }>
    }
    expect(err.details).toEqual([
      { field: 'password', message: 'too short' },
      { field: 'email', message: 'malformed' },
    ])
  })
})
