/**
 * useWritingDraft — Story 5.3 (AC2/AC4). The WRITING-shaped adapter over the
 * shared generic `useAttemptDraft` cache slice (D9). The generic slice is a
 * full-replace value of shape `T`; this wrapper binds it to `WritingContent` and
 * exposes a single `setText` mutator (writing is a whole-document replace, unlike
 * quiz's per-answer union). The draft stays cache-resident so it survives remount
 * / Suspense / an error-boundary reset, and is readable outside React by the
 * autosave `getContent` + the localStorage mirror.
 */
import { useCallback } from 'react'
import { useAttemptDraft } from '@/features/attempts'
import {
  emptyWritingContent,
  WRITING_CONTENT_SCHEMA_VERSION,
  type WritingContent,
} from '../lib/writingContent'

export interface UseWritingDraftResult {
  content: WritingContent
  /** Full-replace the draft text (the whole-document save, D1). */
  setText: (text: string) => void
}

/** Read the writing draft slice + its full-replace `setText` for one submission. */
export function useWritingDraft(submissionId: string): UseWritingDraftResult {
  const { content, setContent } = useAttemptDraft<WritingContent>(
    submissionId,
    emptyWritingContent,
  )

  const setText = useCallback(
    (text: string) => {
      setContent(() => ({ schemaVersion: WRITING_CONTENT_SCHEMA_VERSION, text }))
    },
    [setContent],
  )

  return { content, setText }
}
