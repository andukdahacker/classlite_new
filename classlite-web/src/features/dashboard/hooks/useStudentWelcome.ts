/**
 * useStudentWelcome — the durable client-side gate for the s62 first-login
 * welcome (Story 8-1b, D12, RULED Ducdo 2026-09-15). The payload carries NO
 * first-run flag and empty-array inference is FORBIDDEN (a returning student
 * between terms would wrongly re-trigger the welcome), so the signal is a
 * durable per-user localStorage flag — a POSITIVE "has been welcomed" mark, so
 * absence means "never welcomed", never "no data".
 *
 * Mirrors the `useChecklistState` client-only-persistence precedent (FU-2-4).
 * A server-side cross-device signal is FU-8-1-D; the per-device caveat is
 * accepted for v1.
 */
import { useCallback, useState } from 'react'

const FLAG_PREFIX = 'dashboard.student.welcomed:'

/** The localStorage key for a given user's welcome flag. */
export function studentWelcomeKey(userId: string): string {
  return `${FLAG_PREFIX}${userId}`
}

export interface StudentWelcomeState {
  /** True once the welcome should render (flag ABSENT + a real userId). */
  showWelcome: boolean
  /** Persists the flag and hides the welcome for good on this device. */
  dismiss: () => void
}

export function useStudentWelcome(userId: string | null): StudentWelcomeState {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (userId == null) return true
    return window.localStorage.getItem(studentWelcomeKey(userId)) !== null
  })

  const dismiss = useCallback(() => {
    if (userId != null) {
      window.localStorage.setItem(studentWelcomeKey(userId), '1')
    }
    setDismissed(true)
  }, [userId])

  return { showWelcome: userId != null && !dismissed, dismiss }
}
