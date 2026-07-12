/**
 * Story 2-3b Task 3.4 — `useCountdown` hook extraction tests (Amelia-B6 fold).
 *
 * Extracts the `{initialSeconds, elapsedSeconds}` state model + setTimeout
 * cleanup from Story 2-3a R1-P4 CenterSetupPage 429 countdown (lines 87-157)
 * into a reusable hook. Consumed by:
 *   - `CenterSetupPage.tsx` (refactored — regression risk pinned in Task 10.1)
 *   - `ClassSpawnPage.tsx` (AC6 429 branch)
 *   - `SoloFirstClassPage.tsx` (AC8 shared submit sequence)
 *
 * On 3rd downstream callsite (Epic 9 billing) → promote to
 * `src/hooks/useCountdown.ts` shared (FU-2-3b-E).
 *
 * Contract per Story 2-3b Task 3.4:
 *   useCountdown({ initialSeconds, onZero? }) → { remainingSeconds, isActive, reset }
 *
 * Test invariants (mirror 2-3a Murat-B3 for the shape):
 *   1. Tick every 1000ms until remainingSeconds hits 0
 *   2. isActive flips false at 0
 *   3. onZero callback fires exactly once when countdown reaches 0
 *   4. reset(newSeconds) re-seeds without stopping the interval
 *   5. Component unmount clears the interval (no leak)
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useCountdown } from '@/features/onboarding/hooks/useCountdown'

// ATDD red-phase — file does not exist yet; TS2307 is the intended signal.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCountdown — tick invariant', () => {
  test('starts at initialSeconds and decrements each 1000ms', () => {
    const { result } = renderHook(() => useCountdown({ initialSeconds: 5 }))
    expect(result.current.remainingSeconds).toBe(5)
    expect(result.current.isActive).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remainingSeconds).toBe(4)

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.remainingSeconds).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.isActive).toBe(false)
  })

  test('does not go negative after reaching 0', () => {
    const { result } = renderHook(() => useCountdown({ initialSeconds: 2 }))
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(result.current.remainingSeconds).toBe(0)
  })
})

describe('useCountdown — onZero callback', () => {
  test('fires exactly once when countdown hits 0', () => {
    const onZero = vi.fn()
    renderHook(() =>
      useCountdown({ initialSeconds: 3, onZero }),
    )
    expect(onZero).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(onZero).toHaveBeenCalledTimes(1)

    // Additional ticks after zero do NOT re-fire
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onZero).toHaveBeenCalledTimes(1)
  })

  test('does not fire when initialSeconds is 0 (Sally-I3 / Murat-B2 Retry-After: 0 edge)', () => {
    const onZero = vi.fn()
    const { result } = renderHook(() =>
      useCountdown({ initialSeconds: 0, onZero }),
    )
    // R1-C3-P19 — assert the state stays quiescent (remainingSeconds=0,
    // isActive=false) in addition to the onZero non-fire. Without these,
    // a regression that let remainingSeconds go negative or oscillate would
    // pass the onZero non-fire check silently.
    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.isActive).toBe(false)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    // Countdown never started → onZero never fires + state unchanged
    expect(onZero).not.toHaveBeenCalled()
    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.isActive).toBe(false)
  })
})

describe('useCountdown — reset', () => {
  test('reset(N) re-seeds countdown mid-tick (Sally-S3 repeat-429 fold)', () => {
    const { result } = renderHook(() => useCountdown({ initialSeconds: 5 }))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.remainingSeconds).toBe(3)

    act(() => {
      result.current.reset(10)
    })
    expect(result.current.remainingSeconds).toBe(10)
    expect(result.current.isActive).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remainingSeconds).toBe(9)
  })

  test('reset after countdown hit 0 re-activates', () => {
    const { result } = renderHook(() => useCountdown({ initialSeconds: 2 }))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.isActive).toBe(false)

    act(() => {
      result.current.reset(5)
    })
    expect(result.current.isActive).toBe(true)
    expect(result.current.remainingSeconds).toBe(5)
  })
})

describe('useCountdown — cleanup', () => {
  test('unmount clears interval; no leak', () => {
    const { result, unmount } = renderHook(() =>
      useCountdown({ initialSeconds: 10 }),
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.remainingSeconds).toBe(8)

    unmount()

    // Advancing time after unmount must NOT crash + no timers leaked
    expect(() => {
      vi.advanceTimersByTime(10_000)
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
