/**
 * Story 2-4 — `useChecklistState` hook red-phase acceptance tests.
 *
 * Covers Task 1.2 (a-i) per AC4/AC5/AC6:
 *   (a) fresh mount reads empty localStorage → isVisible: true
 *   (b) snooze() → localStorage write + isVisible: false
 *   (c) vi.setSystemTime(snoozedUntil ±1s) + rerender → visibility re-computes
 *       [M-STRONG-17 fold — rerender required; hook does NOT poll]
 *   (d) scheduled setTimeout(bump, snoozedUntil - Date.now() + 1000) fires
 *       at boundary; unmount clears the timeout [W-STRONG-15 fold]
 *   (e) MALFORMED_LOCALSTORAGE_FIXTURES 6-row matrix → fresh + no throw
 *       + Sentry breadcrumb + subsequent snooze() succeeds [M-STRONG-11 fold]
 *   (f) userId === null → hook is no-op
 *   (g) cross-tab `storage` event with 5-field construction → same-tab syncs
 *       [M-BLOCKER-3 fold — jsdom StorageEvent pattern pinned]
 *   (h) unmount removes storage listener + clears scheduled bump timeout
 *   (i) userId transition rerender (user A → user B same tab) → fresh state
 *       for user B; user A's snoozedUntil does NOT leak [W-STRONG-5 fold]
 *
 * Setup discipline [W-STRONG-6 fold — StrictMode + shared-globals isolation]:
 *   `beforeEach(() => window.localStorage.clear())`
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 1.1
 * (`src/features/dashboard/hooks/useChecklistState.ts`) — TS2307 is RED.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

import { useChecklistState } from '@/features/dashboard/hooks/useChecklistState'

const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'
const KEY_A = `classlite_finish_setup_v1_${USER_A}`
const KEY_B = `classlite_finish_setup_v1_${USER_B}`

beforeEach(() => {
  window.localStorage.clear()
  addBreadcrumbSpy.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-07-14T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChecklistState — Task 1.2 hook contract (AC4/AC5/AC6)', () => {
  // ---------------------------------------------------------------------
  // (a) Fresh mount
  // ---------------------------------------------------------------------
  test('(a) fresh mount with empty localStorage → isVisible: true', () => {
    const { result } = renderHook(() => useChecklistState(USER_A))
    expect(result.current.isVisible).toBe(true)
    expect(result.current.state.snoozedUntil).toBeNull()
  })

  // ---------------------------------------------------------------------
  // (b) Snooze click
  // ---------------------------------------------------------------------
  test('(b) snooze() → writes { snoozedUntil } to localStorage + isVisible: false', () => {
    const now = Date.now()
    const { result } = renderHook(() => useChecklistState(USER_A))

    act(() => {
      result.current.snooze()
    })

    expect(result.current.isVisible).toBe(false)
    const raw = window.localStorage.getItem(KEY_A)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string) as { snoozedUntil: number }
    expect(parsed.snoozedUntil).toBeGreaterThan(now)
    // 7-day window (±1s tolerance for test timing)
    expect(parsed.snoozedUntil).toBeCloseTo(now + 7 * 24 * 3600 * 1000, -3)
  })

  test('(b.ii) snooze() fires Sentry breadcrumb `checklist-snoozed` [M-STRONG-8 fold]', () => {
    const { result } = renderHook(() => useChecklistState(USER_A))
    act(() => {
      result.current.snooze()
    })
    expect(addBreadcrumbSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'checklist',
        message: 'checklist-snoozed',
      }),
    )
  })

  // ---------------------------------------------------------------------
  // (c) Boundary time transitions — rerender required [M-STRONG-17]
  // ---------------------------------------------------------------------
  test('(c.i) vi.setSystemTime(snoozedUntil - 1s) + rerender → stays hidden', () => {
    const snoozedUntil = Date.now() + 7 * 24 * 3600 * 1000
    window.localStorage.setItem(KEY_A, JSON.stringify({ snoozedUntil }))
    const { result, rerender } = renderHook(() => useChecklistState(USER_A))
    expect(result.current.isVisible).toBe(false)

    vi.setSystemTime(new Date(snoozedUntil - 1000))
    rerender()
    expect(result.current.isVisible).toBe(false)
  })

  test('(c.ii) vi.setSystemTime(snoozedUntil + 1s) + rerender → visible again', () => {
    const snoozedUntil = Date.now() + 7 * 24 * 3600 * 1000
    window.localStorage.setItem(KEY_A, JSON.stringify({ snoozedUntil }))
    const { result, rerender } = renderHook(() => useChecklistState(USER_A))
    expect(result.current.isVisible).toBe(false)

    vi.setSystemTime(new Date(snoozedUntil + 1000))
    rerender()
    expect(result.current.isVisible).toBe(true)
  })

  // ---------------------------------------------------------------------
  // (d) Scheduled setTimeout boundary bump [W-STRONG-15]
  // ---------------------------------------------------------------------
  test('(d.i) mount with snoozedUntil 100ms in future → setTimeout bumps at boundary', () => {
    const snoozedUntil = Date.now() + 100
    window.localStorage.setItem(KEY_A, JSON.stringify({ snoozedUntil }))
    const { result } = renderHook(() => useChecklistState(USER_A))
    expect(result.current.isVisible).toBe(false)

    // Advance past the +1000ms buffer so the scheduled bump fires
    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(result.current.isVisible).toBe(true)
  })

  test('(d.ii) unmount clears scheduled setTimeout (no leak)', () => {
    const snoozedUntil = Date.now() + 100
    window.localStorage.setItem(KEY_A, JSON.stringify({ snoozedUntil }))
    const { unmount } = renderHook(() => useChecklistState(USER_A))
    const timerCountBeforeUnmount = vi.getTimerCount()
    expect(timerCountBeforeUnmount).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBeLessThan(timerCountBeforeUnmount)
  })

  // ---------------------------------------------------------------------
  // (e) MALFORMED_LOCALSTORAGE_FIXTURES matrix [M-STRONG-11]
  // ---------------------------------------------------------------------
  const MALFORMED_LOCALSTORAGE_FIXTURES: Array<[label: string, raw: string]> = [
    ['empty string', ''],
    ['JSON null literal', 'null'],
    ['empty object (missing snoozedUntil)', '{}'],
    ['wrong type on snoozedUntil', '{"snoozedUntil":"abc"}'],
    ['parse error unclosed brace', '{unclosed'],
    ['wrong root type array', '[]'],
  ]

  test.each(MALFORMED_LOCALSTORAGE_FIXTURES)(
    '(e) malformed localStorage %s → treated as fresh + no throw + Sentry breadcrumb',
    (_label, raw) => {
      window.localStorage.setItem(KEY_A, raw)

      const { result } = renderHook(() => useChecklistState(USER_A))
      expect(result.current.isVisible).toBe(true)
      expect(result.current.state.snoozedUntil).toBeNull()
      expect(addBreadcrumbSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'checklist',
          message: 'malformed-localstorage',
          level: 'warning',
        }),
      )

      // subsequent snooze() succeeds — overwrites the malformed payload
      act(() => {
        result.current.snooze()
      })
      expect(result.current.isVisible).toBe(false)
      const parsed = JSON.parse(
        window.localStorage.getItem(KEY_A) as string,
      ) as { snoozedUntil: number }
      expect(typeof parsed.snoozedUntil).toBe('number')
    },
  )

  // ---------------------------------------------------------------------
  // (f) userId === null no-op
  // ---------------------------------------------------------------------
  test('(f) userId === null → hook is no-op returning { isVisible: false, snooze: noop }', () => {
    const { result } = renderHook(() => useChecklistState(null))
    expect(result.current.isVisible).toBe(false)
    // snooze() should not throw and not write to any key
    expect(() => {
      act(() => {
        result.current.snooze()
      })
    }).not.toThrow()
    expect(window.localStorage.length).toBe(0)
  })

  // ---------------------------------------------------------------------
  // (g) Cross-tab storage event [M-BLOCKER-3 — 5 required fields]
  // ---------------------------------------------------------------------
  test('(g) window.dispatchEvent(StorageEvent) with 5 fields → same-tab syncs', () => {
    const { result, rerender } = renderHook(() => useChecklistState(USER_A))
    expect(result.current.isVisible).toBe(true)

    const snoozedUntil = Date.now() + 7 * 24 * 3600 * 1000
    const newValue = JSON.stringify({ snoozedUntil })

    // Simulate cross-tab write: write the raw payload AND dispatch a
    // StorageEvent (jsdom does not fire cross-window `storage` events
    // natively; test must manually construct + dispatch with all 5 fields).
    window.localStorage.setItem(KEY_A, newValue)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY_A,
          oldValue: null,
          newValue,
          storageArea: window.localStorage,
          url: window.location.href,
        }),
      )
    })
    rerender()
    expect(result.current.isVisible).toBe(false)
  })

  // ---------------------------------------------------------------------
  // (h) Unmount cleanup
  // ---------------------------------------------------------------------
  test('(h) unmount removes storage listener (no leak)', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useChecklistState(USER_A))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function))
    removeSpy.mockRestore()
  })

  // ---------------------------------------------------------------------
  // (i) userId transition [W-STRONG-5 + M-STRONG-12]
  // ---------------------------------------------------------------------
  test('(i) userId transition: user A snooze → rerender as user B → fresh state', () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useChecklistState(userId),
      { initialProps: { userId: USER_A as string | null } },
    )

    // User A snoozes
    act(() => {
      result.current.snooze()
    })
    expect(result.current.isVisible).toBe(false)
    expect(window.localStorage.getItem(KEY_A)).not.toBeNull()

    // Transition to User B
    rerender({ userId: USER_B })
    expect(result.current.isVisible).toBe(true)

    // User B snoozes → writes to user B's key, NOT user A's
    act(() => {
      result.current.snooze()
    })
    expect(result.current.isVisible).toBe(false)
    const userAKey = window.localStorage.getItem(KEY_A)
    const userBKey = window.localStorage.getItem(KEY_B)
    // Both keys exist independently — user isolation is proved by KEY_A and
    // KEY_B being distinct storage slots, not by their JSON payloads
    // differing (under fake timers `Date.now()` is frozen, so consecutive
    // snoozes compute the same `snoozedUntil` value; the payload equality
    // is expected. The rerender-back assertion below still proves user A's
    // state persists across the transition to user B and back).
    expect(userAKey).not.toBeNull()
    expect(userBKey).not.toBeNull()

    // Transition back to User A — user A's snoozed state should still be there
    rerender({ userId: USER_A })
    expect(result.current.isVisible).toBe(false)
  })
})

describe('useChecklistState — Story 2-5a Task 5.1 clearSnooze (AC6)', () => {
  test('snooze → clearSnooze → isVisible: true + localStorage removed', () => {
    const { result } = renderHook(() => useChecklistState(USER_A))

    act(() => {
      result.current.snooze()
    })
    expect(result.current.isVisible).toBe(false)
    expect(window.localStorage.getItem(KEY_A)).not.toBeNull()

    act(() => {
      result.current.clearSnooze()
    })
    expect(result.current.isVisible).toBe(true)
    expect(window.localStorage.getItem(KEY_A)).toBeNull()
  })

  test('clearSnooze fires `checklist-reopened` Sentry breadcrumb when a key existed', () => {
    const { result } = renderHook(() => useChecklistState(USER_A))
    act(() => {
      result.current.snooze()
    })
    addBreadcrumbSpy.mockClear()

    act(() => {
      result.current.clearSnooze()
    })

    const reopenedCall = addBreadcrumbSpy.mock.calls.find(
      (call) => (call[0] as { message?: string }).message === 'checklist-reopened',
    )
    expect(reopenedCall).toBeDefined()
    expect(reopenedCall?.[0]).toMatchObject({
      category: 'checklist',
      level: 'info',
      data: { userId: USER_A },
    })
  })

  test('clearSnooze when never snoozed → idempotent, no breadcrumb, no localStorage churn', () => {
    const { result } = renderHook(() => useChecklistState(USER_A))
    expect(window.localStorage.getItem(KEY_A)).toBeNull()
    addBreadcrumbSpy.mockClear()

    act(() => {
      result.current.clearSnooze()
    })

    // No key existed → no breadcrumb + no residue.
    expect(window.localStorage.getItem(KEY_A)).toBeNull()
    const reopenedCall = addBreadcrumbSpy.mock.calls.find(
      (call) => (call[0] as { message?: string }).message === 'checklist-reopened',
    )
    expect(reopenedCall).toBeUndefined()
    expect(result.current.isVisible).toBe(true)
  })

  test('clearSnooze with userId === null → no-op (guards null-scoped key)', () => {
    // Seed a key for USER_A so we can prove clearSnooze(null) doesn't touch it.
    window.localStorage.setItem(
      KEY_A,
      JSON.stringify({ snoozedUntil: Date.now() + 3600 * 1000 }),
    )
    addBreadcrumbSpy.mockClear()

    const { result } = renderHook(() => useChecklistState(null))
    act(() => {
      result.current.clearSnooze()
    })
    // USER_A's key is untouched — null-userId clearSnooze is a no-op.
    expect(window.localStorage.getItem(KEY_A)).not.toBeNull()
    // No breadcrumb.
    const reopenedCall = addBreadcrumbSpy.mock.calls.find(
      (call) => (call[0] as { message?: string }).message === 'checklist-reopened',
    )
    expect(reopenedCall).toBeUndefined()
  })

  test('clearSnooze does NOT trigger the malformed-localstorage breadcrumb false-positive', () => {
    // Regression pin for Amelia-B3: writing `{snoozedUntil: null}` would
    // trigger readStateFromRaw's typeof-check-fail breadcrumb. clearSnooze
    // uses removeItem instead, so subsequent reads see raw === null (which
    // resolves to NULL_STATE without breadcrumb noise).
    const { result } = renderHook(() => useChecklistState(USER_A))
    act(() => {
      result.current.snooze()
    })
    addBreadcrumbSpy.mockClear()

    act(() => {
      result.current.clearSnooze()
    })

    const malformed = addBreadcrumbSpy.mock.calls.filter(
      (call) => (call[0] as { message?: string }).message === 'malformed-localstorage',
    )
    expect(malformed).toHaveLength(0)
  })
})
