/**
 * useCountdown — promoted from `features/onboarding/hooks/useCountdown.ts` to
 * the shared `src/hooks/` per FU-2-3b-E, on its 3rd consumer (Story 5.2b's
 * attempt timer). Onboarding imports the new path unchanged.
 *
 * Two modes, one hook:
 *
 *  - MODE A (default — onboarding 429 Retry-After): counts elapsed 1s ticks from
 *    `initialSeconds`. Behaviour is byte-identical to the original.
 *
 *  - MODE B (Story 5.2b, AC11/AC11a — provide `getRemainingSeconds`): the tick's
 *    time source is INJECTABLE. Instead of counting ticks, each 1s tick DERIVES
 *    `remainingSeconds` from `getRemainingSeconds()` (production wires it to the
 *    monotonic `serverNow()`-based computation; tests drive it manually). This
 *    is skew-immune and re-reconciles on demand via `reconcile()` (tab
 *    re-focus). `onZero` still fires exactly once on the active→inactive edge.
 *
 * In BOTH modes `onZero` fires exactly once when the countdown reaches 0 from a
 * non-zero start (never when starting at 0), latched on the transition.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Named tick interval; mirrors `useAutoSave.DEBOUNCE_MS`.
const TICK_MS = 1_000

export interface UseCountdownOptions {
  initialSeconds: number
  onZero?: () => void
  /**
   * Story 5.2b AC11a — injectable time source. When provided, the hook runs in
   * MODE B: `remainingSeconds` is derived from this on every tick (skew-immune)
   * rather than counting elapsed ticks. Omit for the onboarding tick-count mode.
   */
  getRemainingSeconds?: () => number
}

export interface UseCountdownResult {
  remainingSeconds: number
  isActive: boolean
  reset: (seconds: number) => void
  /** MODE B — re-derive `remainingSeconds` from the source now (tab re-focus). No-op in MODE A. */
  reconcile: () => void
}

interface CountdownState {
  initialSeconds: number
  elapsedSeconds: number
}

export function useCountdown(
  options: UseCountdownOptions,
): UseCountdownResult {
  // Mode is fixed for the lifetime of a call site (a given consumer uses one).
  const derivedMode = options.getRemainingSeconds !== undefined
  const getRemainingRef = useRef(options.getRemainingSeconds)
  const onZeroRef = useRef(options.onZero)
  // Latest-value refs synced in an effect (never written during render).
  useEffect(() => {
    getRemainingRef.current = options.getRemainingSeconds
    onZeroRef.current = options.onZero
  })

  const clampDerived = useCallback((): number => {
    const raw = getRemainingRef.current?.() ?? 0
    return Math.max(0, Math.floor(raw))
  }, [])

  // ---- MODE B state: the derived remaining ----
  // Seed from the PROP (not the ref) so the initializer reads no ref during
  // render; subsequent derivations go through `clampDerived` inside effects.
  const [derivedRemaining, setDerivedRemaining] = useState<number>(() =>
    options.getRemainingSeconds
      ? Math.max(0, Math.floor(options.getRemainingSeconds()))
      : 0,
  )

  // ---- MODE A state: the elapsed-tick model ----
  const [state, setState] = useState<CountdownState>({
    initialSeconds: options.initialSeconds,
    elapsedSeconds: 0,
  })

  // Tick — one setInterval, branched by mode. In both, the terminal `onZero`
  // fire is dispatched from a separate effect so StrictMode's double-invocation
  // cannot double-fire.
  useEffect(() => {
    if (derivedMode) {
      // The initializer seeds the first value; the interval re-derives from the
      // injected source each second (setState inside the callback, not the
      // effect body). Re-focus reconcile goes through `reconcile()`.
      const id = setInterval(() => setDerivedRemaining(clampDerived()), TICK_MS)
      return () => clearInterval(id)
    }
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
  }, [derivedMode, clampDerived, state.initialSeconds])

  const remainingSeconds = derivedMode
    ? derivedRemaining
    : Math.max(0, state.initialSeconds - state.elapsedSeconds)

  // Fire `onZero` exactly once on the active→inactive transition. Latches on the
  // transition, not the state, so a manual `reset(0)` / starting at 0 doesn't
  // fire it.
  const wasActiveRef = useRef(remainingSeconds > 0)
  useEffect(() => {
    const isActiveNow = remainingSeconds > 0
    if (wasActiveRef.current && !isActiveNow) {
      onZeroRef.current?.()
    }
    wasActiveRef.current = isActiveNow
  }, [remainingSeconds])

  const reset = useCallback(
    (seconds: number) => {
      if (derivedMode) {
        setDerivedRemaining(Math.max(0, Math.floor(seconds)))
      } else {
        setState({ initialSeconds: seconds, elapsedSeconds: 0 })
      }
    },
    [derivedMode],
  )

  const reconcile = useCallback(() => {
    if (derivedMode) setDerivedRemaining(clampDerived())
  }, [derivedMode, clampDerived])

  return useMemo(
    () => ({
      remainingSeconds,
      isActive: remainingSeconds > 0,
      reset,
      reconcile,
    }),
    [remainingSeconds, reset, reconcile],
  )
}
