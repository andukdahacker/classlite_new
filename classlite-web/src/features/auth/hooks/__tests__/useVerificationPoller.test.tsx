/**
 * useVerificationPoller — Story 1-9a AC3 + AC5. Six tests:
 *   1. polls every 5s when enabled
 *   2. enabled=false stops polling
 *   3. surfaces error (404)
 *   4. surfaces success (verified: true) + writes terminal state ref
 *   5. terminal-state ref drops late 200 polls after commitTerminal('timeout')
 *   6. terminal-state ref drops late 404 polls after commitTerminal('verified')
 *
 * Fake timers throughout. `vi.advanceTimersByTimeAsync` is used (not the
 * sync variant) so promise microtasks drain between ticks — per the
 * Murat 2026-06-25 blocker amendment in the story spec.
 */
import { act, createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query'
import { delay, HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { useVerificationPoller } from '@/features/auth/hooks/useVerificationPoller'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const POLL_ID = '00000000-0000-0000-0000-poll00000001'

describe('useVerificationPoller (Story 1-9a AC3 + AC5)', () => {
  test('fires the first GET /verify-status at the 5s tick when enabled', async () => {
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return HttpResponse.json(
          { data: { verified: false, email: 'a@a.com' } },
          { status: 200 },
        )
      }),
    )
    const client = createTestQueryClient()
    renderHook(
      () => useVerificationPoller({ pollId: POLL_ID, enabled: true }),
      { wrapper: wrap(client) },
    )
    expect(calls).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  test('enabled=false stops polling immediately (no further fetches fire)', async () => {
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return HttpResponse.json(
          { data: { verified: false, email: 'a@a.com' } },
          { status: 200 },
        )
      }),
    )
    const client = createTestQueryClient()
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVerificationPoller({ pollId: POLL_ID, enabled }),
      { wrapper: wrap(client), initialProps: { enabled: true } },
    )
    await vi.advanceTimersByTimeAsync(5_000)
    const callsAfterFirstTick = calls
    rerender({ enabled: false })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(calls).toBe(callsAfterFirstTick)
  })

  test('surfaces lastError on a 404 response and writes terminalStateRef to expired', async () => {
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          {
            error: {
              code: 'POLL_ID_NOT_FOUND',
              message: 'not found',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => useVerificationPoller({ pollId: POLL_ID, enabled: true }),
      { wrapper: wrap(client) },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.lastError).not.toBeNull()
    expect(result.current.lastError?.status).toBe(404)
    expect(result.current.lastError?.code).toBe('POLL_ID_NOT_FOUND')
  })

  test('surfaces lastResponse with verified: true on success', async () => {
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          { data: { verified: true, email: 'a@a.com' } },
          { status: 200 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => useVerificationPoller({ pollId: POLL_ID, enabled: true }),
      { wrapper: wrap(client) },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.lastResponse).not.toBeNull()
    expect(result.current.lastResponse?.verified).toBe(true)
  })

  test('terminal-state-ref drops a late 200 verified:true response after commitTerminal(timeout)', async () => {
    server.use(
      http.get('/api/auth/verify-status', async () => {
        // Long-delayed response — resolves AFTER the 10-min cap fires.
        await delay(6_000)
        return HttpResponse.json(
          { data: { verified: true, email: 'a@a.com' } },
          { status: 200 },
        )
      }),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => useVerificationPoller({ pollId: POLL_ID, enabled: true }),
      { wrapper: wrap(client) },
    )
    // Tick to fire the first poll request (in-flight, 6s delay).
    await vi.advanceTimersByTimeAsync(5_000)
    // Commit the terminal "timeout" state BEFORE the response resolves.
    result.current.commitTerminal('timeout')
    // Now drain the delayed response.
    await vi.advanceTimersByTimeAsync(6_000)
    // lastResponse stays null — late 200 was dropped silently.
    expect(result.current.lastResponse).toBeNull()
  })

  test('terminal-state-ref drops a late 404 response after commitTerminal(verified)', async () => {
    server.use(
      http.get('/api/auth/verify-status', async () => {
        await delay(6_000)
        return HttpResponse.json(
          {
            error: {
              code: 'POLL_ID_NOT_FOUND',
              message: 'not found',
              details: null,
            },
          },
          { status: 404 },
        )
      }),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => useVerificationPoller({ pollId: POLL_ID, enabled: true }),
      { wrapper: wrap(client) },
    )
    await vi.advanceTimersByTimeAsync(5_000)
    result.current.commitTerminal('verified')
    await vi.advanceTimersByTimeAsync(6_000)
    expect(result.current.lastError).toBeNull()
  })
})
