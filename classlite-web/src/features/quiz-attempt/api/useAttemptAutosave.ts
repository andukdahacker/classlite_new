/**
 * useAttemptAutosave — Story 5.2b (AC12/AC18, Winston-B3 / Murat). Adapts
 * `exercises/hooks/useExerciseAutosave` to the attempt: a 30s dirty-flush
 * autosave over `PUT /api/submissions/{id}/progress` with a FULL-replace
 * `content` (D1), a `saveSeq` out-of-order guard, a serialized in-flight chain
 * (so full-replace PUTs reach the server in issue order — the newest content is
 * always last), a best-effort beacon on unmount, and an explicit `flush()` the
 * finalizer awaits.
 *
 * Concurrency contract dropped vs. the exercises template: there is NO `If-Match`
 * / 409-conflict-reload machinery — the progress endpoint is DB-guarded server
 * side (`SUBMISSION_NOT_EDITABLE` / `TIME_EXPIRED`), so a 409 here flips the
 * attempt read-only (AC15) rather than triggering an optimistic-reload dance.
 *
 * FW-4 loop guard: `scheduleSave`/`flush` are stable `useCallback`s over refs —
 * the 1s countdown tick is NEVER a dependency, so the onboarding
 * self-perpetuating-save loop cannot recur. The 30s timer is armed on the FIRST
 * dirty edit and NOT reset per keystroke, so N keystrokes in one window produce
 * exactly one PUT.
 */
