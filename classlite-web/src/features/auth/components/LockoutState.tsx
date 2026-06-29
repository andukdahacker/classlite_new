/**
 * LockoutState — Story 1-9d AC1 / Task 3.5.
 *
 * Mode-replacement region that the LoginPage renders in place of the
 * `<CollapsibleEmailForm>` subtree when the user has hit the backend's
 * 429 ACCOUNT_LOCKED window. Receives countdown data as props so the
 * `useLockoutCountdown` hook stays single-instance at the page level
 * (Amelia A2 BLOCKER pin — the hook owns `isActive` for mode-derive).
 *
 * A11y contract:
 *   - Container is `role="alert"` — screen readers announce the region
 *     contents on mount as a live-region utterance of the mode change.
 *     The announce IS the acknowledgment; we do NOT also steal focus to
 *     the heading (resolved D1 from code review 2026-06-29 — the prior
 *     Sally focus-mgmt pin caused SR double-announce on top of the
 *     region's own live-region utterance).
 *   - Per-second countdown ticks via `aria-live="off"` — announcing every
 *     second is hostile to screen-reader users.
 *   - Threshold-announce region (`aria-live="polite" role="status"`) fires
 *     text exactly twice as the countdown crosses 60s and 30s remaining.
 *     The fire is edge-triggered via a `previousRemainingSeconds` ref so
 *     it doesn't re-fire while the value sits below the threshold.
 *
 * Recovery CTA: `<Link to="/forgot-password">` — backend
 * `RequestPasswordReset` does NOT check lockout state (verified per
 * `auth_reset.go:33-69`), so password-reset remains usable during lockout.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SECONDS_PER_MINUTE = 60
const THRESHOLD_ONE_MINUTE = 60
const THRESHOLD_THIRTY_SECONDS = 30

const CLOCK_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10 text-[color:var(--cl-status-warning)]"
  >
    <circle
      cx="20"
      cy="20"
      r="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M20 10 L20 20 L27 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
)

export interface LockoutStateProps {
  remainingSeconds: number
  formatted: string
}

export default function LockoutState({
  remainingSeconds,
  formatted,
}: LockoutStateProps): JSX.Element {
  const { t } = useTranslation()
  const previousRemainingRef = useRef<number>(remainingSeconds)
  const [thresholdMessage, setThresholdMessage] = useState<string>('')

  // Edge-triggered threshold-announce: fire once as the countdown crosses
  // 60s, again as it crosses 30s. The ref carries the previous remaining
  // value so the effect re-runs only when the threshold is actually crossed.
  useEffect(() => {
    const previous = previousRemainingRef.current
    if (
      previous > THRESHOLD_ONE_MINUTE &&
      remainingSeconds <= THRESHOLD_ONE_MINUTE &&
      remainingSeconds > THRESHOLD_THIRTY_SECONDS
    ) {
      setThresholdMessage(t('auth.login.lockout.thresholdOneMinute'))
    } else if (
      previous > THRESHOLD_THIRTY_SECONDS &&
      remainingSeconds <= THRESHOLD_THIRTY_SECONDS &&
      remainingSeconds > 0
    ) {
      setThresholdMessage(t('auth.login.lockout.thresholdThirtySeconds'))
    }
    previousRemainingRef.current = remainingSeconds
  }, [remainingSeconds, t])

  const minutes = Math.max(1, Math.ceil(remainingSeconds / SECONDS_PER_MINUTE))

  return (
    <div
      role="alert"
      data-testid="login-lockout"
      className="grid gap-4 rounded-md border border-[color:var(--cl-status-warning)]/40 bg-[color:var(--cl-status-warning)]/5 p-6 text-center"
    >
      <div className="flex justify-center">{CLOCK_SVG}</div>
      <h1
        data-testid="login-lockout-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        {t('auth.login.lockout.heading')}
      </h1>
      <p className="text-sm text-[var(--cl-ink)]">
        {t('auth.login.lockout.body', { count: minutes })}
      </p>
      <p
        data-testid="login-lockout-countdown"
        aria-live="off"
        className="font-mono text-3xl font-semibold text-[color:var(--cl-status-warning)]"
      >
        {formatted}
      </p>
      <span
        data-testid="login-lockout-threshold-announce"
        aria-live="polite"
        role="status"
        className="sr-only"
      >
        {thresholdMessage}
      </span>
      <Link
        to="/forgot-password"
        data-testid="login-lockout-reset-cta"
        className={cn(
          buttonVariants({ size: 'lg' }),
          'h-12 w-full bg-[var(--cl-accent)] text-white',
        )}
      >
        {t('auth.login.lockout.resetCta')}
      </Link>
    </div>
  )
}
