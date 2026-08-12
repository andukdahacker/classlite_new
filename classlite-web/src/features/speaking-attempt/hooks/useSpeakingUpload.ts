/**
 * useSpeakingUpload — Story 5.4 Task 4 (AC12,13,15). React wrapper around the pure
 * `uploadSpeakingAudio` orchestration: owns the per-upload AbortController (aborted
 * on unmount so an in-flight PUT / a pending retry-backoff fires nothing further),
 * exposes progress + a retrying flag, and returns the confirmed key (or null on a
 * total failure, so the shell keeps the Blob in-memory and shows the local-fallback
 * state — D2).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  uploadSpeakingAudio,
  UploadAbortedError,
  SpeakingUploadTooLargeError,
  type UploadSpeakingResult,
} from '../api/uploadSpeakingAudio'
import type { RecordedTake } from './useMediaRecorder'

export type SpeakingUploadStatus =
  | 'idle'
  | 'uploading'
  | 'retrying'
  | 'success'
  | 'failed'
  | 'too-large'

export interface UseSpeakingUploadResult {
  status: SpeakingUploadStatus
  /** 0..1 transfer progress of the current attempt. */
  progress: number
  /**
   * Upload a take through presign → PUT → confirm with auto-retry.
   * @returns the confirmed R2 key, or null on a total (non-aborted) failure.
   * @throws UploadAbortedError only when aborted (unmount / read-only flip).
   */
  upload: (take: RecordedTake) => Promise<string | null>
  reset: () => void
}

export function useSpeakingUpload(): UseSpeakingUploadResult {
  const [status, setStatus] = useState<SpeakingUploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const upload = useCallback(async (take: RecordedTake): Promise<string | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('uploading')
    setProgress(0)
    try {
      const result: UploadSpeakingResult = await uploadSpeakingAudio({
        blob: take.blob,
        contentType: take.contentType,
        ext: take.ext,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (mountedRef.current) setProgress(fraction)
        },
        onRetry: () => {
          if (mountedRef.current) setStatus('retrying')
        },
      })
      if (mountedRef.current) {
        setStatus('success')
        setProgress(1)
      }
      return result.key
    } catch (error) {
      if (error instanceof UploadAbortedError) throw error
      // The client 25 MB pre-check is a DISTINCT, permanent failure (AC16 layer 1) —
      // surface it as its own status so the shell can show `speaking.upload.tooLarge`
      // rather than the generic "keep this tab open and try again" retry copy.
      if (error instanceof SpeakingUploadTooLargeError) {
        if (mountedRef.current) setStatus('too-large')
        return null
      }
      if (mountedRef.current) setStatus('failed')
      return null
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setProgress(0)
  }, [])

  return { status, progress, upload, reset }
}