import { useCallback, useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'
import { useQuizAttemptStore } from '@/stores/quizAttemptStore'
import type { AttemptContent } from '../lib/attemptContent'

type Submission = components['schemas']['Submission']
type SaveSubmissionProgressRequest =
  components['schemas']['SaveSubmissionProgressRequest']

/** Default 30s dirty-flush cadence (AC12). Injectable for real-timer tests. */
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 30_000

export interface UseAttemptAutosaveOptions {
  /** Read the CURRENT full draft at save time — full-replace per save (D1). */
  getContent: () => AttemptContent
  /** Dirty-flush cadence in ms; defaults to 30s. */
  intervalMs?: number
  /** Autosave is off on read-only attempts (AC15). */
  enabled?: boolean
  /**
   * Called with the error when the NEWEST save fails (a racing-write 409 / 413,
   * AC15). Lets the shell flip read-only or surface the payload-too-large error.
   */
  onError?: (error: unknown) => void
}

export interface UseAttemptAutosaveResult {
  /** Mark dirty + arm the 30s cadence. Call on every answer / flag change. */
  scheduleSave: () => void
  /**
   * Supersede in-flight autosave, PUT the latest content, resolve on its ack.
   * REJECTS if the save fails — the finalizer relies on this to avoid a lossy
   * submit (AC18).
   */
  flush: () => Promise<void>
}

/** The raw progress PUT (full-replace content). */
async function putProgress(
  submissionId: string,
  content: AttemptContent,
): Promise<Submission> {
  const body: SaveSubmissionProgressRequest = {
    content: content as unknown as components['schemas']['SubmissionContent'],
  }
  return apiFetch<Submission>(`/api/submissions/${submissionId}/progress`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * Best-effort progress write on unmount (route change). Fire-and-forget via
 * `apiFetch` (mirrors `useExerciseAutosave.beaconPending`) — no React state, no
 * throw. This is NOT the finalizer path (AC18 forbids beacon-then-POST).
 */
function beaconProgress(submissionId: string, content: AttemptContent): void {
  const body: SaveSubmissionProgressRequest = {
    content: content as unknown as components['schemas']['SubmissionContent'],
  }
  void apiFetch<Submission>(`/api/submissions/${submissionId}/progress`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }).catch(() => {})
}

export function useAttemptAutosave(
  submissionId: string,
  options: UseAttemptAutosaveOptions,
): UseAttemptAutosaveResult {
  const intervalMs = options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS

  // Refs so the returned callbacks stay stable (FW-4) yet always see fresh
  // values. The latest-value refs are synced inside an effect (never written
  // during render) per the codebase's `useAutoSave` convention.
  const getContentRef = useRef(options.getContent)
  const enabledRef = useRef(options.enabled ?? true)
  const intervalRef = useRef(intervalMs)
  const onErrorRef = useRef(options.onError)

  const seqRef = useRef(0) // last issued save sequence
  const editGenRef = useRef(0) // bumped on every edit (scheduleSave)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve()) // serialized tail
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Zustand setters are stable identities — used directly, no ref needed.
  const setSaveStatus = useQuizAttemptStore((s) => s.setSaveStatus)
  const setSaveStatusRef = useRef(setSaveStatus)

  useEffect(() => {
    getContentRef.current = options.getContent
    enabledRef.current = options.enabled ?? true
    intervalRef.current = intervalMs
    onErrorRef.current = options.onError
    setSaveStatusRef.current = setSaveStatus
  })

  // Run a single save. Applies terminal state (dirty-clear / status) ONLY when
  // this is still the newest issued save (`mySeq === seqRef.current`) AND no edit
  // landed after this save read its content (`editGenRef` unchanged) — the
  // saveSeq out-of-order guard PLUS an edit-generation guard so an edit made
  // WHILE this PUT is in flight is not falsely reported as "saved" (it stays
  // dirty for the armed timer / next flush to persist).
  const runSave = useCallback(async (mySeq: number): Promise<void> => {
    const content = getContentRef.current()
    const genAtIssue = editGenRef.current
    setSaveStatusRef.current('saving')
    try {
      await putProgress(submissionId, content)
      if (!mountedRef.current) return
      if (mySeq === seqRef.current) {
        if (editGenRef.current === genAtIssue) {
          dirtyRef.current = false
          setSaveStatusRef.current('saved')
        } else {
          // A newer edit landed mid-flight; this PUT did not carry it. Stay
          // dirty and reflect 'unsaved' rather than a premature 'saved'.
          setSaveStatusRef.current('unsaved')
        }
      }
    } catch (error) {
      if (mountedRef.current && mySeq === seqRef.current) {
        // Dirty stays true → the next flush retries with the CURRENT (fuller)
        // content, never the stale in-flight body (AC22 no-data-loss).
        setSaveStatusRef.current('error')
        // Surface a racing-write 409/413 so the shell can flip read-only (AC15).
        onErrorRef.current?.(error)
      }
      throw error
    }
  }, [submissionId])

  // Issue a save serialized after the in-flight tail. Returns THIS save's
  // promise (throws on failure) so `flush` / the finalizer can await its ack.
  const enqueueSave = useCallback((): Promise<void> => {
    const mySeq = (seqRef.current += 1)
    const run = chainRef.current.then(() => runSave(mySeq))
    chainRef.current = run.catch(() => {}) // keep the chain alive past failures
    return run
  }, [runSave])

  const scheduleSave = useCallback((): void => {
    if (!enabledRef.current) return
    dirtyRef.current = true
    editGenRef.current += 1 // new content — invalidates any in-flight save's dirty-clear
    setSaveStatusRef.current('unsaved')
    // Cadence armed on the FIRST dirty edit; not reset per keystroke (FW-4).
    if (timerRef.current !== null) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // Re-check enabled: a 409 read-only flip may have landed after arming.
      if (enabledRef.current && dirtyRef.current) void enqueueSave()
    }, intervalRef.current)
  }, [enqueueSave])

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    return enqueueSave()
  }, [enqueueSave])

  // Beacon any pending edits on unmount (best-effort). NOT the finalizer path.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (dirtyRef.current && enabledRef.current) {
        beaconProgress(submissionId, getContentRef.current())
      }
    }
  }, [submissionId])

  return { scheduleSave, flush }
}
