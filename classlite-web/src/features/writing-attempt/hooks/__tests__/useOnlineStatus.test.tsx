// Story 5.3 Task 3 (AC12) — useOnlineStatus tracks navigator.onLine + the
// window online/offline events (jsdom-safe; NO mock of the hook — Murat F4).
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useOnlineStatus } from '../useOnlineStatus'

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

afterEach(() => vi.restoreAllMocks())

describe('useOnlineStatus (AC12)', () => {
  test('defaults to online', () => {
    setOnline(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  test('flips to offline on the offline event and back on online', () => {
    setOnline(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })
})
