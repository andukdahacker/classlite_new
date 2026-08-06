/**
 * useQuizDraft — Story 5.2d (AC2). The QUIZ-shaped adapter over the generic
 * `useAttemptDraft` cache slice (Winston-S1 / D9). The generic slice is a
 * full-replace value of shape `T`; this wrapper binds it to `AttemptContent` and
 * exposes the quiz mutators (`setAnswer` / `toggleFlag`) built on the shared
 * `setContent`. The answers + flagged draft stays cache-resident so it survives
 * remount / Suspense / an error-boundary reset.
 */
import { useCallback } from 'react'
import { useAttemptDraft } from '@/features/attempts'
import {
  emptyAttemptContent,
  normalizeAttemptContent,
  withAnswer,
  withFlagToggled,
  type AttemptContent,
} from '../lib/attemptContent'

export interface UseQuizDraftResult {
  content: AttemptContent
  setAnswer: (handle: string, value: string) => void
  toggleFlag: (handle: string) => void
}

/** Read the quiz draft slice + its full-replace mutators for one submission. */
export function useQuizDraft(submissionId: string): UseQuizDraftResult {
  const { content, setContent } = useAttemptDraft<AttemptContent>(
    submissionId,
    emptyAttemptContent,
  )

  const setAnswer = useCallback(
    (handle: string, value: string) => {
      setContent((prev) => withAnswer(normalizeAttemptContent(prev), handle, value))
    },
    [setContent],
  )

  const toggleFlag = useCallback(
    (handle: string) => {
      setContent((prev) => withFlagToggled(normalizeAttemptContent(prev), handle))
    },
    [setContent],
  )

  return { content, setAnswer, toggleFlag }
}
