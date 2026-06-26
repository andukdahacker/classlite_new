/**
 * LoginPage — Story 1-8 AC4 + Story 1-9a banner + Story 1-9b banner refactor.
 *
 * Layout per UX-DR6 + UX-DR7:
 *
 *   AuthCard
 *   ├─ heading: <h1>{t('auth.login.title')}</h1>
 *   ├─ body
 *   │   ├─ GoogleOAuthButton (dominant, full width, no chrome above)
 *   │   ├─ Banner slot — ONE `<div role="alert">` driven by the derived
 *   │   │   `bannerKey` selector. Variants: 'reset' (success +
 *   │   │   checkmark), 'verified' (success), 'oauth-error' (destructive).
 *   │   ├─ Divider with "or" — visible ONLY when the email form is expanded.
 *   │   ├─ CollapsibleEmailForm
 *   │   │   └─ Email + PasswordInput + (RememberMe | ForgotPassword) + Submit
 *   │   └─ form-level <div role="alert"> for 401 / 429 / generic errors
 *   └─ footer: signup link
 *
 * Banner coordination (Story 1-9b Winston + Amelia convergence 2026-06-26):
 * Replaces the three competing `useState` slots (1-8 oauthError + 1-9a
 * verifiedBanner + the planned 1-9b resetBanner) with ONE
 * `bannerKey: 'reset' | 'verified' | 'oauth-error' | null` derived state.
 * Priority: `reset > verified > oauth-error`. The single `bannerSignalHandled`
 * idempotent URL-clear effect drops all three query params atomically. This
 * is scaffolding for the 1-9d `useLoginBanner(searchParams) → LoginBannerSignal`
 * discriminated-union hook refactor (pre-work mandate per 1-9b spec).
 *
 * Reset variant carries server-side semantics: backend invalidates ALL
 * refresh tokens on successful reset, so the copy ("we signed out your
 * other devices") explains the sibling-tab auto-logout. The lazy
 * initializer wipes the session cache synchronously on `?reset=1` mount
 * so a stale in-memory session from a sibling tab cannot flash through.
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
import CollapsibleEmailForm from '@/features/auth/components/CollapsibleEmailForm'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'
import PasswordInput from '@/features/auth/components/PasswordInput'
import { useLogin } from '@/features/auth/api/login'
import { useLoginSchema, type LoginFormValues } from '@/features/auth/lib/loginSchema'
import { authKeys } from '@/features/auth/api/authKeys'
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/lib/api-fetch'

type BannerKey = 'reset' | 'verified' | 'oauth-error' | null

/**
 * Single source of truth for the banner priority. Pure — easy to unit
 * test independently of the LoginPage render tree.
 *
 * Priority: reset > verified > oauth-error. Picking reset over verified
 * is intentional — if a user just reset their password AND happened to
 * land via a verify-success redirect, the "all other devices signed out"
 * copy is the load-bearing message.
 */
