/**
 * LoginPage — Story 1-8 AC4 + Story 1-9a / 1-9b / 1-9c banner stack +
 * Story 1-9d AC1-AC4 mode machine (lockout / oauthMismatch /
 * workspaceBlocked / session-expired).
 *
 * Layout per UX-DR6 + UX-DR7 + UX-DR16/DR18/DR20:
 *
 *   AuthCard
 *   ├─ heading
 *   └─ body — switches on `mode`:
 *       - 'default'         : GoogleOAuthButton + Banner slot + form
 *       - 'lockout'         : LockoutState ABOVE GoogleOAuthButton; form UNMOUNTED
 *       - 'oauthMismatch'   : OAuthMismatchState REPLACES form region
 *       - 'workspaceBlocked': WorkspaceBlockedState REPLACES form region
 *
 * Mode-derive contract (Amelia A2 BLOCKER pin — 1-9d):
 *   - `useLockoutCountdown(lockoutUntilMs).isActive` drives the lockout
 *     branch — NOT raw `lockoutUntilMs` — so the form restores on the
 *     SAME tick that crosses the target with no searchParams change.
 *   - URL params drive the other branches and the session-expired banner.
 *
 * Post-login navigation (Winston W1 / Amelia A1 BLOCKER three-site
 * convergence — 1-9d):
 *   1. password-submit  → per-call `onSuccess` reads sanitized `?next=`
 *   2. already-auth     → effect reads sanitized `?next=`
 *   3. Google OAuth     → top-level navigation; backend bounces to
 *      APP_POST_LOGIN_URL; index loader forwards search → site (2)
 *
 * The `useLogin` hook is destination-agnostic (cache + broadcast only);
 * this page owns the navigate(...) call.
 *
 * Session-expired branch (Story 1-9d AC4):
 *   - `?session_expired=1` mounts the warning banner alongside the form.
 *   - Cookie clear (`logged_in=`) is driven by a mount-time useRef snapshot
 *     of the param (Amelia A3 pin) so it survives StrictMode pass 2 after
 *     the URL-clear strips the param. Idempotent via cookieClearedRef.
 *   - `?next=` is PRESERVED by the URL-clear effect (Amelia A6 pin) so the
 *     post-login navigate can consume it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import AuthCard from '@/features/auth/components/AuthCard'
import Banner from '@/features/auth/components/Banner'
import CollapsibleEmailForm from '@/features/auth/components/CollapsibleEmailForm'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'
import LockoutState from '@/features/auth/components/LockoutState'
import OAuthMismatchState from '@/features/auth/components/OAuthMismatchState'
import PasswordInput from '@/features/auth/components/PasswordInput'
import WorkspaceBlockedState, {
  type WorkspaceBlockedReason,
} from '@/features/auth/components/WorkspaceBlockedState'
import { useLogin } from '@/features/auth/api/login'
import { useLoginSchema, type LoginFormValues } from '@/features/auth/lib/loginSchema'
import { authKeys } from '@/features/auth/api/authKeys'
import { useLockoutCountdown } from '@/features/auth/hooks/useLockoutCountdown'
import {
  readLockoutUntilMs,
  writeLockoutUntilMs,
} from '@/features/auth/lib/lockoutStorage'
import { sanitizeNextParam } from '@/features/auth/lib/sanitizeNextParam'
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/lib/api-fetch'

type BannerKey =
  | 'session-expired'
  | 'invited'
  | 'reset'
  | 'verified'
  | 'oauth-error'
  | null

type LoginPageMode = 'default' | 'lockout' | 'oauthMismatch' | 'workspaceBlocked'

/**
 * Single source of truth for the banner priority.
 *
 * Priority (Story 1-9d): `session-expired > invited > reset > verified > oauth-error`.
 *  - `session-expired` wins because it's the highest-urgency signal — the
 *    user thought they were authenticated and isn't. Without the explicit
 *    acknowledgment, the bare login form reads as "did I get logged out?"
 *  - `invited` over reset/verified because it's the highest-value
 *    conversion node (UX-DR10).
 *  - `reset` over `verified`: a fresh password reset's "all other devices
 *    signed out" copy is more urgent than a verify-success acknowledgment.
 */
function deriveBannerKey(searchParams: URLSearchParams): BannerKey {
  if (searchParams.get('session_expired') === '1') return 'session-expired'
  if (searchParams.get('invited') === 'true') return 'invited'
  if (searchParams.get('reset') === '1') return 'reset'
  if (searchParams.get('verified') === '1') return 'verified'
  if (searchParams.get('error') !== null) return 'oauth-error'
  return null
}

