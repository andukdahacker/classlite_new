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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
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
import { ApiError } from '@/lib/api-fetch'

const SECONDS_PER_MINUTE = 60

export default function LoginPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  // Form-level error displayed in an <div role="alert"> beneath the
  // submit button. Per-field errors flow through RHF setError +
  // FormMessage. OAuth transient errors share the same visual slot.
  const [formError, setFormError] = useState<string | null>(null)
  // OAuth transient is derived ONCE at mount via the lazy initializer
  // (P12 amendment 2026-06-25). Reading searchParams inside useState's
  // initializer avoids the `set-state-in-effect` cascade lint rule —
  // the URL is the input, the alert is the derived state. The effect
  // below only fires the side-effect (clear the URL param so a refresh
  // doesn't re-trigger) and never touches React state. A `useRef`
  // latch keeps StrictMode's double-mount to a single side-effect run.
  const [oauthError, setOauthError] = useState<string | null>(() =>
    searchParams.get('error')
      ? t('auth.login.error.oauthGeneric')
      : null,
  )
  const oauthErrorHandled = useRef(false)

  const schema = useLoginSchema()
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', rememberMe: false },
    mode: 'onBlur',
  })
  const login = useLogin()
  const isPending = login.isPending

  useEffect(() => {
    if (oauthErrorHandled.current) return
    oauthErrorHandled.current = true
    if (!searchParams.get('error')) return
    // Clear so a refresh / sibling navigation doesn't re-fire the alert.
    const next = new URLSearchParams(searchParams)
    next.delete('error')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (values: LoginFormValues) => {
    // (P6 amendment 2026-06-25) Enter key while pending bypasses the
    // submit button's `disabled` and re-fires handleSubmit; without
    // this guard, a slow network + impatient user could double-submit
    // and pad the lockout counter.
    if (isPending) return
    setFormError(null)
    setOauthError(null)
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
  // OAuth landing alert.
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

          {oauthError && !emailFormOpen && (
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
