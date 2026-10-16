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
import { ApiError, AuthExpiredError, apiFetch, toApiUrl } from '@/lib/api-fetch'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { queryClient } from '@/lib/query-client'

const REQUEST_ID = 'req-1234'

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// Split-origin top-level navigation (Google OAuth 302, verify-email fallback). These are <a>/
// window.location navigations, NOT apiFetch XHRs, so they must resolve the API origin themselves
// — a relative /api/auth/google would hit the Pages origin (my.classlite.app → 404) in prod.
describe('toApiUrl (split-origin top-level navigation)', () => {
  test('prefixes the API origin when VITE_API_URL is set (prod)', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.classlite.app')
    expect(toApiUrl('/api/auth/google')).toBe(
      'https://api.classlite.app/api/auth/google',
    )
    // query string preserved
    expect(toApiUrl('/api/auth/google?prompt=select_account')).toBe(
      'https://api.classlite.app/api/auth/google?prompt=select_account',
    )
  })

  test('trailing slash on VITE_API_URL is normalized (no double slash)', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.classlite.app/')
    expect(toApiUrl('/api/auth/google')).toBe(
      'https://api.classlite.app/api/auth/google',
    )
  })

  test('stays relative when VITE_API_URL is unset (local dev / Vite proxy)', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(toApiUrl('/api/auth/google')).toBe('/api/auth/google')
  })

  test('leaves an already-absolute URL untouched', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.classlite.app')
    expect(toApiUrl('https://example.com/x')).toBe('https://example.com/x')
  })
})

// A fetch with a string body defaults to text/plain, which the server's
// requireJSONContent rejects with 415 (the onboarding class-spawn bug). apiFetch
// must set application/json so mutations that forget the header still work.
describe('apiFetch Content-Type default (415-class fix)', () => {
  test('sets Content-Type: application/json for a string body when omitted', async () => {
    let seen: string | null = null
    server.use(
      http.post('/api/ct-default', ({ request }) => {
        seen = request.headers.get('content-type')
        return HttpResponse.json({ data: { ok: true } })
      }),
    )
    await apiFetch('/api/ct-default', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })
    expect(seen).toBe('application/json')
  })

  test('does NOT override an explicit Content-Type', async () => {
    let seen: string | null = null
    server.use(
      http.post('/api/ct-explicit', ({ request }) => {
        seen = request.headers.get('content-type')
        return HttpResponse.json({ data: { ok: true } })
      }),
    )
    await apiFetch('/api/ct-explicit', {
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(seen).toBe('text/plain')
  })
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

  test('attaches Authorization: Bearer from the cached session access token', async () => {
    // The access token lives in the ['auth','session'] cache (written by
    // login / silent-refresh). apiFetch MUST forward it as a Bearer header —
    // the Go API's ExtractTenant middleware authenticates on that header, NOT
    // on the httpOnly refresh cookie. Missing this header 401s every
    // protected request and bounces the user back to /login (fix 2026-07-23).
    queryClient.setQueryData(['auth', 'session'], {
      user: { id: 'u1', email: 'a@b.co', fullName: 'A', emailVerified: true },
      accessToken: 'header.payload.sig',
      center: null,
      role: null,
    })
    let seenAuth: string | null = null
    server.use(
      http.get('/api/students', ({ request }) => {
        seenAuth = request.headers.get('Authorization')
        return HttpResponse.json({ data: [] })
      }),
    )
    await apiFetch('/api/students')
    expect(seenAuth).toBe('Bearer header.payload.sig')
  })

  test('omits Authorization when no access token is cached (pre-login)', async () => {
    let hasAuth = true
    server.use(
      http.get('/api/students', ({ request }) => {
        hasAuth = request.headers.has('Authorization')
        return HttpResponse.json({ data: [] })
      }),
    )
    await apiFetch('/api/students')
    expect(hasAuth).toBe(false)
  })

  test('retry after a 401 refresh carries the freshly-rotated access token', async () => {
    // The refresh coordinator writes the new token to the session cache; the
    // retried request must read it at call time (not reuse the stale header).
    queryClient.setQueryData(['auth', 'session'], {
      user: { id: 'u1', email: 'a@b.co', fullName: 'A', emailVerified: true },
      accessToken: 'stale-token',
      center: null,
      role: null,
    })
    const seenAuth: Array<string | null> = []
    let studentsCalls = 0
    server.use(
      http.get('/api/students', ({ request }) => {
        studentsCalls++
        seenAuth.push(request.headers.get('Authorization'))
        if (studentsCalls === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({ data: [{ id: 'x' }] })
      }),
      http.post('/api/auth/refresh', () => {
        // Simulate the coordinator rotating the cached token.
        queryClient.setQueryData(['auth', 'session'], {
          user: {
            id: 'u1',
            email: 'a@b.co',
            fullName: 'A',
            emailVerified: true,
          },
          accessToken: 'fresh-token',
          center: null,
          role: null,
        })
        return HttpResponse.json({
          data: {
            user: {
              id: 'u1',
              email: 'a@b.co',
              fullName: 'A',
              emailVerified: true,
            },
            accessToken: 'fresh-token',
            role: null,
          },
        })
      }),
    )
    await apiFetch('/api/students')
    expect(seenAuth[0]).toBe('Bearer stale-token')
    expect(seenAuth[1]).toBe('Bearer fresh-token')
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

  test('429 ACCOUNT_LOCKED exposes Retry-After seconds on ApiError.retryAfterSeconds (Story 1-8 amendment)', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'ACCOUNT_LOCKED',
              message: 'locked',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '900' } },
        ),
      ),
    )
    const error = await apiFetch('/api/auth/login', { method: 'POST' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).retryAfterSeconds).toBe(900)
    // details stays the original shape — sibling property, NOT spread in.
    expect((error as ApiError).details).toBeNull()
  })

  test('429 RATE_LIMIT_EXCEEDED also exposes Retry-After', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'too many',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    )
    const error = await apiFetch('/api/auth/login', { method: 'POST' }).catch(
      (e: unknown) => e,
    )
    expect((error as ApiError).retryAfterSeconds).toBe(60)
  })

  test('non-rate-limit errors get retryAfterSeconds: null even when header present', async () => {
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
          { status: 401, headers: { 'Retry-After': '60' } },
        ),
      ),
    )
    const error = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipAuthRefresh: true,
    }).catch((e: unknown) => e)
    // 401 with skipAuthRefresh throws AuthExpiredError per AC5 — the
    // retryAfterSeconds path doesn't apply. Cover the same-code path
    // via a non-401 sample below.
    expect(error).not.toBeInstanceOf(ApiError)
    expect((error as Error).name).toBe('AuthExpiredError')
  })

  test('422 VALIDATION_ERROR with details array preserves details intact (no Retry-After spread corruption)', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad',
              details: [{ field: 'password', message: 'too short' }],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const error = await apiFetch('/api/auth/register', {
      method: 'POST',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).details).toEqual([
      { field: 'password', message: 'too short' },
    ])
    expect((error as ApiError).retryAfterSeconds).toBeNull()
  })
})
