/**
 * LoginPage — Story 1-8 AC4.
 *
 * Replaces `LoginPagePlaceholder.tsx` (deleted in the same commit). The
 * H1 contract `t('auth.login.title')` is preserved verbatim so the
 * 1-7c bilingual smoke spec stays green.
 *
 * Layout per UX-DR6 + UX-DR7:
 *
 *   AuthCard
 *   ├─ heading: <h1>{t('auth.login.title')}</h1>
 *   ├─ body
 *   │   ├─ GoogleOAuthButton (dominant, full width, no chrome above)
 *   │   ├─ Divider with "or" — visible ONLY when the email form is
 *   │   │   expanded (Sally amendment: matches AUTH-03 mockup exactly)
 *   │   ├─ CollapsibleEmailForm
 *   │   │   └─ Email + PasswordInput + (RememberMe | ForgotPassword) + Submit
 *   │   └─ form-level <div role="alert"> for 401 / 429 / generic /
 *   │       oauthGeneric errors (the OAuth transient bridge between 1-8
 *   │       and 1.9d uses the same slot)
 *   └─ footer: signup link
 *
 * Thumb-zone exception (Sally amendment): the Google button at the top
 * intentionally violates UX-DR15's "primary CTA in bottom third"
 * heuristic — Google-first dominance (UX-DR6) outranks thumb-zone per
 * § 10.3 "one action per screen" hierarchy.
 *
 * rememberMe default `false` documented deviation from AUTH-03 mockup
 * (security-first for shared-phone Vietnamese students; pin in JSDoc so
 * a future "fix to match mockup" PR has paper trail).
 *
 * OAuth transient bridge (D3 amendment 2026-06-25 — was originally a
 * `sonner` toast which silently downgraded the recovery affordance and
 * left the pinned test tautological): `/api/auth/google/callback`
 * 302s to `/login?error=<code>` on failure. Until Story 1.9d ships the
 * polished per-code decoder, surface a generic destructive alert IN the
 * form-level error slot + clear the query param so a refresh doesn't
 * re-trigger.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
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
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/lib/api-fetch'

const SECONDS_PER_MINUTE = 60

export default function LoginPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading } = useAuth()
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  // Form-level error displayed in an <div role="alert"> beneath the
  // submit button. Per-field errors flow through RHF setError +
  // FormMessage. OAuth transient errors share the same visual slot.
  const [formError, setFormError] = useState<string | null>(null)
  // OAuth transient is initialized via the lazy initializer (P12
  // amendment 2026-06-25) so the banner paints in the FIRST render
  // without a flash. A follow-up effect below (`[searchParams]`)
  // re-derives the banner if a same-page SPA navigation lands new
  // params on the SAME component instance — without it, the lazy
  // initializer only fires once at mount and a subsequent
  // /login?error=... visit would silently drop the alert.
  const [oauthError, setOauthError] = useState<string | null>(() =>
    searchParams.get('error')
      ? t('auth.login.error.oauthGeneric')
      : null,
  )
  // Story 1-9a Layer A — `/login?verified=1` lands here from the
  // verify-email redirect. The success banner shares the SAME form-level
  // <div role="alert"> slot as the OAuth transient error; success wins
  // on collision per the AC6 priority contract.
  const [verifiedBanner, setVerifiedBanner] = useState<string | null>(() =>
    searchParams.get('verified') === '1'
      ? t('auth.login.banner.verified')
      : null,
  )

  // Re-derive banner state when searchParams change AFTER initial
  // mount (e.g. same-page SPA navigation back to /login?error=...
  // after the user already landed and the params were cleared). The
  // lazy initializer above handles the first paint; this effect handles
  // re-entries. Calling setState with the same value is a React no-op,
  // so the initial-mount run is harmless.
  //
  // set-state-in-effect is justified: the URL is the external input
  // (the URL changes from outside React's render cycle on SPA
  // navigation); the banner state is the React projection of that URL
  // state at any point in time. useMemo cannot subscribe to the
  // searchParams object's identity for an externally-triggered route
  // change; an effect is the correct synchronization primitive.
  useEffect(() => {
    if (searchParams.get('error') !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOauthError(t('auth.login.error.oauthGeneric'))
    }
    if (searchParams.get('verified') === '1') {
      setVerifiedBanner(t('auth.login.banner.verified'))
    }
  }, [searchParams, t])

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

  useEffect(() => {
    // If the Layer A guard is about to redirect away (already
    // authenticated), skip the URL clear entirely — the navigate to
    // /dashboard supersedes /login?... so a racing setSearchParams
    // here would clobber that redirect.
    if (isAuthenticated) return
    const hasError = searchParams.get('error') !== null
    const hasVerified = searchParams.get('verified') !== null
    if (!hasError && !hasVerified) return
    // Clear so a refresh / sibling navigation doesn't re-fire the
    // alert. The effect re-runs on the next searchParams change
    // (after this clear lands) but short-circuits at the
    // hasError/hasVerified guard — no infinite loop.
    const next = new URLSearchParams(searchParams)
    next.delete('error')
    next.delete('verified')
    setSearchParams(next, { replace: true })
  }, [isAuthenticated, searchParams, setSearchParams])

  const onSubmit = (values: LoginFormValues) => {
    // (P6 amendment 2026-06-25) Enter key while pending bypasses the
    // submit button's `disabled` and re-fires handleSubmit; without
    // this guard, a slow network + impatient user could double-submit
    // and pad the lockout counter.
    if (isPending) return
    setFormError(null)
    setOauthError(null)
    setVerifiedBanner(null)
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

  // Form-level error has priority over the OAuth transient — once the
  // user submits credentials, that flow's outcome supersedes the prior
  // OAuth landing alert. Verified banner displays in a separate
  // success-styled slot at the top of the body (above the email form),
  // so the destructive slot here stays error-only.
  const displayedError = formError ?? oauthError

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

          {!isAuthenticated && verifiedBanner && !emailFormOpen && (
            <div
              role="alert"
              data-testid="login-form-banner"
              className="rounded-md border border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 p-3 text-sm text-[color:var(--cl-status-success)]"
            >
              {verifiedBanner}
            </div>
          )}

          {!isAuthenticated && !verifiedBanner && oauthError && !emailFormOpen && (
            <div
              role="alert"
              data-testid="login-form-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {oauthError}
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

                {displayedError && (
                  <div
                    role="alert"
                    data-testid="login-form-error"
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {displayedError}
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
