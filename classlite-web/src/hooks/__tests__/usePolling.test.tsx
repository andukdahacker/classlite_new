/**
 * usePolling — interval + cleanup behavioral contract (Story 1-7c AC10).
 *
 * usePolling is a REAL implementation (not just a typed stub) — Story
 * 1-9a is its first consumer. Tests use fake timers so the interval
 * tick is deterministic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePolling } from '@/hooks/usePolling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('invokes fn once per intervalMs while enabled', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      usePolling({ fn, intervalMs: 1000 }),
    )
    expect(result.current.isPolling).toBe(true)
    expect(fn).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(fn).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('does NOT invoke fn when enabled=false', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      usePolling({ fn, intervalMs: 1000, enabled: false }),
    )
    expect(result.current.isPolling).toBe(false)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(fn).not.toHaveBeenCalled()
  })

  test('cleans up the interval on unmount (no further calls)', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() =>
      usePolling({ fn, intervalMs: 1000 }),
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    unmount()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('flipping enabled true → false stops the interval', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePolling({ fn, intervalMs: 1000, enabled }),
      { initialProps: { enabled: true } },
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    rerender({ enabled: false })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('reads the latest fn closure (ref-stored, not stale)', () => {
    const calls: string[] = []
    const { rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        usePolling({
          fn: async () => {
            calls.push(tag)
          },
          intervalMs: 1000,
        }),
      { initialProps: { tag: 'a' } },
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender({ tag: 'b' })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(calls).toEqual(['a', 'b'])
  })
})
