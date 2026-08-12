/**
 * useSpeakingDraft — Story 5.4 Task 7. A speaking-shaped adapter over the shared
 * generic `useAttemptDraft<T>` cache slice: binds `T = SpeakingContent` and exposes
 * a single `setAudio` mutator (whole-value replace with the uploaded key +
 * container MIME + duration). The draft is cache-resident (survives remount) and
 * readable outside React by the autosave `getContent` + the localStorage mirror.
 */
import { useCallback } from 'react'
import { useAttemptDraft } from '@/features/attempts'
import {
  emptySpeakingContent,
  SPEAKING_CONTENT_SCHEMA_VERSION,
  type SpeakingContent,
} from '../lib/speakingContent'

export interface UseSpeakingDraftResult {
  content: SpeakingContent
  /** Full-replace the draft with an uploaded take's key + container MIME + duration. */
  setAudio: (audioKey: string, contentType: string, durationSec: number) => void
}

export function useSpeakingDraft(submissionId: string): UseSpeakingDraftResult {
  const { content, setContent } = useAttemptDraft<SpeakingContent>(
    submissionId,
    emptySpeakingContent,
  )
  const setAudio = useCallback(
    (audioKey: string, contentType: string, durationSec: number) => {
      setContent(() => ({
        schemaVersion: SPEAKING_CONTENT_SCHEMA_VERSION,
        audioKey,
        contentType,
        durationSec,
      }))
    },
    [setContent],
  )
  return { content, setAudio }
}
