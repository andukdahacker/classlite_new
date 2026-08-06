// Story 5.2d Task 2 (AC3) — attemptStore is the SHARED save-status slice,
// UI-only + resettable (TEST-FE-3). `offline` is forward-ready for 5.3.
import { beforeEach, describe, expect, test } from 'vitest'
import { initialState, useAttemptStore } from '../attemptStore'

beforeEach(() => {
  useAttemptStore.getState().reset()
})

describe('attemptStore', () => {
  test('initialState is idle', () => {
    expect(initialState).toEqual({ saveStatus: 'idle' })
  })

  test('setSaveStatus moves through every state, including the forward-ready offline', () => {
    const s = useAttemptStore.getState()
    for (const status of ['saving', 'saved', 'unsaved', 'error', 'offline'] as const) {
      s.setSaveStatus(status)
      expect(useAttemptStore.getState().saveStatus).toBe(status)
    }
  })

  test('reset() restores idle AND keeps the action surface (TEST-FE-3)', () => {
    useAttemptStore.getState().setSaveStatus('error')
    useAttemptStore.getState().reset()
    const next = useAttemptStore.getState()
    expect(next.saveStatus).toBe('idle')
    // Actions still callable after reset (the reset()-action, not setState-replace).
    expect(typeof next.reset).toBe('function')
    expect(typeof next.setSaveStatus).toBe('function')
  })
})
