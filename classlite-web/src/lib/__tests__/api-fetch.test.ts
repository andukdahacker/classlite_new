/**
 * AC5 — apiFetch contract.
 *
 * Five cases — happy envelope, error envelope, skipAuthRefresh, silent
 * refresh + retry, network failure — codify the single network entry point
 * for the dashboard. The 401 + refresh-retry case (Test 4) is the
 * load-bearing one: every authenticated screen relies on it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { ApiError, AuthExpiredError, apiFetch } from '@/lib/api-fetch'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

const REQUEST_ID = 'req-1234'

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('AC5 apiFetch contract', () => {
  test('200 envelope is unwrapped — components receive bare data', async () => {
    const payload = [{ id: 'alice' }, { id: 'bob' }]
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json({ data: payload, meta: { total: 2 } }),
      ),
    )
    const result = await apiFetch<typeof payload>('/api/students')
    expect(result).toEqual(payload)
  })

  test('422 error envelope throws ApiError with requestId from header', async () => {
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Bad input',
              details: { fields: ['name'] },
            },
          },
          {
            status: 422,
            headers: { 'x-request-id': REQUEST_ID },
          },
        ),
      ),
    )
    const error = await apiFetch('/api/students').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(422)
    expect(apiError.code).toBe('VALIDATION_ERROR')
    expect(apiError.requestId).toBe(REQUEST_ID)
    expect(apiError.details).toEqual({ fields: ['name'] })
  })

  test('401 with skipAuthRefresh: true throws AuthExpiredError without calling /api/auth/refresh', async () => {
    let refreshCalled = 0
    server.use(
      http.get(
        '/api/students',
        () => new HttpResponse(null, { status: 401 }),
      ),
      http.post('/api/auth/refresh', () => {
        refreshCalled++
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const error = await apiFetch('/api/students', {
      skipAuthRefresh: true,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthExpiredError)
    expect(refreshCalled).toBe(0)
  })

  test('401 + successful refresh retries the original request exactly once', async () => {
    let studentsCalls = 0
    let refreshCalls = 0
    server.use(
      http.get('/api/students', () => {
        studentsCalls++
        if (studentsCalls === 1) {
          return new HttpResponse(null, { status: 401 })
        }
        return HttpResponse.json({ data: [{ id: 'x' }] })
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls++
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const result = await apiFetch<Array<{ id: string }>>('/api/students')
    expect(result).toEqual([{ id: 'x' }])
    expect(studentsCalls).toBe(2)
    expect(refreshCalls).toBe(1)
  })

  test('Network failure throws ApiError(status: 0, code: NETWORK)', async () => {
    server.use(http.get('/api/students', () => HttpResponse.error()))
    const error = await apiFetch('/api/students').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(0)
    expect(apiError.code).toBe('NETWORK')
    expect(apiError.requestId).toBeNull()
  })
})
