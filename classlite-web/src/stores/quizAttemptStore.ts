/**
 * quizAttemptStore — Story 5.2b Task 3 (Winston-S1 / D9), slimmed in Story 5.2d
 * (AC3). QUIZ-OWNED UI-only ephemeral state for the quiz-attempt screen. The
 * shared save-status slice was extracted to `attemptStore.ts`; what remains here
 * is quiz-specific: `currentQuestionIndex` (navigator position) and `splitRatio`
 * (the desktop draggable split-pane position, AC2). Modelled on `editorStore.ts`:
 * `initialState` + a `reset()` action (TEST-FE-3).
 *
 * What does NOT live here: the save-status indicator state (now `attemptStore`),
 * and the ANSWERS + FLAGGED draft (Query cache `attemptKeys.draft`, D9). Never
 * store server / API data in Zustand. Never invalidate Query from a store action
 * (FW-6).
 */
import { create } from 'zustand'

export interface QuizAttemptState {
  currentQuestionIndex: number
  /** Desktop split-pane ratio (left-pane fraction, 0..1). */
  splitRatio: number
}

export interface QuizAttemptActions {
  setCurrentQuestionIndex: (index: number) => void
  setSplitRatio: (ratio: number) => void
  reset: () => void
}

export const DEFAULT_SPLIT_RATIO = 0.5

export const initialState: QuizAttemptState = {
  currentQuestionIndex: 0,
  splitRatio: DEFAULT_SPLIT_RATIO,
}

export const useQuizAttemptStore = create<QuizAttemptState & QuizAttemptActions>(
  (set) => ({
    ...initialState,
    setCurrentQuestionIndex: (currentQuestionIndex) =>
      set({ currentQuestionIndex }),
    setSplitRatio: (splitRatio) => set({ splitRatio }),
    reset: () => set({ ...initialState }),
  }),
)