/**
 * Mode-derive pure selector (Amelia A2 BLOCKER pin — Story 1-9d).
 *
 * `countdownIsActive` is the input — NOT raw `lockoutUntilMs`. The hook
 * owns `isActive` as a `useState<boolean>` that flips on the expiry tick,
 * so this selector reads the current authoritative value at every render.
 */
function deriveReplacement(
  searchParams: URLSearchParams,
):
  | { kind: 'oauthMismatch' }
  | { kind: 'workspaceBlocked'; reason: WorkspaceBlockedReason }
  | null {
  // Invited > oauth-error priority (1-9c Winston pin): an invited landing
  // suppresses mode replacement so the success banner reads cleanly.
  if (searchParams.get('invited') === 'true') return null
  const error = searchParams.get('error')
  if (error === 'invite_email_mismatch') return { kind: 'oauthMismatch' }
  if (error === 'google_userinfo_failed' || error === 'google_email_unverified') {
    return { kind: 'workspaceBlocked', reason: error }
  }
  return null
}

const CHECKMARK_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    className="size-4 shrink-0"
  >
    <path
      d="M3 8.5 L6.5 12 L13 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const CLOCK_BANNER_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    className="size-4 shrink-0"
  >
    <circle
      cx="8"
      cy="8"
      r="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8 4 L8 8 L11 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

/**
 * Backend lockout window (matches `service/auth.go:53-55` LoginLockoutDuration).
 * Winston W5 pin — using 600s would cause a 5-min UI/backend mismatch where
 * the user submits at minute 10 and gets re-locked.
 */
const LOCKOUT_FALLBACK_SECONDS = 900

