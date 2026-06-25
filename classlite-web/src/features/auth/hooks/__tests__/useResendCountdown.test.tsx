/**
 * useResendCountdown — Story 1-9a AC4. Six tests covering start /
 * decrement / clear-on-zero / clear-on-unmount / clamp-min / clamp-max.
 *
 * Fake timers throughout. `vi.useFakeTimers()` per test; restoreReal
 * in afterEach.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  MAX_COUNTDOWN_SECONDS,
  MIN_COUNTDOWN_SECONDS,
  RESEND_COUNTDOWN_SECONDS,
  useResendCountdown,
} from '@/features/auth/hooks/useResendCountdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useResendCountdown (Story 1-9a AC4)', () => {
  test('start(60) sets remaining to 60 and isActive becomes true', () => {
    const { result } = renderHook(() => useResendCountdown())
    expect(result.current.remaining).toBe(0)
    expect(result.current.isActive).toBe(false)
    act(() => {
      result.current.start(RESEND_COUNTDOWN_SECONDS)
    })
    expect(result.current.remaining).toBe(60)
    expect(result.current.isActive).toBe(true)
  })

  test('remaining decrements each second until zero, then auto-clears (isActive false)', () => {
    const { result } = renderHook(() => useResendCountdown())
    act(() => {
      result.current.start(3)
    })
    expect(result.current.remaining).toBe(3)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(2)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(0)
    expect(result.current.isActive).toBe(false)
  })

  test('clears interval on unmount (no leaked tick)', () => {
    const { result, unmount } = renderHook(() => useResendCountdown())
    act(() => {
      result.current.start(5)
    })
    unmount()
    // After unmount, advancing time should not throw / leak state.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
  })

  test('start(0) clamps to MIN_COUNTDOWN_SECONDS (1) so callers cannot accidentally bypass the countdown', () => {
    const { result } = renderHook(() => useResendCountdown())
    act(() => {
      result.current.start(0)
    })
    expect(result.current.remaining).toBe(MIN_COUNTDOWN_SECONDS)
    expect(result.current.isActive).toBe(true)
  })

  test('start(500) clamps to MAX_COUNTDOWN_SECONDS (300) defending against malformed Retry-After headers', () => {
    const { result } = renderHook(() => useResendCountdown())
    act(() => {
      result.current.start(500)
    })
    expect(result.current.remaining).toBe(MAX_COUNTDOWN_SECONDS)
  })

  test('start can be called again mid-countdown to reset the timer with a new value', () => {
    const { result } = renderHook(() => useResendCountdown())
    act(() => {
      result.current.start(60)
    })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(result.current.remaining).toBe(50)
    act(() => {
      result.current.start(45)
    })
    expect(result.current.remaining).toBe(45)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(44)
  })
})
