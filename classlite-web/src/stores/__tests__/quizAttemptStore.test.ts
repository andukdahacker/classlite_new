// Story 5.2b Task 3 — quizAttemptStore is UI-only + resettable (TEST-FE-3).
import { beforeEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_SPLIT_RATIO,
  initialState,
  useQuizAttemptStore,
} from '../quizAttemptStore'

beforeEach(() => {
  useQuizAttemptStore.getState().reset()
})

describe('quizAttemptStore', () => {
  test('initialState is idle / index 0 / centered split', () => {
    expect(initialState).toEqual({
      currentQuestionIndex: 0,
      saveStatus: 'idle',
      splitRatio: DEFAULT_SPLIT_RATIO,
    })
  })

  test('setters mutate the intended slice only', () => {
    const s = useQuizAttemptStore.getState()
    s.setCurrentQuestionIndex(4)
    s.setSaveStatus('saving')
    s.setSplitRatio(0.7)
    const next = useQuizAttemptStore.getState()
    expect(next.currentQuestionIndex).toBe(4)
    expect(next.saveStatus).toBe('saving')
    expect(next.splitRatio).toBe(0.7)
  })

  test('reset() restores the initial slice AND keeps the action surface (TEST-FE-3)', () => {
    const s = useQuizAttemptStore.getState()
    s.setCurrentQuestionIndex(9)
    s.setSaveStatus('error')
    useQuizAttemptStore.getState().reset()
    const next = useQuizAttemptStore.getState()
    expect(next.currentQuestionIndex).toBe(0)
    expect(next.saveStatus).toBe('idle')
    expect(next.splitRatio).toBe(DEFAULT_SPLIT_RATIO)
    // Actions still callable after reset (the reset()-action, not setState-replace).
    expect(typeof next.reset).toBe('function')
    expect(typeof next.setSaveStatus).toBe('function')
  })
})
