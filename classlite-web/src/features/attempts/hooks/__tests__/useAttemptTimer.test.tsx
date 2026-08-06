// Story 5.2b Task 5 (AC11/AC14/AC19) — the attempt timer: untimed short-circuit,
// single-fire expiry across past-zero ticks (WF-8 #2), resume-finalize on an
// already-expired load (AC19). Real timers + an injectable monotonic clock.
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useAttemptTimer } from '../useAttemptTimer'

const STARTED = '2026-08-04T00:00:00.000Z'
const STARTED_MS = Date.parse(STARTED)

describe('useAttemptTimer', () => {
  test('untimed → remaining null, no expiry ever', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: null,
        serverNow: () => STARTED_MS + 10_000_000,
        onExpire,
      }),
    )
    expect(result.current.remainingSeconds).toBeNull()
    expect(result.current.warningLevel).toBe('normal')
    expect(result.current.expired).toBe(false)
    expect(onExpire).not.toHaveBeenCalled()
  })

  test('a timed attempt reports remaining + warning tier', () => {
    const now = STARTED_MS
    const { result } = renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: 1800,
        serverNow: () => now,
        onExpire: vi.fn(),
      }),
    )
    expect(result.current.remainingSeconds).toBe(1800)
    expect(result.current.warningLevel).toBe('normal')
  })

  test('AC19 — an attempt that loads ALREADY expired finalizes once on mount', () => {
    const onExpire = vi.fn()
    renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: 60,
        serverNow: () => STARTED_MS + 120_000, // 60s past the deadline
        onExpire,
      }),
    )
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  test('AC14/WF-8 #2 — expiry fires exactly once as the clock ticks past zero', async () => {
    let now = STARTED_MS
    const onExpire = vi.fn()
    renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: 1, // 1s budget so one tick crosses zero
        serverNow: () => now,
        onExpire,
      }),
    )
    // Jump the monotonic clock well past the deadline; the next 1s tick derives
    // remaining=0 and fires onExpire once.
    now = STARTED_MS + 5_000
    await waitFor(() => expect(onExpire).toHaveBeenCalledTimes(1), { timeout: 2500 })

    // Keep ticking past zero — it must NOT fire again (latch).
    now = STARTED_MS + 9_000
    await new Promise((r) => setTimeout(r, 1200))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  // Review Patch #10 (AC11 / Sally-I1) — a tab re-focus reconcile announces the
  // fresh remaining, not a silent jump.
  test('AC11 — onReconcile fires with the fresh remaining on tab re-focus', () => {
    const onReconcile = vi.fn()
    let now = STARTED_MS
    renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: 1800,
        serverNow: () => now,
        onExpire: vi.fn(),
        onReconcile,
      }),
    )
    // Advance the monotonic clock ~10 min while "hidden", then re-focus.
    now = STARTED_MS + 600_000
    document.dispatchEvent(new Event('visibilitychange'))
    // 1800 − 600 = 1200s remaining.
    expect(onReconcile).toHaveBeenCalledWith(1200)
  })

  test('AC11 — no reconcile announcement for an untimed attempt', () => {
    const onReconcile = vi.fn()
    renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: null,
        serverNow: () => STARTED_MS,
        onExpire: vi.fn(),
        onReconcile,
      }),
    )
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onReconcile).not.toHaveBeenCalled()
  })

  test('does not auto-submit when disabled (read-only attempt)', () => {
    const onExpire = vi.fn()
    renderHook(() =>
      useAttemptTimer({
        startedAt: STARTED,
        timeBudgetSeconds: 60,
        serverNow: () => STARTED_MS + 120_000,
        onExpire,
        enabled: false,
      }),
    )
    expect(onExpire).not.toHaveBeenCalled()
  })
})
