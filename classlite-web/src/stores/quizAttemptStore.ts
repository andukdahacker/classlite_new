/**
 * quizAttemptStore — Story 5.2b Task 3 (Winston-S1 / D9). UI-ONLY ephemeral
 * state for the quiz-attempt screen. Modelled on `editorStore.ts`:
 * `initialState` + a `reset()` action (TEST-FE-3).
 *
 * What lives here: `currentQuestionIndex` (navigator position), `saveStatus`
 * (the prominent Saving/Saved/Error indicator, AC12), and `splitRatio` (the
 * desktop draggable split-pane position, AC2).
 *
 * What does NOT live here: the ANSWERS + FLAGGED draft. Those live in the
 * TanStack Query cache (`attemptKeys.draft`) as a mutation-managed slice so they
 * survive remount / Suspense / error-boundary (D9, FW-1). Never store server /
 * API data in Zustand (project-context Zustand rule). Never invalidate Query
 * from a store action (FW-6).
 */
import { create } from 'zustand'

/** The prominent autosave indicator states (AC12). `unsaved` = dirty, pending. */
export type AttemptSaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved' | 'error'

export interface QuizAttemptState {
  currentQuestionIndex: number
  saveStatus: AttemptSaveStatus
  /** Desktop split-pane ratio (left-pane fraction, 0..1). */
  splitRatio: number
}

export interface QuizAttemptActions {
  setCurrentQuestionIndex: (index: number) => void
  setSaveStatus: (status: AttemptSaveStatus) => void
  setSplitRatio: (ratio: number) => void
  reset: () => void
}

export const DEFAULT_SPLIT_RATIO = 0.5

export const initialState: QuizAttemptState = {
  currentQuestionIndex: 0,
  saveStatus: 'idle',
  splitRatio: DEFAULT_SPLIT_RATIO,
}

export const useQuizAttemptStore = create<QuizAttemptState & QuizAttemptActions>(
  (set) => ({
    ...initialState,
    setCurrentQuestionIndex: (currentQuestionIndex) =>
      set({ currentQuestionIndex }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),
    setSplitRatio: (splitRatio) => set({ splitRatio }),
    reset: () => set({ ...initialState }),
  }),
)
