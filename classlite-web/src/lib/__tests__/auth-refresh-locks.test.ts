/**
 * AC4 — multi-tab refresh coordination.
 *
 * Four tests in this file. The fourth (`lastRefreshedAt`-debounce skip)
 * is the load-bearing one — without it, a same-tab simulation of the
 * Tab-1-broadcasts-success → Tab-2-acquires-lock sequence silently
 * passes a second refresh and burns the rotated token.
 *
 * jsdom does not ship `navigator.locks`, so the in-process coalesce
 * fallback is the path actually exercised here. The real `navigator.locks`
 * gate is verified by the multi-tab Playwright spec (Task 10).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import {
  __resetAuthRefreshStateForTests,
  refreshAccessToken,
} from '@/lib/auth-refresh'
import { queryClient } from '@/lib/query-client'

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('AC4 in-process coalesce + lock fallback + broadcast debounce', () => {
  test('three concurrent refresh calls in one tab coalesce to one /api/auth/refresh fetch', async () => {
    let count = 0
    server.use(
      http.post('/api/auth/refresh', async () => {
        count++
        await new Promise((resolve) => setTimeout(resolve, 30))
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(count).toBe(1)
  })

  test('falls back to in-process coalesce when navigator.locks is undefined', async () => {
    const mutableNavigator = navigator as unknown as {
      locks?: LockManager
    }
    const originalLocks = mutableNavigator.locks
    // jsdom typically has no `locks` to begin with; explicit delete is
    // defensive in case a polyfill ever lands in this env.
    delete mutableNavigator.locks
    try {
      let count = 0
      server.use(
        http.post('/api/auth/refresh', () => {
          count++
          return new HttpResponse(null, { status: 200 })
        }),
      )
      const results = await Promise.all([
        refreshAccessToken(),
        refreshAccessToken(),
      ])
      expect(results.every((r) => r.ok)).toBe(true)
      expect(count).toBe(1)
    } finally {
      if (originalLocks !== undefined) {
        mutableNavigator.locks = originalLocks
      }
    }
  })

  test('refresh-succeeded broadcast with data hydrates session cache via setQueryData', async () => {
    // Story 1-8 contract switch: invalidateQueries → setQueryData(literal
    // ['auth','session'] key). invalidate would clobber the cache because
    // the queryFn returns null (enabled: false). Assert setQueryData fires
    // and the cache reads back the payload.
    const setSpy = vi.spyOn(queryClient, 'setQueryData')
    const sender = new BroadcastChannel('classlite_auth')
    const payload = {
      user: {
        id: 'user-sibling',
        email: 'sibling@example.com',
        fullName: 'Sibling',
        emailVerified: true,
      },
      accessToken: 'jwt.sibling',
    }
    sender.postMessage({
      type: 'refresh-succeeded',
      timestamp: Date.now(),
      data: payload,
    })
    // Allow microtasks + message-bus delivery to drain.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(setSpy).toHaveBeenCalledWith(['auth', 'session'], payload)
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(payload)
    sender.close()
  })

  test('refresh-succeeded broadcast WITHOUT data leaves cache untouched (debounce-hit path)', async () => {
    // A sibling tab on the debounce-hit path broadcasts `data: null`. The
    // listener stamps lastRefreshedAt but MUST NOT write the cache with
    // null — that would clobber the previously-hydrated session.
    queryClient.setQueryData(['auth', 'session'], {
      user: {
        id: 'existing',
        email: 'existing@example.com',
        fullName: 'Existing',
        emailVerified: true,
      },
      accessToken: 'jwt.existing',
    })
    const before = queryClient.getQueryData(['auth', 'session'])
    const sender = new BroadcastChannel('classlite_auth')
    sender.postMessage({
      type: 'refresh-succeeded',
      timestamp: Date.now(),
      data: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(before)
    sender.close()
  })

  test('lock callback skips network call when lastRefreshedAt is fresh', async () => {
    let count = 0
    server.use(
      http.post('/api/auth/refresh', () => {
        count++
        return new HttpResponse(null, { status: 200 })
      }),
    )
    // Simulate a sibling tab broadcasting success — auth-refresh's
    // module-level listener stamps `lastRefreshedAt` from the message
    // timestamp. The subsequent refreshAccessToken call must observe
    // the debounce window and skip the network refresh entirely.
    const sender = new BroadcastChannel('classlite_auth')
    sender.postMessage({
      type: 'refresh-succeeded',
      timestamp: Date.now(),
      data: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const result = await refreshAccessToken()
    expect(result.ok).toBe(true)
    expect(count).toBe(0)
    sender.close()
  })

  test('200 with valid EnvelopeLoginResult body hydrates the local cache (Story 1-8 AC5 success path)', async () => {
    const payload = {
      user: {
        id: 'user-fresh',
        email: 'fresh@example.com',
        fullName: 'Fresh User',
        emailVerified: true,
      },
      accessToken: 'jwt.fresh',
    }
    server.use(
      http.post('/api/auth/refresh', () =>
        HttpResponse.json({ data: payload }, { status: 200 }),
      ),
    )
    const result = await refreshAccessToken()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual(payload)
    }
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(payload)
  })

  test('200 with malformed body still resolves ok and does NOT clobber the existing cache', async () => {
    // Seed an existing session so we can prove the cache is untouched.
    queryClient.setQueryData(['auth', 'session'], {
      user: {
        id: 'pre',
        email: 'pre@example.com',
        fullName: 'Pre',
        emailVerified: true,
      },
      accessToken: 'jwt.pre',
    })
    server.use(
      http.post('/api/auth/refresh', () => new HttpResponse('not-json-at-all', { status: 200 })),
    )
    const result = await refreshAccessToken()
    expect(result.ok).toBe(true)
    // Cache stays as we seeded it — malformed body does NOT wipe the user out.
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: {
        id: 'pre',
        email: 'pre@example.com',
        fullName: 'Pre',
        emailVerified: true,
      },
      accessToken: 'jwt.pre',
    })
  })

  test('Story 1-9a Layer B — BroadcastChannel listener handles login-succeeded by hydrating the session cache (same path as refresh-succeeded)', async () => {
    queryClient.removeQueries({ queryKey: ['auth', 'session'] })
    expect(queryClient.getQueryData(['auth', 'session'])).toBeUndefined()
    const payload = {
      user: {
        id: 'sibling',
        email: 'sibling@example.com',
        fullName: 'Sibling',
        emailVerified: true,
      },
      accessToken: 'jwt.sibling',
    }
    // Simulate a sibling-tab broadcast hitting the production module's
    // listener. Posting on a separate channel instance with the SAME
    // name routes to every other subscriber on the same origin —
    // including the production module's `handleChannelMessage`.
    const sibling = new BroadcastChannel('classlite_auth')
    sibling.postMessage({
      type: 'login-succeeded',
      timestamp: Date.now(),
      data: payload,
    })
    // Drain microtasks so the listener runs.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(payload)
    sibling.close()
  })
})
