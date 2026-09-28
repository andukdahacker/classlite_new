// Story 8-4b, Task 5 (AC1, D1) — the ⌘K/Ctrl+K global open-state hook.
// RED-FIRST: `@/features/search/hooks/useCommandPalette` does not exist yet.
//
// The load-bearing property (D1, FW-4 inoculation): the keydown listener is
// registered EXACTLY ONCE for the mount and NEVER re-subscribes on a toggle —
// a `[open]`-dep effect (closing over `open`) would tear down + re-add the
// document listener on every open/close, the unstable-subscription class that
// caused the auto-save loop. We prove it by counting addEventListener across
// toggles.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useCommandPalette } from '@/features/search/hooks/useCommandPalette'

function pressCmdK(overrides: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...overrides,
  })
  act(() => {
    document.dispatchEvent(event)
  })
  return event
}

afterEach(() => vi.restoreAllMocks())

describe('useCommandPalette', () => {
  test('starts closed', () => {
    const { result } = renderHook(() => useCommandPalette())
    expect(result.current.open).toBe(false)
  })

  test('⌘K opens the palette and prevents the browser default', () => {
    const { result } = renderHook(() => useCommandPalette())
    const event = pressCmdK({ metaKey: true })
    expect(result.current.open).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  test('Ctrl+K opens the palette (non-Mac accelerator)', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressCmdK({ metaKey: false, ctrlKey: true })
    expect(result.current.open).toBe(true)
  })

  test('a re-press TOGGLES the palette closed', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressCmdK()
    expect(result.current.open).toBe(true)
    pressCmdK()
    expect(result.current.open).toBe(false)
  })

  test('a bare "k" (no modifier) is ignored', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressCmdK({ metaKey: false, ctrlKey: false })
    expect(result.current.open).toBe(false)
  })

  test('imperative openPalette / closePalette drive the same state', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => result.current.openPalette())
    expect(result.current.open).toBe(true)
    act(() => result.current.closePalette())
    expect(result.current.open).toBe(false)
  })

  test('EMPTY-DEP: the keydown listener is registered ONCE and never re-subscribes on toggle', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result } = renderHook(() => useCommandPalette())
    const keydownAddsAfterMount = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length
    expect(keydownAddsAfterMount).toBe(1)
    // Toggle several times — the subscription must NOT churn.
    pressCmdK()
    pressCmdK()
    act(() => result.current.openPalette())
    const keydownAddsAfterToggles = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length
    expect(keydownAddsAfterToggles).toBe(1)
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(0)
  })

  test('the listener is torn down on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useCommandPalette())
    unmount()
    expect(removeSpy.mock.calls.some((c) => c[0] === 'keydown')).toBe(true)
  })
})
