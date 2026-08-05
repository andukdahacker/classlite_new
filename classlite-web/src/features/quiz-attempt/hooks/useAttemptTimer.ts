/**
 * useAttemptTimer — Story 5.2b Task 5 (AC11/AC14/AC19/AC20). Wraps the promoted
 * `useCountdown` (MODE B, injectable time source) around the monotonic
 * `serverNow()` clock to drive the attempt countdown, the warning tiers, and the
 * single-fire expiry.
 *
 *  - UNTIMED (`timeBudgetSeconds === null`): `remainingSeconds` is null, no
 *    countdown, no auto-submit (AC11).
 *  - EXPIRY (AC14): `onExpire` fires EXACTLY ONCE when `remaining <= 0` — via
 *    both the countdown's transition latch and a local `firedRef` belt.
 *  - RESUME-FINALIZE (AC19): if the attempt loads ALREADY expired
 *    (`serverNow() >= startedAt + timeBudget`), `onExpire` fires immediately on
 *    mount (the countdown's transition latch never fires for a start-at-zero).
 *  - RE-FOCUS (AC11, Sally-I1): a `visibilitychange` back to visible
 *    re-reconciles the derived remaining off a fresh `serverNow()` read.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useCountdown } from '@/hooks/useCountdown'
import {
  computeRemainingSeconds,
  isExpired as isExpiredAt,
  timerWarningLevel,
  type TimerWarningLevel,
} from '../lib/attemptTimer'

export interface UseAttemptTimerOptions {
  startedAt: string
  timeBudgetSeconds: number | null
  /** The monotonic server-anchored clock (never `Date.now()`). */
  serverNow: () => number
  /** Runs the AC18 finalizer. Fired exactly once at expiry / on an expired load. */
  onExpire: () => void
  /** Off on read-only attempts — no auto-submit (AC15). */
  enabled?: boolean
  /**
   * Called after a tab re-focus reconcile with the fresh remaining seconds (AC11
   * / Sally-I1) — the shell announces "welcome back — N left" rather than letting
   * the timer jump silently. Only fired for a still-running timed attempt.
   */
  onReconcile?: (remainingSeconds: number) => void
}

export interface UseAttemptTimerResult {
  /** Seconds left, or null when untimed. */
  remainingSeconds: number | null
  warningLevel: TimerWarningLevel
  /** True once a timed attempt has run out. */
  expired: boolean
}

const UNTIMED_SENTINEL = Number.MAX_SAFE_INTEGER

export function useAttemptTimer({
  startedAt,
  timeBudgetSeconds,
  serverNow,
  onExpire,
  enabled = true,
  onReconcile,
}: UseAttemptTimerOptions): UseAttemptTimerResult {
  const timed = timeBudgetSeconds !== null
  const firedRef = useRef(false)

  // Keep the latest callbacks/inputs in refs so the countdown source + expiry
  // handler stay stable (never a dep churn). Synced in an effect (never written
  // during render) per the codebase convention.
  const onExpireRef = useRef(onExpire)
  const enabledRef = useRef(enabled)
  const serverNowRef = useRef(serverNow)
  const onReconcileRef = useRef(onReconcile)
  useEffect(() => {
    onExpireRef.current = onExpire
    enabledRef.current = enabled
    serverNowRef.current = serverNow
    onReconcileRef.current = onReconcile
  })

  const fireExpiry = useCallback(() => {
    if (!timed || !enabledRef.current || firedRef.current) return
    firedRef.current = true
    onExpireRef.current()
  }, [timed])

  const getRemainingSeconds = useCallback((): number => {
    if (!timed) return UNTIMED_SENTINEL
    return computeRemainingSeconds(
      startedAt,
      timeBudgetSeconds,
      serverNowRef.current(),
    ) as number
  }, [timed, startedAt, timeBudgetSeconds])

  const countdown = useCountdown({
    initialSeconds: 0,
    getRemainingSeconds,
    onZero: fireExpiry,
  })

  // AC19 — resume-finalize: an attempt that loads ALREADY expired never crosses
  // the active→inactive edge, so fire once on mount when it starts expired.
  useEffect(() => {
    if (timed && isExpiredAt(startedAt, timeBudgetSeconds, serverNowRef.current())) {
      fireExpiry()
    }
  }, [timed, startedAt, timeBudgetSeconds, fireExpiry])

  // AC11 / Sally-I1 — re-reconcile the derived remaining on tab re-focus, then
  // announce the fresh remaining ("welcome back — N left") so it is not a silent
  // jump. Only for a still-running timed attempt (an expired one auto-submits).
  const reconcile = countdown.reconcile
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      reconcile()
      if (!timed) return
      const remaining = computeRemainingSeconds(
        startedAt,
        timeBudgetSeconds,
        serverNowRef.current(),
      )
      if (remaining !== null && remaining > 0) onReconcileRef.current?.(remaining)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reconcile, timed, startedAt, timeBudgetSeconds])

  const remainingSeconds = timed ? countdown.remainingSeconds : null

  return {
    remainingSeconds,
    warningLevel: timerWarningLevel(remainingSeconds),
    expired: timed && countdown.remainingSeconds <= 0,
  }
}
