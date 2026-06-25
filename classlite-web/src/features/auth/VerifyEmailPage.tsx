/**
 * VerifyEmailPage — Story 1-9a AC1 / AC3 / AC4 / AC5 / AC6 / AC7.
 *
 * Dual-mode page mounted at `/verify-email` under AuthLayout.
 * Branches on `useSearchParams()`:
 *
 *   ?pollId={uuid}  → Polling mode (post-register).
 *   ?token={base64} → Click-through mode (email link landing).
 *   neither         → Invalid mode.
 *   BOTH            → Click-through wins (the user clicked the email;
 *                     the pollId is now stale).
 *
 * The two modes share the same AuthCard shell + the same expired-state
 * inline alert (UX-DR16 three-part recovery) so a 404 polling response
 * and a 410 click-through response land on the same visual.
 *
 * Polling mode contracts (AC3 + AC5 — see story for the full table):
 *   - 5-second poll interval via `useVerificationPoller` (wraps the
 *     shipped `usePolling` primitive).
 *   - 60-second resend countdown via `useResendCountdown` mirrors the
 *     backend per-email rate limit.
 *   - 10-minute polling cap: when the cap fires, the poller halts via
 *     `enabled=false` AND `commitTerminal('timeout')` seals the in-flight
 *     race (any poll-in-flight that resolves AFTER the cap is dropped
 *     silently by the terminal-state ref).
 *   - `verified: true` → success aria-live announcement → 1500ms delay
 *     → `navigate('/login?verified=1', { replace: true })`.
 *   - The 1500ms timer is scheduled INSIDE a `useEffect` keyed off
 *     `verified === true` so React's standard effect cleanup owns the
 *     `clearTimeout` (mitigates R-NEW=12 — see story Change Log).
 *   - Plus a `stillMountedAndVerifiedRef` guard belt-and-suspenders that
 *     the navigate callback re-reads before firing (catches the
 *     parallel-session-wipe-during-delay race).
 *
 * Click-through mode contracts (AC6):
 *   - `useVerifyEmail()` fires `POST /api/auth/verify-email` exactly once
 *     on mount via the `!verifyEmail.isIdle` guard (NOT a useRef latch
 *     — see story Dev Notes "StrictMode + the click-through POST" for
 *     the rationale swap).
 *   - Same redirect timer pattern as polling mode for the 200 path.
 *   - 410 → expired state. 404 → invalid state. 422/5xx/network →
 *     generic alert + try-again button (calls `verifyEmail.reset()` to
 *     flip back to isIdle so the effect re-fires).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  useNavigate,
  useSearchParams,
} from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import AuthCard from '@/features/auth/components/AuthCard'
import { useAuth } from '@/hooks/useAuth'
import { useVerificationPoller } from '@/features/auth/hooks/useVerificationPoller'
import {
  MAX_COUNTDOWN_SECONDS,
  RESEND_COUNTDOWN_SECONDS,
  useResendCountdown,
} from '@/features/auth/hooks/useResendCountdown'
import { useResendVerification } from '@/features/auth/api/resendVerification'
import { useVerifyEmail } from '@/features/auth/api/verifyEmail'
import { ApiError } from '@/lib/api-fetch'

export const VERIFY_REDIRECT_DELAY_MS = 1500
export const POLLING_TIMEOUT_MS = 10 * 60 * 1000

type Mode = 'polling' | 'click-through' | 'invalid'

function deriveMode(
  pollId: string | null,
  token: string | null,
): Mode {
  if (token !== null && token !== '') return 'click-through'
  if (pollId !== null && pollId !== '') return 'polling'
  return 'invalid'
}

const ENVELOPE_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 80 80"
    xmlns="http://www.w3.org/2000/svg"
    className="h-16 w-16 text-amber-600 md:h-20 md:w-20"
  >
    <rect
      x="10"
      y="20"
      width="60"
      height="40"
      rx="4"
      fill="var(--cl-surface)"
      stroke="var(--cl-ink)"
      strokeWidth="2"
    />
    <path
      d="M10 24 L40 44 L70 24"
      fill="none"
      stroke="var(--cl-ink)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="62" cy="56" r="12" fill="var(--cl-surface)" />
    <circle
      cx="62"
      cy="56"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M57 56 L61 60 L67 52"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const CLOCK_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10 text-amber-600"
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

export default function VerifyEmailPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const pollId = searchParams.get('pollId')
  const token = searchParams.get('token')
  const mode = deriveMode(pollId, token)

  if (mode === 'invalid') {
    return <InvalidView />
  }
  if (mode === 'click-through') {
    return <ClickThroughView token={token!} />
  }
  return (
    <PollingView
      pollId={pollId!}
      userEmail={user?.email ?? null}
      navigate={navigate}
      setSearchParams={setSearchParams}
      t={t}
    />
  )
}

function InvalidView() {
  const { t } = useTranslation()
  return (
    <AuthCard
      regionLabel={t('auth.verify.invalidHeading')}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
          data-testid="verify-heading"
        >
          {t('auth.verify.invalidHeading')}
        </h1>
      }
      body={
        <div data-testid="verify-invalid" className="grid gap-4 text-center">
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('auth.verify.invalidBody')}
          </p>
        </div>
      }
      footer={
        <Link
          to="/login"
          data-testid="verify-invalid-login-link"
          className="text-[var(--cl-accent)] underline"
        >
          {t('auth.login.title')}
        </Link>
      }
    />
  )
}

interface ClickThroughViewProps {
  token: string
}

function ClickThroughView({ token }: ClickThroughViewProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const verifyEmail = useVerifyEmail()
  const stillMountedRef = useRef(true)
  useEffect(() => {
    stillMountedRef.current = true
    return () => {
      stillMountedRef.current = false
    }
  }, [])

  // Mount-time mutation guard — uses the mutation's own isIdle state
  // (party-mode 2026-06-25 swap from the useRef latch). StrictMode's
  // second mount sees `!isIdle` and skips. Try-again calls
  // `verifyEmail.reset()` which flips isIdle back to true.
  //
  // Deps avoid the full `verifyEmail` object (recreated every render)
  // and pin only the stable members the effect actually reads:
  // - `verifyEmail.mutate` is stable in TanStack Query v5+
  // - `verifyEmail.isIdle` is the gate the effect explicitly checks
  // Together this prevents per-render dep churn while still re-firing
  // on the steady-state transitions (token change, post-reset isIdle).
  const { mutate: verifyEmailMutate, isIdle: verifyEmailIsIdle } = verifyEmail
  useEffect(() => {
    if (!token) return
    if (!verifyEmailIsIdle) return
    verifyEmailMutate({ token })
  }, [token, verifyEmailIsIdle, verifyEmailMutate])

  const isSuccess = verifyEmail.isSuccess && verifyEmail.data?.verified === true

  useEffect(() => {
    if (!isSuccess) return
    const id = setTimeout(() => {
      if (stillMountedRef.current) {
        navigate('/login?verified=1', { replace: true })
      }
    }, VERIFY_REDIRECT_DELAY_MS)
    return () => {
      clearTimeout(id)
    }
  }, [isSuccess, navigate])

  let body: ReactNode
  let regionLabelKey = 'auth.verify.checkingNow'

  if (verifyEmail.isError) {
    const err = verifyEmail.error
    if (err instanceof ApiError && err.status === 410) {
      regionLabelKey = 'auth.verify.expiredHeading'
      body = (
        <ExpiredState
          onResendClick={null}
          showResendCta={false}
          t={t}
        />
      )
    } else if (err instanceof ApiError && err.status === 404) {
      regionLabelKey = 'auth.verify.invalidHeading'
      body = (
        <div data-testid="verify-invalid" className="grid gap-4 text-center">
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('auth.verify.invalidBody')}
          </p>
        </div>
      )
    } else {
      regionLabelKey = 'auth.verify.error.generic'
      body = (
        <div className="grid gap-3 text-center">
          <div
            role="alert"
            data-testid="verify-click-through-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t('auth.verify.error.generic')}
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="verify-try-again"
            onClick={() => verifyEmail.reset()}
          >
            {t('app.errorBoundary.retryCta')}
          </Button>
        </div>
      )
    }
  } else if (isSuccess) {
    body = (
      <div className="grid gap-3 text-center">
        <p
          data-testid="verify-success-redirecting"
          aria-live="polite"
          className="text-sm text-[var(--cl-ink)]"
        >
          {t('auth.verify.successRedirecting')}
        </p>
      </div>
    )
  } else {
    body = (
      <div
        data-testid="verify-click-through"
        className="grid gap-3 text-center"
      >
        <p
          data-testid="verify-checkingNow"
          aria-live="polite"
          className="text-sm text-[var(--cl-ink-soft)]"
        >
          {t('auth.verify.checkingNow')}
        </p>
      </div>
    )
  }

  // Footer escape hatch for the 404 invalid sub-state.
  const footer =
    verifyEmail.isError &&
    verifyEmail.error instanceof ApiError &&
    verifyEmail.error.status === 404 ? (
      <Link
        to="/login"
        data-testid="verify-invalid-login-link"
        className="text-[var(--cl-accent)] underline"
      >
        {t('auth.login.title')}
      </Link>
    ) : undefined

  return (
    <AuthCard
      regionLabel={t(regionLabelKey)}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
          data-testid="verify-heading"
        >
          {t(regionLabelKey)}
        </h1>
      }
      body={body}
      footer={footer}
    />
  )
}

interface PollingViewProps {
  pollId: string
  userEmail: string | null
  navigate: ReturnType<typeof useNavigate>
  setSearchParams: ReturnType<typeof useSearchParams>[1]
  t: ReturnType<typeof useTranslation>['t']
}

function PollingView({
  pollId,
  userEmail,
  navigate,
  setSearchParams,
  t,
}: PollingViewProps) {
  const [pollerEnabled, setPollerEnabled] = useState(true)
  const [timeoutHit, setTimeoutHit] = useState(false)
  // Per DN1 pragmatic-scope resolution (2026-06-25): this ref only
  // covers the unmount-during-delay case; a parallel session-wipe is
  // out-of-scope because polling-mode users are unverified by
  // definition (no session to wipe).
  const stillMountedRef = useRef(true)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    stillMountedRef.current = true
    return () => {
      stillMountedRef.current = false
    }
  }, [])

  const { lastResponse, lastError, commitTerminal, rerunOnce } =
    useVerificationPoller({
      pollId,
      enabled: pollerEnabled,
    })

  const verified = lastResponse?.verified === true
  const expired =
    lastError?.status === 404 && lastError?.code === 'POLL_ID_NOT_FOUND'

  // Disable the poller as soon as ANY terminal state is reached. The
  // terminalStateRef inside useVerificationPoller already drops late
  // in-flight responses; flipping enabled=false here also cancels the
  // setInterval schedule so the user's network is no longer being
  // polled. Without this effect, a poll that returned 404 / verified
  // would still re-fire every 5s indefinitely. The cascading-render
  // lint disable is justified: pollerEnabled IS effect-derived state
  // (the source of truth is `verified`/`expired` from the poller
  // hook); the follow-up render is the desired observable signal so
  // `usePolling`'s `enabled` prop reflects the just-committed terminal
  // state on the NEXT tick.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (verified || expired) setPollerEnabled(false)
  }, [verified, expired])

  // 10-minute cap. The timer's cleanup owns clearTimeout so an
  // unmount + remount mid-window (route change + back) re-arms cleanly.
  // startedAtRef pins the cap relative to first mount, so a parent
  // re-render does NOT reset the window.
  useEffect(() => {
    if (verified || expired || timeoutHit) return
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now()
    }
    const elapsed = Date.now() - startedAtRef.current
    const remainder = Math.max(0, POLLING_TIMEOUT_MS - elapsed)
    const id = setTimeout(() => {
      setPollerEnabled(false)
      setTimeoutHit(true)
      commitTerminal('timeout')
    }, remainder)
    return () => {
      clearTimeout(id)
    }
  }, [verified, expired, timeoutHit, commitTerminal])

  // 1500ms success redirect — scheduled inside an effect keyed off
  // `verified === true` so the cleanup owns clearTimeout. The
  // stillMountedRef guard short-circuits the navigate callback if the
  // component unmounts during the delay (R-NEW=12 mitigation,
  // pragmatic scope per DN1 resolution). The pollerEnabled flip
  // happens in the effect above (verified-keyed); no redundant write
  // here.
  useEffect(() => {
    if (!verified) return
    const id = setTimeout(() => {
      if (stillMountedRef.current) {
        navigate('/login?verified=1', { replace: true })
      }
    }, VERIFY_REDIRECT_DELAY_MS)
    return () => {
      clearTimeout(id)
    }
  }, [verified, navigate])

  // Resend countdown + mutation wiring.
  const resendMutation = useResendVerification()
  const countdown = useResendCountdown()
  const [resendErrorMessage, setResendErrorMessage] = useState<string | null>(
    null,
  )

  const handleResend = () => {
    if (countdown.isActive) return
    if (!userEmail) {
      setResendErrorMessage(t('auth.verify.error.generic'))
      return
    }
    setResendErrorMessage(null)
    resendMutation.mutate(
      { email: userEmail },
      {
        onSuccess: (data) => {
          countdown.start(RESEND_COUNTDOWN_SECONDS)
          toast.success(t('auth.verify.resendSentToast'))
          if (data.verifyPollId !== null) {
            // Preserve any other URL params (`?utm_*`, future
            // `?lang=`, etc.) — fresh `new URLSearchParams()` would
            // drop them. The callback form of setSearchParams reads
            // the live params, not a stale capture.
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                next.set('pollId', data.verifyPollId!)
                return next
              },
              { replace: true },
            )
            // Re-arm the polling window since a fresh pollId was issued.
            startedAtRef.current = Date.now()
            setTimeoutHit(false)
            setPollerEnabled(true)
          }
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429) {
            // useResendCountdown clamps internally to MAX_COUNTDOWN_SECONDS
            // (300). To avoid the "wait 600s, button re-enables at 300s"
            // lie, show the clamped value in the alert so the message
            // and button-enable timing line up. If the backend wanted
            // longer, a re-fire will hit 429 again with fresh seconds.
            const requested =
              err.retryAfterSeconds ?? RESEND_COUNTDOWN_SECONDS
            const clamped = Math.min(MAX_COUNTDOWN_SECONDS, requested)
            countdown.start(clamped)
            setResendErrorMessage(
              t('auth.verify.error.rateLimited', { seconds: clamped }),
            )
            return
          }
          setResendErrorMessage(t('auth.verify.error.generic'))
        },
      },
    )
  }

  const handleManualRecheck = () => {
    // Fire SINGLE GET — do NOT re-arm the interval. The poller stays
    // disabled (pollerEnabled stays false). Response handling routes
    // through the same useVerificationPoller state-commit branches:
    // verified-true → triggers the redirect effect; 404 → terminal
    // 'expired' state renders the inline alert; verified-false → no
    // state change, the timeout UI stays put.
    void rerunOnce()
  }

  // Build the polling-mode body. Render order:
  //   envelope SVG → heading → bold email → bodySuffix → spam hint
  //   → resend button → typo-escape (if email known) → google fallback.
  const heading = (
    <h1
      className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
      data-testid="verify-heading"
    >
      {timeoutHit && !expired
        ? t('auth.verify.timeoutHeading')
        : expired
          ? t('auth.verify.expiredHeading')
          : t('auth.verify.title')}
    </h1>
  )

  const regionLabel = useMemo(() => {
    if (expired) return t('auth.verify.expiredHeading')
    if (timeoutHit) return t('auth.verify.timeoutHeading')
    return t('auth.verify.title')
  }, [expired, timeoutHit, t])

  if (verified) {
    // Verified state — minimal heading + the aria-live announcement.
    return (
      <AuthCard
        regionLabel={t('auth.verify.title')}
        heading={heading}
        body={
          <div className="grid gap-3 text-center">
            <p
              data-testid="verify-success-redirecting"
              aria-live="polite"
              className="text-sm text-[var(--cl-ink)]"
            >
              {t('auth.verify.successRedirecting')}
            </p>
          </div>
        }
      />
    )
  }

  if (expired) {
    return (
      <AuthCard
        regionLabel={regionLabel}
        heading={heading}
        body={
          <ExpiredState
            onResendClick={() => handleResend()}
            showResendCta={true}
            t={t}
          />
        }
        footer={
          <Link
            to="/login"
            className="text-[var(--cl-accent)] underline"
            data-testid="verify-expired-login-link"
          >
            {t('auth.login.title')}
          </Link>
        }
      />
    )
  }

  // Normal polling body (also reused for the timeout state — only the
  // CTA copy + behavior differ).
  return (
    <AuthCard
      regionLabel={regionLabel}
      heading={heading}
      body={
        <div
          data-testid={timeoutHit ? 'verify-timeout' : 'verify-polling'}
          className="grid gap-4 text-center"
        >
          <div className="flex justify-center">{ENVELOPE_SVG}</div>

          {timeoutHit ? (
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.verify.timeoutBody')}
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--cl-ink-soft)]">
                {t('auth.verify.bodyPrefix')}
                {userEmail ? (
                  <>
                    {' '}
                    <span
                      data-testid="verify-email-display"
                      className="break-all font-semibold text-[var(--cl-ink)]"
                    >
                      {userEmail}
                    </span>
                    .
                  </>
                ) : (
                  '.'
                )}
              </p>
              <p className="text-sm text-[var(--cl-ink-soft)]">
                {t('auth.verify.bodySuffix')}
              </p>
              <p
                data-testid="verify-spam-hint"
                className="text-sm text-[var(--cl-ink-muted)]"
              >
                {t('auth.verify.spamHint')}
              </p>
            </>
          )}

          {resendErrorMessage && (
            <div
              role="alert"
              data-testid="verify-resend-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {resendErrorMessage}
            </div>
          )}

          {/*
            Spec AC5 line 186: the resend button stays visible in the
            timeout state (still subject to its 60s countdown). The
            recheck button is the primary CTA after timeout; the resend
            button is a secondary affordance for users who suspect the
            email didn't arrive at all.
          */}
          {timeoutHit && (
            <Button
              type="button"
              variant="default"
              data-testid="verify-recheck-button"
              onClick={handleManualRecheck}
            >
              {t('auth.verify.recheckCta')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            data-testid="verify-resend-button"
            disabled={countdown.isActive || resendMutation.isPending}
            onClick={() => handleResend()}
          >
            {countdown.isActive
              ? t('auth.verify.resendCountdown', {
                  seconds: countdown.remaining,
                })
              : t('auth.verify.resendCta')}
          </Button>

          {userEmail && (
            <p data-testid="verify-wrong-email" className="text-sm">
              {t('auth.verify.wrongEmailPrompt', { email: userEmail })}{' '}
              <Link
                to="/register"
                data-testid="verify-wrong-email-link"
                state={{ prefillEmail: userEmail }}
                className="text-[var(--cl-accent)] underline"
              >
                {t('auth.verify.wrongEmailCta')}
              </Link>
            </p>
          )}

          <div className="grid gap-2 border-t pt-4">
            <p
              data-testid="verify-google-fallback-prompt"
              className="text-sm text-[var(--cl-ink-soft)]"
            >
              {t('auth.verify.googleFallbackPrompt')}
            </p>
            <a
              href="/api/auth/google"
              data-testid="verify-google-fallback-link"
              className="text-sm text-[var(--cl-accent)] underline"
            >
              {t('auth.verify.googleFallbackCta', {
                email: userEmail ?? '',
              })}
            </a>
          </div>
        </div>
      }
    />
  )
}

interface ExpiredStateProps {
  onResendClick: (() => void) | null
  showResendCta: boolean
  t: ReturnType<typeof useTranslation>['t']
}

function ExpiredState({ onResendClick, showResendCta, t }: ExpiredStateProps) {
  return (
    <div
      data-testid="verify-expired"
      className="grid gap-4 text-center"
    >
      <div className="flex justify-center">{CLOCK_SVG}</div>
      <p className="text-sm text-[var(--cl-ink-soft)]">
        {t('auth.verify.expiredBody')}
      </p>
      {showResendCta && onResendClick && (
        <Button
          type="button"
          variant="default"
          data-testid="verify-expired-resend"
          onClick={onResendClick}
        >
          {t('auth.verify.expiredResendCta')}
        </Button>
      )}
    </div>
  )
}
