/**
 * useCountdown — Story 2-3b Task 3.4 (Amelia-B6 fold).
 *
 * Extracts the `{initialSeconds, elapsedSeconds}` state model + setInterval
 * cleanup pattern originally shipped inline in `CenterSetupPage.tsx:87-157`
 * (Story 2-3a R1-P4) so `ClassSpawnPage` + `SoloFirstClassPage` can consume
 * the same 429 Retry-After countdown behavior without drift.
 *
 * Contract:
 *   useCountdown({ initialSeconds, onZero? })
 *     → { remainingSeconds, isActive, reset(newSeconds) }
 *
 * Behavior:
 *  - `remainingSeconds` starts at `initialSeconds`; decrements each 1000ms.
 *  - `isActive` reflects `remainingSeconds > 0`.
 *  - `onZero` fires exactly once when the countdown reaches 0 (does NOT fire
 *    when `initialSeconds` is 0 — that's the Retry-After: 0 edge per
 *    Murat-B2, where the button should re-enable immediately without a
 *    ticking counter).
 *  - `reset(N)` re-seeds the countdown; safe to call from event handlers
 *    (e.g. Sally-S3 repeat-429 fold re-seeds with the new Retry-After).
 *  - Unmount clears the interval — no timer leak.
 *
 * On 3rd downstream callsite (Epic 9 billing throttles / Epic 6 AI-grading
 * limits), promote to `src/hooks/useCountdown.ts` shared (FU-2-3b-E).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// R1-C2-P11 — named tick interval; mirrors `useAutoSave.DEBOUNCE_MS`.
const TICK_MS = 1_000

export interface UseCountdownOptions {
  initialSeconds: number
  onZero?: () => void
}

export interface UseCountdownResult {
  remainingSeconds: number
  isActive: boolean
  reset: (seconds: number) => void
}

interface CountdownState {
  initialSeconds: number
  elapsedSeconds: number
}

export function useCountdown(
  options: UseCountdownOptions,
): UseCountdownResult {
  const [state, setState] = useState<CountdownState>({
    initialSeconds: options.initialSeconds,
    elapsedSeconds: 0,
  })
  // Keep the latest onZero in a ref so callers can pass an inline callback
  // without our tick effect resubscribing on every render.
  const onZeroRef = useRef(options.onZero)
  useEffect(() => {
    onZeroRef.current = options.onZero
  }, [options.onZero])

  // R1-C2-P4 — reducer is pure: it only computes the next state. The
  // setInterval cleanup on unmount / re-run handles teardown; the terminal
  // `onZero` fire is dispatched from a separate effect below, so StrictMode's
  // double-invocation of the reducer cannot fire `onZero` twice per tick.
  useEffect(() => {
    if (state.initialSeconds <= 0) return
    const id = setInterval(() => {
      setState((prev) => {
        if (prev.elapsedSeconds + 1 >= prev.initialSeconds) {
          return { initialSeconds: 0, elapsedSeconds: 0 }
        }
        return { ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [state.initialSeconds])

  // R1-C2-P4 — fire `onZero` exactly once when the countdown reaches zero
  // from a non-zero start. Latches on the transition, not the state, so a
  // manual `reset(0)` doesn't accidentally fire it (matches the "does NOT
  // fire when initialSeconds is 0" header contract).
  const wasActiveRef = useRef(state.initialSeconds > 0)
  useEffect(() => {
    const isActiveNow = state.initialSeconds > 0
    if (wasActiveRef.current && !isActiveNow) {
      onZeroRef.current?.()
    }
    wasActiveRef.current = isActiveNow
  }, [state.initialSeconds])

  const reset = useCallback((seconds: number) => {
    setState({ initialSeconds: seconds, elapsedSeconds: 0 })
  }, [])

  const remainingSeconds = Math.max(
    0,
    state.initialSeconds - state.elapsedSeconds,
  )

  // R1-C2-P3 — memoize the return so callers passing this into `useCallback`
  // deps (e.g. `ClassSpawnPage.handleSpawnError`) don't re-create the memo
  // every render.
  return useMemo(
    () => ({
      remainingSeconds,
      isActive: remainingSeconds > 0,
      reset,
    }),
    [remainingSeconds, reset],
  )
}
