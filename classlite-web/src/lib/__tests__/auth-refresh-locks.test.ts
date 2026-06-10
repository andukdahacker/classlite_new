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

  test('refresh-succeeded broadcast triggers queryClient.invalidateQueries', async () => {
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => Promise.resolve())
    const sender = new BroadcastChannel('classlite_auth')
    sender.postMessage({ type: 'refresh-succeeded', timestamp: Date.now() })
    // Allow microtasks + message-bus delivery to drain.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(invalidateSpy).toHaveBeenCalled()
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
    sender.postMessage({ type: 'refresh-succeeded', timestamp: Date.now() })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const result = await refreshAccessToken()
    expect(result.ok).toBe(true)
    expect(count).toBe(0)
    sender.close()
  })
})
