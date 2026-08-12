// Story 5.3 Task 5 (AC16, Winston BLOCKER 3) — the read-only clock ticks off the
// due-date so an UNTIMED attempt flips read-only the moment hardDeadlineAt passes
// mid-session, WITHOUT a write-409. A still-editable attempt does NOT churn the
// shell every tick. A racing-write 409 additionally overrides to read-only.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '@/lib/api-fetch'
import { useAttemptReadOnly } from '../useAttemptReadOnly'

const HARD_DEADLINE = '2026-08-04T00:10:00Z'
const BEFORE = Date.parse('2026-08-04T00:09:00Z') // 1 min before hard deadline
const AFTER = Date.parse('2026-08-04T00:11:00Z') // 1 min after

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAttemptReadOnly — untimed hard-deadline tick (BLOCKER 3)', () => {
  test('an editable untimed attempt flips read-only when serverNow crosses hardDeadlineAt', () => {
    let now = BEFORE
    const { result } = renderHook(() =>
      useAttemptReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'open',
        hardDeadlineAt: HARD_DEADLINE,
        serverNow: () => now,
        tickMs: 1000,
      }),
    )
    expect(result.current.readOnly).toBe(false)
    expect(result.current.reason).toBeNull()

    // Advance the injected clock past the hard deadline; the tick re-derives.
    act(() => {
      now = AFTER
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.readOnly).toBe(true)
    expect(result.current.reason).toBe('timeExpired')
  })

  test('a racing-write 409 (SUBMISSION_LOCKED) overrides to read-only', () => {
    const now = BEFORE
    const { result } = renderHook(() =>
      useAttemptReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'open',
        hardDeadlineAt: null,
        serverNow: () => now,
        tickMs: 1000,
      }),
    )
    expect(result.current.readOnly).toBe(false)
    act(() => {
      result.current.applyWriteError(
        new ApiError(409, 'SUBMISSION_LOCKED', 'locked', 'r'),
      )
    })
    expect(result.current.readOnly).toBe(true)
    expect(result.current.reason).toBe('locked')
  })

  test('an already-submitted bundle is read-only at mount', () => {
    const { result } = renderHook(() =>
      useAttemptReadOnly({
        submissionStatus: 'submitted',
        assignmentStatus: 'open',
        hardDeadlineAt: null,
        serverNow: () => BEFORE,
        tickMs: 1000,
      }),
    )
    expect(result.current.readOnly).toBe(true)
    expect(result.current.reason).toBe('submitted')
  })
})
