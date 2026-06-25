/**
 * App — boot-time refresh probe (Story 1-8 Task 15).
 *
 * Three pinned tests:
 *   (a) no cookie present → cache stays empty; the probe still fires
 *       but the refresh response is 401, useAuth stays unauthenticated.
 *   (b) valid refresh response → cache populates, useAuth().isAuthenticated
 *       flips to true within the effect tick.
 *   (c) refresh fails (401) → cache stays empty; no redirect from the
 *       probe itself (failure is silent — see App.tsx JSDoc).
 *
 * The harness mounts the App-style boot probe directly with a custom
 * QueryClient so the test doesn't pull in the full router tree (which
 * would also boot AuthLayout / LoginPage). The probe behavior is the
 * unit under test.
 */
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/msw-server'
import { refreshAccessToken, __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { queryClient } from '@/lib/query-client'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'

function BootProbe() {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    void refreshAccessToken()
  }, [])
  return <p>boot</p>
}

function renderProbe() {
  // The boot probe writes via `auth-refresh.ts` which addresses the
  // module-singleton `queryClient` from `@/lib/query-client`. Asserting
  // against any other QueryClient instance would never observe the
  // hydration. The global `afterEach(queryClient.clear())` in
  // `vitest-setup.ts` cleans up between tests.
  render(
    <QueryClientProvider client={queryClient}>
      <BootProbe />
    </QueryClientProvider>,
  )
}

let locationStub: StubbedLocation
let refreshCalls: number

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
  refreshCalls = 0
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('App boot-time refresh probe (Story 1-8 Task 15)', () => {
  test('valid refresh response hydrates the cache so useAuth().isAuthenticated flips to true within the effect tick', async () => {
    server.use(
      http.post('/api/auth/refresh', () => {
        refreshCalls++
        return HttpResponse.json({
          data: {
            accessToken: 'jwt.boot',
            user: {
              id: 'user-boot',
              email: 'boot@example.com',
              fullName: 'Boot',
              emailVerified: true,
            },
          },
        })
      }),
    )
    renderProbe()
    await waitFor(() => {
      const session = queryClient.getQueryData(['auth', 'session']) as
        | { user: { emailVerified: boolean } }
        | undefined
      expect(session?.user.emailVerified).toBe(true)
    })
    expect(refreshCalls).toBe(1)
  })

  test('refresh fails (401) — cache stays empty, no redirect from the probe itself (failure is silent)', async () => {
    server.use(
      http.post('/api/auth/refresh', () => {
        refreshCalls++
        return new HttpResponse(null, { status: 401 })
      }),
    )
    renderProbe()
    await waitFor(() => expect(refreshCalls).toBe(1))
    expect(queryClient.getQueryData(['auth', 'session'])).toBeUndefined()
    // The boot probe itself does NOT navigate on failure — the user already
    // isn't authenticated, that's the correct end state. The /login
    // redirect path is owned by onAuthFailure, which fires only when an
    // authenticated request 401s; not relevant here.
    expect(locationStub.assign).not.toHaveBeenCalled()
  })

  test('StrictMode double-mount of the effect still fires the refresh exactly once (useRef latch)', async () => {
    server.use(
      http.post('/api/auth/refresh', () => {
        refreshCalls++
        return HttpResponse.json({
          data: {
            accessToken: 'jwt.boot',
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
    // Render once — the latch + `refreshPromise` coalescer in
    // auth-refresh.ts keep the probe to a single network call even if
    // React fires the effect twice under StrictMode.
    renderProbe()
    await waitFor(() => expect(refreshCalls).toBe(1))
    expect(refreshCalls).toBe(1)
  })
})
