/**
 * useAutoSave — Story 2-3a AC4/AC6 debounced auto-save primitive.
 *
 * Wraps `usePutOnboardingProgress` and exposes a debounce-and-flush API for
 * the CenterSetupPage form. Contract (per Task 5.1 folds):
 *
 *   - `scheduleSave(payload)` — debounces 1500ms. Repeat calls collapse to
 *     ONE PUT per debounce window (Murat-S4 invariant 1) carrying the LAST
 *     payload (invariant 2). The timer clears on unmount (invariant 3).
 *   - `flush()` — cancels any pending debounce and fires the PUT
 *     immediately. Returns a promise that resolves once the write settles
 *     (used by AC11 "save and finish later" + AC7 submit gate).
 *   - `savingState` — `idle | saving | saved | error | persistentFailure`.
 *     `persistentFailure` (Sally-B2 fold) latches after 3 consecutive
 *     failures (~5s at 1500ms cadence) so the shell can render the
 *     "Can't reach the server" banner (AC4).
 *   - `lastSavedAt` — the `updatedAt` string from the last successful PUT
 *     (Winston-W1 fold — NOT `meta.serverTime`, which `apiFetch` strips).
 *
 * Winston-W3 out-of-order guard: a monotonic `saveSeq` counter tags each
 * in-flight save. If a slower save resolves after a newer one has already
 * updated cache/state, the slower save's result is dropped instead of
 * stomping the newer value.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { PutOnboardingProgressResult } from '../api/usePutOnboardingProgress'
import {
  usePutOnboardingProgress,
  type OnboardingProgressPayload,
} from '../api/usePutOnboardingProgress'

export type SavingState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'persistentFailure'

export type OnboardingStep = PutOnboardingProgressResult['currentStep']

const DEBOUNCE_MS = 1500
const PERSISTENT_FAILURE_THRESHOLD = 3

export interface UseAutoSaveOptions {
  /** Which wizard step the debounced PUT bookmarks. Defaults to `center`
   * (the only step Story 2-3a owns). 2-3b/c will supply their own step. */
  currentStep?: OnboardingStep
}

export interface UseAutoSaveResult {
  savingState: SavingState
  lastSavedAt: string | null
  scheduleSave: (payload: OnboardingProgressPayload) => void
  flush: () => Promise<void>
  /**
   * Manual retry escape from `persistentFailure`. Resets the consecutive-
   * failures counter and re-fires the pending payload (if any). Callers
   * expose a "Try again" button in the persistent-failure banner (R1-P26).
   */
  retryNow: () => Promise<void>
}

export function useAutoSave(
  options: UseAutoSaveOptions = {},
): UseAutoSaveResult {
  const currentStep: OnboardingStep = options.currentStep ?? 'center'
  const put = usePutOnboardingProgress()
  const putRef = useRef(put)
  useEffect(() => {
    putRef.current = put
  }, [put])

  const [savingState, setSavingState] = useState<SavingState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPayloadRef = useRef<OnboardingProgressPayload | null>(null)
  const lastAttemptedPayloadRef = useRef<OnboardingProgressPayload | null>(null)
  const consecutiveFailuresRef = useRef(0)
  const saveSeqRef = useRef(0)
  const latestSeqRef = useRef(0)
  const isMountedRef = useRef(true)

  const doSave = useCallback(
    async (payload: OnboardingProgressPayload) => {
      saveSeqRef.current += 1
      const mySeq = saveSeqRef.current
      latestSeqRef.current = mySeq
      lastAttemptedPayloadRef.current = payload
      setSavingState('saving')
      try {
        const result: PutOnboardingProgressResult =
          await putRef.current.mutateAsync({
            currentStep,
            payload,
          })
        if (!isMountedRef.current || mySeq < latestSeqRef.current) return
        consecutiveFailuresRef.current = 0
        setLastSavedAt(result.updatedAt)
        setSavingState('saved')
      } catch {
        if (!isMountedRef.current || mySeq < latestSeqRef.current) return
        consecutiveFailuresRef.current += 1
        setSavingState(
          consecutiveFailuresRef.current >= PERSISTENT_FAILURE_THRESHOLD
            ? 'persistentFailure'
            : 'error',
        )
      }
    },
    [currentStep],
  )

  const scheduleSave = useCallback(
    (payload: OnboardingProgressPayload) => {
      pendingPayloadRef.current = payload
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const nextPayload = pendingPayloadRef.current
        pendingPayloadRef.current = null
        timerRef.current = null
        if (nextPayload) void doSave(nextPayload)
      }, DEBOUNCE_MS)
    },
    [doSave],
  )

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingPayloadRef.current
    pendingPayloadRef.current = null
    if (pending) {
      await doSave(pending)
    }
  }, [doSave])

  const retryNow = useCallback(async () => {
    // Reset the ratchet so a successful retry lands us back in `saved`.
    consecutiveFailuresRef.current = 0
    const pending = pendingPayloadRef.current ?? lastAttemptedPayloadRef.current
    if (!pending) {
      setSavingState('idle')
      return
    }
    pendingPayloadRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await doSave(pending)
  }, [doSave])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingPayloadRef.current = null
    }
  }, [])

  return { savingState, lastSavedAt, scheduleSave, flush, retryNow }
}