function deriveBannerKey(searchParams: URLSearchParams): BannerKey {
  if (searchParams.get('reset') === '1') return 'reset'
  if (searchParams.get('verified') === '1') return 'verified'
  if (searchParams.get('error') !== null) return 'oauth-error'
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

const SECONDS_PER_MINUTE = 60

export default function LoginPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated, isLoading } = useAuth()
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  // Form-level error displayed in <div role="alert"> beneath the
  // submit button. Per-field errors flow through RHF setError +
  // FormMessage. Banner signals (OAuth error / verified / reset) live
  // in a SEPARATE slot above the email form via `bannerKey`.
  const [formError, setFormError] = useState<string | null>(null)

  // Single derived banner state — replaces the prior 1-8 oauthError +
  // 1-9a verifiedBanner pair. The lazy initializer paints the right
  // variant on the FIRST render without a flash; the [searchParams]
  // effect below handles re-derivations on same-page SPA navigation.
  const [bannerKey, setBannerKey] = useState<BannerKey>(() =>
    deriveBannerKey(searchParams),
  )

  // Session-cache wipe on `?reset=1` — sibling tabs may still hold a
  // stale in-memory session from before the reset; the wipe forces a
  // re-fetch (which 401s and routes the user back to login, the
  // intended UX). The "stale sibling-tab" is the design scenario:
  // even when `useAuth()` reports `isAuthenticated: true` from the
  // cached LoginResult, the refresh token is dead server-side, so
  // wiping is the correct UX regardless of the cached auth state.
  //
  // Moved out of the useState lazy initializer to keep render pure —
  // side effects in initializers are a Concurrent-React anti-pattern
  // ([Review][Patch] P3 — code-review 2026-06-26). `wipedRef` makes
  // the wipe idempotent under StrictMode + signal re-renders.
  // [Review][Patch] P4 was reverted — the `!isAuthenticated` guard
  // looked safer but broke the exact stale-sibling-tab scenario the
  // wipe was designed for; the rare "signed-in user manually visits
  // /login?reset=1" case lands on /dashboard via the next refresh
  // attempt, an acceptable UX trade.
  const wipedRef = useRef(false)
  useEffect(() => {
    if (bannerKey !== 'reset') return
    if (wipedRef.current) return
    wipedRef.current = true
    queryClient.removeQueries({ queryKey: authKeys.session() })
  }, [bannerKey, queryClient])

  // Re-derive banner state when searchParams change AFTER initial mount
  // — e.g. same-page SPA navigation back to /login?reset=1 after the
  // user already landed and the params were cleared.
  //
  // Updates whenever the derived key DIFFERS from current — including
  // a higher-priority signal arriving after the URL was cleared
  // ([Review][Decision] D3 — escalation lets oauth-error replace a
  // sticky reset banner). When `next` matches the current `bannerKey`,
  // the effect short-circuits, preserving the sticky-once-shown
  // contract from 1-9a.
  //
  // set-state-in-effect is justified: the URL is an external input
  // that changes outside React's render cycle on SPA navigation; the
  // bannerKey is the React projection of that URL state at any moment.
  useEffect(() => {
    const next = deriveBannerKey(searchParams)
    if (next === bannerKey) return
    if (next === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBannerKey(next)
  }, [searchParams, bannerKey])

  const schema = useLoginSchema()
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', rememberMe: false },
    mode: 'onBlur',
  })
  const login = useLogin()
  const isPending = login.isPending

  // Story 1-9a Layer A — already-authenticated guard. A user landing
  // on `/login` (with OR without ?verified=1) who is already signed in
  // (via this tab, a sibling-tab broadcast, or a still-valid refresh
  // cookie that the boot-probe just hydrated) goes straight to
  // /dashboard with replace:true. The isLoading guard short-circuits
  // the effect during the boot-probe so a returning user doesn't get
  // bounced to the form for an instant before hydrating.
  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  // `bannerSignalHandled` — the URL-clear effect doubles as the
  // signal-handled-once latch. The presence-check on the three banner
  // params + the conditional `setSearchParams` is idempotent: the
  // effect re-fires on the next searchParams change after the clear
  // lands but short-circuits at the guard. Same ref-latch shape as 1-8
  // (the `oauthErrorHandled` lazy initializer); renamed per Winston so
  // a future fourth signal (1-9d session-expired) reads honestly.
  useEffect(() => {
    if (isAuthenticated) return
    const hasError = searchParams.get('error') !== null
    const hasVerified = searchParams.get('verified') !== null
    const hasReset = searchParams.get('reset') !== null
    if (!hasError && !hasVerified && !hasReset) return
    const next = new URLSearchParams(searchParams)
    next.delete('error')
    next.delete('verified')
    next.delete('reset')
    setSearchParams(next, { replace: true })
  }, [isAuthenticated, searchParams, setSearchParams])

  const onSubmit = (values: LoginFormValues) => {
    // (P6 amendment 2026-06-25) Enter key while pending bypasses the
    // submit button's `disabled` and re-fires handleSubmit; without
    // this guard, a slow network + impatient user could double-submit
    // and pad the lockout counter.
    if (isPending) return
    setFormError(null)
    // Clear the banner once the user starts submitting credentials —
    // the in-flight outcome supersedes any prior reset/verified/error
    // landing alert.
    setBannerKey(null)
    login.mutate(values, {
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
          const minutes = Math.ceil(
            (error.retryAfterSeconds ?? 0) / SECONDS_PER_MINUTE,
          )
          setFormError(t('auth.login.error.accountLocked', { minutes }))
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

  // Compose pinned-test contract: isPending → both Google + Submit
  // disabled; isError → form-level Alert renders; isSuccess → navigation
  // fires inside the mutation hook.
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
          <GoogleOAuthButton label={googleLabel} disabled={isPending} />

          {!isAuthenticated && bannerKey === 'reset' && !emailFormOpen && (
            <div
              role="alert"
              data-testid="login-form-banner"
              className="flex items-start gap-2 rounded-md border border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 p-3 text-sm text-[color:var(--cl-status-success)]"
            >
              {CHECKMARK_SVG}
              <span>{t('auth.login.banner.reset')}</span>
            </div>
          )}

          {!isAuthenticated && bannerKey === 'verified' && !emailFormOpen && (
            <div
              role="alert"
              data-testid="login-form-banner"
              className="rounded-md border border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 p-3 text-sm text-[color:var(--cl-status-success)]"
            >
              {t('auth.login.banner.verified')}
            </div>
          )}

          {!isAuthenticated &&
            bannerKey === 'oauth-error' &&
            !emailFormOpen && (
              <div
                role="alert"
                data-testid="login-form-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {t('auth.login.error.oauthGeneric')}
              </div>
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
