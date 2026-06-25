/**
 * useResendCountdown — Story 1-9a AC4.
 *
 * Small co-located hook for the 60-second resend countdown that mirrors
 * the backend's per-email rate limit (`cmd/api/main.go:138-143`). Owns a
 * single `setInterval(decrement, 1000)` that lives inside a `useEffect`
 * per the FW-4 "subscription cleanup" permitted exception.
 *
 * API:
 *   const { remaining, start, isActive } = useResendCountdown()
 *   start(60) // begins counting down from 60s; clamped to [1, 300]
 *
 * `remaining` decrements to 0 then auto-clears via the same effect.
 * Cleanup on unmount.
 *
 * The internal `tickToken` state increments only when a new countdown
 * starts so the effect re-runs ONCE per start (not once per tick) and
 * the interval lives for the whole countdown rather than being rebuilt
 * every second.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const RESEND_COUNTDOWN_SECONDS = 60
export const MAX_COUNTDOWN_SECONDS = 300
export const MIN_COUNTDOWN_SECONDS = 1
const TICK_MS = 1000

export interface UseResendCountdownResult {
  remaining: number
  start: (seconds: number) => void
  isActive: boolean
}

function clampSeconds(value: number): number {
  // Malformed input (NaN from a `Retry-After: abc` header parse, or
  // an Infinity-poisoned arithmetic upstream) falls back to the
  // conservative 60s default — NOT MIN (1s), which would be weaker
  // than the default and let a misled backend response collapse to a
  // ~1s spam window.
  if (!Number.isFinite(value)) return RESEND_COUNTDOWN_SECONDS
  if (value < MIN_COUNTDOWN_SECONDS) return MIN_COUNTDOWN_SECONDS
  if (value > MAX_COUNTDOWN_SECONDS) return MAX_COUNTDOWN_SECONDS
  return Math.floor(value)
}

export function useResendCountdown(): UseResendCountdownResult {
  const [remaining, setRemaining] = useState(0)
  const [tickToken, setTickToken] = useState(0)
  const remainingRef = useRef(0)

  const start = useCallback((seconds: number) => {
    const clamped = clampSeconds(seconds)
    remainingRef.current = clamped
    setRemaining(clamped)
    setTickToken((t) => t + 1)
  }, [])

  useEffect(() => {
    if (tickToken === 0) return
    if (remainingRef.current <= 0) return
    const id = setInterval(() => {
      const next = Math.max(0, remainingRef.current - 1)
      remainingRef.current = next
      setRemaining(next)
      if (next <= 0) {
        clearInterval(id)
      }
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [tickToken])

  return {
    remaining,
    start,
    isActive: remaining > 0,
  }
}
