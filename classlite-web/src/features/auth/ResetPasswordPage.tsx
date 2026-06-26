/**
 * ResetPasswordPage — Story 1-9b AC5 / AC6.
 *
 * Mounted at `/reset-password` under AuthLayout. Token is read
 * REACTIVELY (Winston amendment 2026-06-26 — drop "exactly once on first
 * render") via `useSearchParams().get('token')` inside a `useMemo` keyed
 * on `searchParams`. Handles same-tab `?token=A → ?token=B` URL-bar
 * edits and email-client preview re-clicks. Empty / whitespace tokens
 * render the invalid state with NO network call (the AC5 zero-MSW-count
 * guard locks this).
 *
 * Backend contract (Story 1-5, pinned):
 *   - 200 `{ reset: true }` + server invalidates ALL refresh tokens →
 *     navigate('/login?reset=1', { replace }) IMMEDIATELY (no countdown).
 *   - 410 RESET_TOKEN_EXPIRED → swap to expired state (UX-DR16 part 1+2+3).
 *   - 409 RESET_TOKEN_CONSUMED → swap to consumed state.
 *   - 404 RESET_TOKEN_INVALID → swap to invalid state (same DOM as
 *     no-token-on-mount per AC6 DRY directive).
 *   - 422 / 5xx / network → form-level generic alert; form stays in input.
 *
 * Email leak rejection ratchet (Murat ATDD specimen): even if the email
 * is appended to the URL as `?token=...&email=leak@...`, the page MUST
 * NOT pre-fill the password fields with it or display it anywhere.
 * Pragmatic deviation from epic AC, locked by the AC5 ratchet test.
 *
 * RHF wiring (Winston amendment): `mode: 'onBlur'` +
 * `reValidateMode: 'onChange'`. The reValidateMode closes the
 * stale-refine inconsistency — after both fields blur and validate, an
 * edit to `newPassword` re-fires the refine on every keystroke so a
 * stale match doesn't sneak past the submit.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { cn } from '@/lib/utils'
import AuthCard from '@/features/auth/components/AuthCard'
import PasswordInput from '@/features/auth/components/PasswordInput'
import PasswordStrengthBar from '@/features/auth/components/PasswordStrengthBar'
import { useResetPassword } from '@/features/auth/api/resetPassword'
import {
  useResetPasswordSchema,
  type ResetPasswordFormValues,
} from '@/features/auth/lib/resetPasswordSchema'
import { ApiError } from '@/lib/api-fetch'

type ErrorState = 'expired' | 'consumed' | 'invalid' | null

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

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // Reactive token read — re-derived whenever searchParams changes
  // identity (URL-bar edits, email-client preview re-clicks).
  const token = useMemo(() => {
    const raw = searchParams.get('token')
    if (raw === null) return null
    const trimmed = raw.trim()
    if (trimmed === '') return null
    return trimmed
  }, [searchParams])

  const [errorState, setErrorState] = useState<ErrorState>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const resetPassword = useResetPassword()

  // Strip any `?email=...` URL param on mount and on URL change — the
  // pragmatic-deviation rationale forbids surfacing the email anywhere
  // in the reset flow, and leaving it in `location.search` leaks via
  // browser history, analytics URL fields, screen-sharing, and browser
  // session sync. Closes the gap the email-leak rejection ratchet test
  // documents but didn't enforce ([Review][Patch] P5 — code-review
  // 2026-06-26).
  useEffect(() => {
    if (searchParams.get('email') === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('email')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Reset terminal-state regions when the token identity changes —
  // same-tab `?token=A → ?token=B` URL-bar edits and email-client
  // preview re-clicks are explicitly supported. Without this reset,
  // a user who lands on token A, sees the expired/consumed/invalid
  // screen, then edits to token B is stuck on the prior error region
  // because the early-return short-circuits before the form renders.
  // Also resets the mutation cache so a stale onError doesn't smear
  // into the new token's request ([Review][Patch] P1 — code-review
  // 2026-06-26). The `.reset` callback is a stable ref from TanStack
  // Query v5, so this fires once per token-identity change.
  const resetMutation = resetPassword.reset
  useEffect(() => {
    // set-state-in-effect is justified: `token` is an external input
    // (URL search params) that changes outside React's render cycle on
    // SPA navigation / address-bar edits, and the terminal-state
    // regions are the React projection of that token identity. Same
    // shape as LoginPage's bannerKey re-derivation effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorState(null)
    setFormError(null)
    resetMutation()
  }, [token, resetMutation])

  const schema = useResetPasswordSchema()
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
    mode: 'onBlur',
    // Winston amendment 2026-06-26 — refine re-fires on every keystroke
    // after the first blur so a stale match doesn't sneak past submit.
    reValidateMode: 'onChange',
  })

  const newPasswordValue = useWatch({
    control: form.control,
    name: 'newPassword',
  })

  const isPending = resetPassword.isPending

  const onSubmit = (values: ResetPasswordFormValues) => {
    if (isPending) return
    if (token === null) return
    setFormError(null)
    resetPassword.mutate(
      { token, newPassword: values.newPassword },
      {
        onSuccess: () => {
          // Backend wipes all refresh tokens; redirect immediately —
          // the LoginPage banner copy explains the device sign-outs.
          navigate('/login?reset=1', { replace: true })
        },
        onError: (error) => {
          if (!(error instanceof ApiError)) {
            setFormError(t('auth.resetPassword.error.generic'))
            return
          }
          if (error.status === 410 && error.code === 'RESET_TOKEN_EXPIRED') {
            setErrorState('expired')
            return
          }
          if (error.status === 409 && error.code === 'RESET_TOKEN_CONSUMED') {
            setErrorState('consumed')
            return
          }
          if (error.status === 404 && error.code === 'RESET_TOKEN_INVALID') {
            setErrorState('invalid')
            return
          }
          setFormError(t('auth.resetPassword.error.generic'))
        },
      },
    )
  }

  // Invalid state — missing/empty token on mount OR 404 from server.
  if (token === null || errorState === 'invalid') {
    return (
      <AuthCard
        regionLabel={t('auth.resetPassword.invalidHeading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="reset-password-heading"
          >
            {t('auth.resetPassword.invalidHeading')}
          </h1>
        }
        body={
          <div
            data-testid="reset-password-invalid"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.resetPassword.invalidBody')}
            </p>
            <Link
              to="/forgot-password"
              data-testid="reset-invalid-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.resetPassword.expiredCta')}
            </Link>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="reset-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        }
      />
    )
  }

  if (errorState === 'expired') {
    return (
      <AuthCard
        regionLabel={t('auth.resetPassword.expiredHeading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="reset-password-heading"
          >
            {t('auth.resetPassword.expiredHeading')}
          </h1>
        }
        body={
          <div
            data-testid="reset-password-expired"
            className="grid gap-4 text-center"
          >
            <div className="flex justify-center">{CLOCK_SVG}</div>
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.resetPassword.expiredBody')}
            </p>
            <Link
              to="/forgot-password"
              data-testid="reset-expired-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.resetPassword.expiredCta')}
            </Link>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="reset-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        }
      />
    )
  }

  if (errorState === 'consumed') {
    return (
      <AuthCard
        regionLabel={t('auth.resetPassword.consumedHeading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="reset-password-heading"
          >
            {t('auth.resetPassword.consumedHeading')}
          </h1>
        }
        body={
          <div
            data-testid="reset-password-consumed"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.resetPassword.consumedBody')}
            </p>
            <Link
              to="/login"
              data-testid="reset-consumed-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.forgotPassword.backToLogin')}
            </Link>
          </div>
        }
        footer={
          // Use the consumed-specific copy — `expiredCta` ("Request a
          // new reset link") implies the prior reset failed, which is
          // wrong on the consumed state where the reset succeeded
          // ([Review][Patch] P10 — code-review 2026-06-26).
          <Link
            to="/forgot-password"
            data-testid="reset-consumed-forgot-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.resetPassword.consumedForgotCta')}
          </Link>
        }
      />
    )
  }

  // Form mode — valid token, no terminal error yet.
  return (
    <AuthCard
      regionLabel={t('auth.resetPassword.title')}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
          data-testid="reset-password-heading"
        >
          {t('auth.resetPassword.title')}
        </h1>
      }
      body={
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="grid gap-4"
            data-testid="reset-password-form"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.resetPassword.body')}
            </p>

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('auth.resetPassword.newPasswordLabel')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder={t('auth.common.passwordPlaceholder')}
                      data-testid="reset-new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PasswordStrengthBar password={newPasswordValue ?? ''} />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('auth.resetPassword.confirmPasswordLabel')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder={t('auth.common.passwordPlaceholder')}
                      data-testid="reset-confirm-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError && (
              <div
                role="alert"
                data-testid="reset-error-alert"
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
              data-testid="reset-submit"
            >
              {t('auth.resetPassword.submit')}
            </Button>
          </form>
        </Form>
      }
      footer={
        <Link
          to="/login"
          data-testid="reset-back-link"
          className="text-[var(--cl-accent)] underline"
        >
          {t('auth.forgotPassword.backToLogin')}
        </Link>
      }
    />
  )
}