export default function LoginPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated, isLoading } = useAuth()
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  // Form-level error displayed in <div role="alert"> beneath the
  // submit button. Per-field errors flow through RHF setError +
  // FormMessage. Banner signals (OAuth error / verified / reset / etc.)
  // live in a SEPARATE slot above the email form via `bannerKey`. The
  // 429 ACCOUNT_LOCKED branch flows through `lockoutUntilMs` →
  // useLockoutCountdown → mode='lockout', NOT this form-error slot.
  const [formError, setFormError] = useState<string | null>(null)

  // Lockout state — rehydrate from localStorage on mount (envelope shape
  // self-clears any poisoned / past value). Subsequent renders source
  // from this useState (updated by writeLockoutUntilMs on 429).
  const [lockoutUntilMs, setLockoutUntilMs] = useState<number | null>(() =>
    readLockoutUntilMs(),
  )
  const countdown = useLockoutCountdown(lockoutUntilMs)

  // Latched mode-replacement state. Initialized from the URL on first render;
  // PERSISTS across the URL-clear effect (which drops `?error=` to prevent
  // refresh re-triggering the screen). The user lands on the recovery
  // surface, the URL goes clean, and the screen stays until they take action.
  //
  // The lockout branch re-derives from `countdown.isActive` on EVERY render
  // (Amelia A2 BLOCKER pin — same-tick form-restore on expiry without a
  // searchParams change). The other branches latch.
  const [latchedReplacement, setLatchedReplacement] = useState<
    | { kind: 'oauthMismatch' }
    | { kind: 'workspaceBlocked'; reason: WorkspaceBlockedReason }
    | null
  >(() => deriveReplacement(searchParams))

  // Re-derive on searchParams change so a SPA-nav back to a mismatch URL
  // re-enters the screen even after the prior URL-clear. Same shape as the
  // bannerKey re-derive effect — URL is an external input that changes
  // outside React's render cycle on SPA navigation.
  useEffect(() => {
    const next = deriveReplacement(searchParams)
    if (next === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatchedReplacement((prev) => {
      if (prev?.kind === next.kind) {
        if (
          prev.kind === 'workspaceBlocked' &&
          next.kind === 'workspaceBlocked' &&
          prev.reason === next.reason
        ) {
          return prev
        }
        if (prev.kind === 'oauthMismatch') return prev
      }
      return next
    })
  }, [searchParams])

  const mode: LoginPageMode = countdown.isActive
    ? 'lockout'
    : latchedReplacement
      ? latchedReplacement.kind
      : 'default'

  // Single derived banner state — replaces the prior 1-8 oauthError +
  // 1-9a verifiedBanner pair. The lazy initializer paints the right
  // variant on the FIRST render without a flash; the [searchParams]
  // effect below handles re-derivations on same-page SPA navigation.
  const [bannerKey, setBannerKey] = useState<BannerKey>(() =>
    deriveBannerKey(searchParams),
  )

  // Session-cache wipe on `?reset=1` — sibling tabs may still hold a
  // stale in-memory session from before the reset. wipedRef makes this
  // idempotent under StrictMode + signal re-renders.
  const wipedRef = useRef(false)
  useEffect(() => {
    if (bannerKey !== 'reset') return
    if (wipedRef.current) return
    wipedRef.current = true
    queryClient.removeQueries({ queryKey: authKeys.session() })
  }, [bannerKey, queryClient])

  // Re-derive banner state when searchParams change AFTER initial mount.
  // Updates whenever the derived key DIFFERS from current — including
  // a higher-priority signal arriving after the URL was cleared
  // ([Review][Decision] D3 — escalation lets oauth-error replace a
  // sticky reset banner). When `next` matches the current `bannerKey`,
  // the effect short-circuits, preserving the sticky-once-shown contract.
  useEffect(() => {
    const next = deriveBannerKey(searchParams)
    if (next === bannerKey) return
    if (next === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBannerKey(next)
  }, [searchParams, bannerKey])

  // Defensive logged_in= cookie clear on session-expired branch
  // (Story 1-9d AC4 / Amelia A3 pin). Driven by a mount-time useRef
  // snapshot of `searchParams.get('session_expired')` — NOT live
  // `bannerKey`, which becomes `null` after the URL-clear strips the
  // param. Mirrors 1-9b's wipedRef shape. Forward-compat for Story 1.10's
  // hint cookie; current no-op given backend doesn't set the cookie.
  const sessionExpiredOnMountRef = useRef<boolean>(
    searchParams.get('session_expired') === '1',
  )
  const cookieClearedRef = useRef(false)
  useEffect(() => {
    if (!sessionExpiredOnMountRef.current) return
    if (cookieClearedRef.current) return
    cookieClearedRef.current = true
    document.cookie =
      'logged_in=; Max-Age=0; Domain=.classlite.app; Path=/; SameSite=Strict'
  }, [])

  const schema = useLoginSchema()
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', rememberMe: false },
    mode: 'onBlur',
  })
  const login = useLogin()
  const isPending = login.isPending

  // Already-authenticated guard (Story 1-9a Layer A + Story 1-9d AC4
  // next= consumer). Reads `?next=` via the sanitizer so the boot-probe
  // hydrate path AND sibling-tab broadcast path BOTH route to the same
  // user-intended destination. The isLoading guard short-circuits during
  // boot-probe so a returning user doesn't get bounced to the form for
  // an instant before hydrating.
  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      navigate(sanitizeNextParam(searchParams.get('next')), { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate, searchParams])

  // URL-clear effect — drops banner-signal params on mount but PRESERVES
  // `next=` (Amelia A6 pin — the post-login consumer reads `next` AT
  // navigation time, after this clear has fired). Builds the next
  // URLSearchParams by deleting the drop-list keys explicitly, NOT by
  // replacing the entire param set.
  useEffect(() => {
    if (isAuthenticated) return
    const hasError = searchParams.get('error') !== null
    const hasVerified = searchParams.get('verified') !== null
    const hasReset = searchParams.get('reset') !== null
    const hasInvited = searchParams.get('invited') !== null
    const hasSessionExpired = searchParams.get('session_expired') !== null
    if (
      !hasError &&
      !hasVerified &&
      !hasReset &&
      !hasInvited &&
      !hasSessionExpired
    ) {
      return
    }
    const next = new URLSearchParams(searchParams)
    next.delete('error')
    next.delete('verified')
    next.delete('reset')
    next.delete('invited')
    next.delete('session_expired')
    // `next=` is intentionally preserved.
    setSearchParams(next, { replace: true })
  }, [isAuthenticated, searchParams, setSearchParams])

  const onSubmit = (values: LoginFormValues) => {
    if (isPending) return
    setFormError(null)
    // Clear the banner once the user starts submitting credentials —
    // the in-flight outcome supersedes any prior reset/verified/error
    // landing alert.
    setBannerKey(null)
    login.mutate(values, {
      onSuccess: () => {
        navigate(sanitizeNextParam(searchParams.get('next')), {
          replace: true,
        })
      },
      onError: (error) => {
        if (!(error instanceof ApiError)) {
          setFormError(t('auth.login.error.generic'))
          return
        }
        if (error.status === 401 && error.code === 'INVALID_CREDENTIALS') {
          setFormError(t('auth.login.error.invalidCredentials'))
          return
        }
        if (error.status === 429 && error.code === 'ACCOUNT_LOCKED') {
          // Mode replacement supersedes the form-error rendering. Persist
          // lockoutUntilMs to localStorage + local state; useLockoutCountdown
          // flips isActive=true; mode flips to 'lockout'; the form unmounts.
          const seconds = error.retryAfterSeconds ?? LOCKOUT_FALLBACK_SECONDS
          const target = Date.now() + seconds * 1000
          writeLockoutUntilMs(target)
          setLockoutUntilMs(target)
          return
        }
        if (error.status === 429 && error.code === 'RATE_LIMIT_EXCEEDED') {
          setFormError(t('auth.login.error.rateLimited'))
          return
        }
        setFormError(t('auth.login.error.generic'))
      },
    })
  }

  const googleLabel = useMemo(() => t('auth.login.googleCta'), [t])

  return (
    <AuthCard
      regionLabel={t('auth.login.title')}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
          data-testid="login-heading"
        >
          {t('auth.login.title')}
        </h1>
      }
      body={
        <div className="grid gap-4">
          {mode === 'lockout' && (
            <>
              <LockoutState
                remainingSeconds={countdown.remainingSeconds}
                formatted={countdown.formatted}
              />
              <GoogleOAuthButton label={googleLabel} disabled={isPending} />
            </>
          )}

          {mode === 'oauthMismatch' && <OAuthMismatchState />}

          {mode === 'workspaceBlocked' &&
            latchedReplacement?.kind === 'workspaceBlocked' && (
              <WorkspaceBlockedState reason={latchedReplacement.reason} />
            )}

          {mode === 'default' && (
            <>
              <GoogleOAuthButton label={googleLabel} disabled={isPending} />

              {!isAuthenticated &&
                bannerKey === 'session-expired' &&
                !emailFormOpen && (
                  <Banner
                    variant="session-expired"
                    message={t('auth.login.banner.sessionExpired')}
                    icon={CLOCK_BANNER_SVG}
                  />
                )}

              {!isAuthenticated &&
                bannerKey === 'session-expired' &&
                !emailFormOpen && (
                  <p
                    data-testid="login-session-expired-data-loss"
                    className="text-xs text-muted-foreground"
                  >
                    {t('auth.login.banner.sessionExpiredDataLossHint')}
                  </p>
                )}

              {!isAuthenticated &&
                bannerKey === 'invited' &&
                !emailFormOpen && (
                  <Banner
                    variant="invited"
                    message={t('auth.login.banner.invited')}
                    icon={CHECKMARK_SVG}
                  />
                )}

              {!isAuthenticated && bannerKey === 'reset' && !emailFormOpen && (
                <Banner
                  variant="reset"
                  message={t('auth.login.banner.reset')}
                  icon={CHECKMARK_SVG}
                />
              )}

              {!isAuthenticated &&
                bannerKey === 'verified' &&
                !emailFormOpen && (
                  <Banner
                    variant="verified"
                    message={t('auth.login.banner.verified')}
                  />
                )}

              {!isAuthenticated &&
                bannerKey === 'oauth-error' &&
                !emailFormOpen && (
                  <Banner
                    variant="oauth-error"
                    message={t('auth.login.error.oauthGeneric')}
                    testId="login-form-error"
                  />
                )}

              {emailFormOpen && (
                <div
                  className="relative flex items-center"
                  data-testid="email-form-divider"
                >
                  <Separator className="flex-1" />
                  <span className="px-3 text-xs uppercase text-muted-foreground">
                    {t('auth.common.dividerOr')}
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}

              <CollapsibleEmailForm
                open={emailFormOpen}
                onOpenChange={setEmailFormOpen}
                triggerLabel={t('auth.login.emailCollapse')}
              >
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    noValidate
                    className="grid gap-3"
                    data-testid="login-form"
                  >
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth.common.email')}</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              autoComplete="email"
                              inputMode="email"
                              placeholder={t('auth.common.emailPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth.common.password')}</FormLabel>
                          <FormControl>
                            <PasswordInput
                              autoComplete="current-password"
                              placeholder={t(
                                'auth.common.loginPasswordPlaceholder',
                              )}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex items-center justify-between">
                      <FormField
                        control={form.control}
                        name="rememberMe"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center gap-2">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) =>
                                  field.onChange(checked === true)
                                }
                              />
                            </FormControl>
                            <FormLabel className="text-sm font-normal">
                              {t('auth.login.rememberMe')}
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                      <a
                        href="/forgot-password"
                        className="text-sm text-[var(--cl-accent)] underline"
                        data-testid="forgot-password-link"
                      >
                        {t('auth.login.forgotPassword')}
                      </a>
                    </div>

                    {formError && (
                      <div
                        role="alert"
                        data-testid="login-form-error"
                        className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                      >
                        {formError}
                      </div>
                    )}

                    <Button
                      type="submit"
                      size="lg"
                      className="h-12 w-full"
                      disabled={isPending}
                      data-testid="login-submit"
                    >
                      {t('auth.login.submit')}
                    </Button>
                  </form>
                </Form>
              </CollapsibleEmailForm>
            </>
          )}
        </div>
      }
      footer={
        <a
          href="/register"
          className="text-[var(--cl-accent)] underline"
          data-testid="login-signup-link"
        >
          {t('auth.login.signUpLink')}
        </a>
      }
    />
  )
}
