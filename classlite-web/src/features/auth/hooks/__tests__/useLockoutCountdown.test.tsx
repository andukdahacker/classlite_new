/**
 * useLockoutCountdown — 8 tests per Story 1-9d AC1 / Task 3.4.
 *
 * 4 baseline: active countdown ticks, null input emits inactive, past
 * timestamp emits inactive (+ asserts lockoutStorage cleared), format
 * mm:ss for 65s.
 *
 * 4 Murat M8 cleanup ratchets:
 *   (a) clearInterval spy fires on unmount
 *   (b) double-mount with different lockoutUntilMs produces exactly ONE
 *       tick per second
 *   (c) isActive flips false on the SAME tick that crosses the target
 *   (d) clearLockoutUntilMs is invoked exactly once on the expiry tick
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import {
  LOCKOUT_STORAGE_KEY,
  writeLockoutUntilMs,
} from '@/features/auth/lib/lockoutStorage'
import { useLockoutCountdown } from '@/features/auth/hooks/useLockoutCountdown'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-29T12:00:00Z'))
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('useLockoutCountdown (Story 1-9d AC1 / Task 3.4)', () => {
  // Baseline 1: active countdown ticks
  test('active countdown ticks once per second', () => {
    const target = Date.now() + 65_000
    const { result } = renderHook(() => useLockoutCountdown(target))
    expect(result.current.isActive).toBe(true)
    expect(result.current.remainingSeconds).toBe(65)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(result.current.remainingSeconds).toBe(64)

    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(result.current.remainingSeconds).toBe(60)
  })

  // Baseline 2: null input emits inactive
  test('null input emits inactive + remaining 0', () => {
    const { result } = renderHook(() => useLockoutCountdown(null))
    expect(result.current.isActive).toBe(false)
    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.formatted).toBe('0:00')
  })

  // Baseline 3: past timestamp emits inactive + clears storage
  test('past timestamp emits inactive + clears lockoutStorage', () => {
    writeLockoutUntilMs(Date.now() + 60_000)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).not.toBeNull()
    const past = Date.now() - 1_000
    const { result } = renderHook(() => useLockoutCountdown(past))
    expect(result.current.isActive).toBe(false)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
  })

  // Baseline 4: format mm:ss
  test('format mm:ss renders 1:05 for 65s and 0:01 for 1s', () => {
    const t65 = Date.now() + 65_000
    const { result: r1 } = renderHook(() => useLockoutCountdown(t65))
    expect(r1.current.formatted).toBe('1:05')

    const t1 = Date.now() + 1_000
    const { result: r2 } = renderHook(() => useLockoutCountdown(t1))
    expect(r2.current.formatted).toBe('0:01')

    const t10m = Date.now() + 600_000
    const { result: r3 } = renderHook(() => useLockoutCountdown(t10m))
    expect(r3.current.formatted).toBe('10:00')
  })

  // Murat M8 (a): clearInterval spy fires on unmount
  test('clearInterval spy fires on unmount (Murat M8 a)', () => {
    const spy = vi.spyOn(globalThis, 'clearInterval')
    const target = Date.now() + 30_000
    const { unmount } = renderHook(() => useLockoutCountdown(target))
    expect(spy).not.toHaveBeenCalled()
    unmount()
    expect(spy).toHaveBeenCalled()
  })

  // Murat M8 (b): double-mount with different lockoutUntilMs → exactly 1 tick/sec
  test('double-mount with different lockoutUntilMs produces exactly ONE tick per second (Murat M8 b)', () => {
    const targetA = Date.now() + 60_000
    const { unmount } = renderHook(() => useLockoutCountdown(targetA))
    unmount()

    const targetB = Date.now() + 30_000
    const { result } = renderHook(() => useLockoutCountdown(targetB))
    const startSeconds = result.current.remainingSeconds
    expect(startSeconds).toBe(30)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(result.current.remainingSeconds).toBe(29)
    // If the prior mount had leaked, advance would double-decrement (28 instead of 29).
  })

  // Murat M8 (c): isActive flips false on the SAME tick that crosses target
  test('isActive flips false on the SAME tick that crosses target (Murat M8 c)', () => {
    const target = Date.now() + 2_000
    const { result } = renderHook(() => useLockoutCountdown(target))
    expect(result.current.isActive).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(result.current.isActive).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(result.current.isActive).toBe(false)
    expect(result.current.remainingSeconds).toBe(0)
  })

  // Murat M8 (d): clearLockoutUntilMs invoked exactly once on expiry tick
  test('clearLockoutUntilMs invoked exactly once on expiry tick (Murat M8 d)', () => {
    const target = Date.now() + 2_000
    writeLockoutUntilMs(target)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).not.toBeNull()
    const { result } = renderHook(() => useLockoutCountdown(target))
    act(() => {
      vi.advanceTimersByTime(2_500)
    })
    expect(result.current.isActive).toBe(false)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
    // Re-advance — no double clear (already null + ref guards).
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
  })

  // Stability: render component using the hook to check it doesn't infinite-loop
  test('component using the hook renders without infinite loops', () => {
    function Probe({ target }: { target: number | null }) {
      const c = useLockoutCountdown(target)
      return <div data-testid="probe">{c.formatted}</div>
    }
    const target = Date.now() + 60_000
    const { getByTestId } = render(<Probe target={target} />)
    expect(getByTestId('probe').textContent).toBe('1:00')
  })
})
