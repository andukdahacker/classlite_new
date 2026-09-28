// Story 8-4b, Task 1 (AC4) — the net-new debounce primitive backing the search
// palette. RED-FIRST ([[reference_atdd_red_convention]]): `@/hooks/useDebouncedValue`
// does not exist yet, so this file fails to import (TS2307) until Task 1 lands.
//
// The debounce contract the palette relies on (D2/R-2): a burst of rapid
// changes within the window collapses to a SINGLE settled value — this is what
// makes `useSearch` issue exactly one request for the final query (AC4). Fake
// timers, never a real-clock sleep.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

const DELAY = 300

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('returns the initial value synchronously (no delay on first render)', () => {
    const { result } = renderHook(() => useDebouncedValue('a', DELAY))
    expect(result.current).toBe('a')
  })

  test('does NOT update until the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, DELAY),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    // Before the window closes the debounced value is still the old one.
    act(() => void vi.advanceTimersByTime(DELAY - 1))
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe('ab')
  })

  test('a burst within the window collapses to the FINAL value only (AC4)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, DELAY),
      { initialProps: { value: '' } },
    )
    // Type "n","ng","ngu","nguy" faster than the debounce window.
    for (const value of ['n', 'ng', 'ngu', 'nguy']) {
      rerender({ value })
      act(() => void vi.advanceTimersByTime(50))
    }
    // No intermediate value ever settled (each keystroke reset the timer).
    expect(result.current).toBe('')
    act(() => void vi.advanceTimersByTime(DELAY))
    // Only the final value survives.
    expect(result.current).toBe('nguy')
  })

  test('clears its pending timer on unmount (no post-unmount state write)', () => {
    // Mount WITHOUT a rerender so the only cleanup that can run is the unmount's
    // — a bare `rerender` also fires the effect cleanup, so asserting
    // `toHaveBeenCalled()` after a rerender+unmount cannot prove the unmount path.
    // Assert the call count ATTRIBUTABLE to unmount (code review 2026-09-28):
    // deleting `return () => clearTimeout(timer)` then reddens this test.
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = renderHook(() => useDebouncedValue('a', DELAY))
    const callsBeforeUnmount = clearSpy.mock.calls.length
    unmount()
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount)
    clearSpy.mockRestore()
  })
})
