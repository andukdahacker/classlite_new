/**
 * useLockoutCountdown — Story 1-9d AC1 / Task 3.3.
 *
 * Drives the per-second mm:ss countdown on the LoginPage lockout state.
 * Independent of `useResendCountdown`'s 300s clamp because the lockout
 * window can be up to 15 minutes (matches backend
 * `service/auth.go:53-55` LoginLockoutDuration).
 *
 * The hook OWNS a `useState<boolean>` for `isActive` (Amelia A2 BLOCKER
 * pin per the story file). `deriveLoginPageMode` reads `countdown.isActive`
 * NOT raw `lockoutUntilMs`, so the form-restore on expiry fires within the
 * SAME tick that crosses the target with no searchParams change required.
 *
 * On the expiry tick the hook ALSO calls `clearLockoutUntilMs()` so a
 * same-tab F5 doesn't rehydrate from stale storage.
 *
 * Cleanup contract (Murat M8 ratchet — locked by co-located tests):
 *   - clearInterval fires on unmount
 *   - double-mount with different lockoutUntilMs produces exactly one
 *     tick per second (no leaked interval from prior mount)
 *   - isActive flips false on the SAME tick that crosses the target
 *   - clearLockoutUntilMs is invoked exactly once on the expiry tick
 */
import { useEffect, useRef, useState } from 'react'
import { clearLockoutUntilMs } from '@/features/auth/lib/lockoutStorage'

const TICK_MS = 1000
const SECONDS_PER_MINUTE = 60

export interface UseLockoutCountdownResult {
  isActive: boolean
  remainingSeconds: number
  formatted: string
}

function computeRemainingSeconds(target: number | null): number {
  if (target === null) return 0
  const diff = target - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / TICK_MS)
}

function formatMmSs(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE)
  const remainder = safe % SECONDS_PER_MINUTE
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function useLockoutCountdown(
  lockoutUntilMs: number | null,
): UseLockoutCountdownResult {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    computeRemainingSeconds(lockoutUntilMs),
  )
  const [isActive, setIsActive] = useState<boolean>(() => {
    return lockoutUntilMs !== null && lockoutUntilMs > Date.now()
  })
  const expiryHandledRef = useRef<boolean>(false)

  useEffect(() => {
    // On a new lockoutUntilMs (or transition to null), reset internal state
    // synchronously so a double-mount with different values doesn't carry
    // the prior tick. The setState calls below are intentionally synchronous
    // — they're the "subscribe to external system" half of the effect rule
    // (Date.now() is the external system); the alternative (compute at
    // render-time from props + Date.now()) breaks the Amelia A2 pin that
    // the hook OWN the isActive useState.
    expiryHandledRef.current = false
    const initial = computeRemainingSeconds(lockoutUntilMs)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemainingSeconds(initial)
    const initiallyActive =
      lockoutUntilMs !== null && lockoutUntilMs > Date.now()
    setIsActive(initiallyActive)

    if (!initiallyActive) {
      // If the caller passes a past timestamp, ensure storage is clean.
      if (lockoutUntilMs !== null && !expiryHandledRef.current) {
        expiryHandledRef.current = true
        clearLockoutUntilMs()
      }
      return
    }

    const id = setInterval(() => {
      const next = computeRemainingSeconds(lockoutUntilMs)
      setRemainingSeconds(next)
      if (next <= 0) {
        setIsActive(false)
        if (!expiryHandledRef.current) {
          expiryHandledRef.current = true
          clearLockoutUntilMs()
        }
        clearInterval(id)
      }
    }, TICK_MS)

    return () => {
      clearInterval(id)
    }
  }, [lockoutUntilMs])

  return {
    isActive,
    remainingSeconds,
    formatted: formatMmSs(remainingSeconds),
  }
}
