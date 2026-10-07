/**
 * useInboxCount — Story 10-1b AC4 (the badge poller). MSW + fake timers (NOT a
 * hook mock — Murat). Pins: fetches on mount when enabled, refetches on the named
 * INBOX_POLL_INTERVAL_MS, does NOT fetch when disabled (null/guest role), and the
 * interval const sits in the 30–60s band.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { INBOX_POLL_INTERVAL_MS, useInboxCount } from '../useInboxCount'

function makeWrapper(client: ReturnType<typeof createTestQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => server.resetHandlers())

describe('useInboxCount — poller (AC4)', () => {
  test('INBOX_POLL_INTERVAL_MS is a named const in the 30–60s band (not magic)', () => {
    expect(INBOX_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(30_000)
    expect(INBOX_POLL_INTERVAL_MS).toBeLessThanOrEqual(60_000)
  })

  test('fetches the count on mount when enabled for a role', async () => {
    let calls = 0
    server.use(
      http.get('/api/inbox/count', () => {
        calls += 1
        return HttpResponse.json({ data: { unread: 4 }, meta: { serverTime: '2026-10-07T12:00:00Z' } })
      }),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(() => useInboxCount({ enabled: true }), { wrapper: makeWrapper(client) })

    await waitFor(() => expect(result.current.data?.unread).toBe(4))
    expect(calls).toBe(1)
  })

  test('is DISABLED for a null/guest role — no /count fetch (no 401-storm)', async () => {
    let calls = 0
    server.use(
      http.get('/api/inbox/count', () => {
        calls += 1
        return HttpResponse.json({ data: { unread: 0 }, meta: { serverTime: '2026-10-07T12:00:00Z' } })
      }),
    )
    const client = createTestQueryClient()
    renderHook(() => useInboxCount({ enabled: false }), { wrapper: makeWrapper(client) })

    // give any erroneous fetch a tick to fire.
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(0)
  })

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('refetches on the poll interval', async () => {
      let calls = 0
      server.use(
        http.get('/api/inbox/count', () => {
          calls += 1
          return HttpResponse.json({ data: { unread: calls }, meta: { serverTime: '2026-10-07T12:00:00Z' } })
        }),
      )
      const client = createTestQueryClient()
      renderHook(() => useInboxCount({ enabled: true }), { wrapper: makeWrapper(client) })

      await vi.waitFor(() => expect(calls).toBe(1))
      await vi.advanceTimersByTimeAsync(INBOX_POLL_INTERVAL_MS + 100)
      await vi.waitFor(() => expect(calls).toBe(2))
    })
  })
})
