/**
 * ForgotPasswordPage — Story 1-9b AC3 / AC4.
 *
 * Mounted at `/forgot-password` under AuthLayout. Two visual modes
 * driven by the `submitted` local state:
 *
 *   form mode      → email Input + Send-reset-link submit. Validates onBlur.
 *   confirmation   → anti-enum heading + body with the bolded
 *                    `submittedEmail`, spam hint, typo-escape ("Wrong
 *                    email?") button reverting to form mode, Resend
 *                    button with 60s countdown, footer back-to-login.
 *
 * Backend contract (Story 1-5, pinned):
 *   - 200 response is identical regardless of whether the email is on
 *     file (anti-enumeration). Component code path NEVER reads
 *     `response.headers` or branches on response timing — locked by the
 *     "anti-enum coupling regression guard" pinned test in AC3.
 *   - 429 RATE_LIMIT_EXCEEDED carries Retry-After; surface via
 *     `ApiError.retryAfterSeconds` (1-8 wiring) + countdown the submit.
 *   - 422 / 5xx / network → generic alert; form stays in input mode.
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import AuthCard from '@/features/auth/components/AuthCard'
import {
  RESEND_COUNTDOWN_SECONDS,
  MAX_COUNTDOWN_SECONDS,
  useResendCountdown,
} from '@/features/auth/hooks/useResendCountdown'

// Lower bound for the rate-limit countdown — a `Retry-After: 0` (or
// negative) header from a clock-skewed backend would otherwise collapse
// to the hook's MIN (1s) and let the user spam the endpoint
// ([Review][Patch] P8 — code-review 2026-06-26).
const MIN_RATE_LIMIT_SECONDS = 5
import { useForgotPassword } from '@/features/auth/api/forgotPassword'
import {
  useForgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '@/features/auth/lib/forgotPasswordSchema'
import { ApiError } from '@/lib/api-fetch'

type FormError = { kind: 'rate-limited' } | { kind: 'generic' } | null

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [formError, setFormError] = useState<FormError>(null)
  const emailInputRef = useRef<HTMLInputElement | null>(null)

  const schema = useForgotPasswordSchema()
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
    mode: 'onBlur',
  })

  const forgotPassword = useForgotPassword()
  const countdown = useResendCountdown()
  const isPending = forgotPassword.isPending

  const fireMutation = (email: string, isResend: boolean) => {
    if (isPending) return
    if (countdown.isActive && isResend) return
    setFormError(null)
    forgotPassword.mutate(
      { email },
      {
        onSuccess: () => {
          setSubmittedEmail(email)
          setSubmitted(true)
          countdown.start(RESEND_COUNTDOWN_SECONDS)
        },
        onError: (error) => {
          if (
            error instanceof ApiError &&
            error.status === 429 &&
            error.code === 'RATE_LIMIT_EXCEEDED'
          ) {
            const requested =
              error.retryAfterSeconds ?? RESEND_COUNTDOWN_SECONDS
            // Clamp lower bound to a sane floor so `Retry-After: 0`
            // can't collapse to ~1s and let the user spam the endpoint.
            // Clamp upper bound to `MAX_COUNTDOWN_SECONDS` so a stuck
            // backend can't strand the form indefinitely.
            const clamped = Math.min(
              MAX_COUNTDOWN_SECONDS,
              Math.max(MIN_RATE_LIMIT_SECONDS, requested),
            )
            countdown.start(clamped)
            setFormError({ kind: 'rate-limited' })
            return
          }
          setFormError({ kind: 'generic' })
        },
      },
    )
  }

  const onSubmit = (values: ForgotPasswordFormValues) => {
    fireMutation(values.email, false)
  }

  const onResend = () => {
    // Resend re-fires with the SAME submittedEmail (not the form value).
    // Deep-equal locked by the AC3 "resend deep-equal" pinned test.
    fireMutation(submittedEmail, true)
  }

  const onWrongEmail = () => {
    // Typo-escape — revert to form mode, clear RHF state, focus email.
    setSubmitted(false)
    setFormError(null)
    setSubmittedEmail('')
    form.reset({ email: '' })
    queueMicrotask(() => {
      emailInputRef.current?.focus()
    })
  }

  const submitDisabled = isPending || countdown.isActive

  const regionLabel = useMemo(
    () =>
      submitted
        ? t('auth.forgotPassword.sentHeading')
        : t('auth.forgotPassword.title'),
    [submitted, t],
  )

  if (submitted) {
    // Render sentBody with the email bolded inline. The sentinel split
    // lets us keep the {{email}} interpolation contract from i18next
    // while wrapping the value in <strong>; we never inject the user's
    // literal email into the translation key search.
    const SENT_BODY_SENTINEL = 'EMAIL'
    const sentBodyParts = t('auth.forgotPassword.sentBody', {
      email: SENT_BODY_SENTINEL,
    }).split(SENT_BODY_SENTINEL)
    const sentBodyPre = sentBodyParts[0] ?? ''
    const sentBodyPost = sentBodyParts[1] ?? ''

    return (
      <AuthCard
        regionLabel={regionLabel}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
            data-testid="forgot-sent-heading"
          >
            {t('auth.forgotPassword.sentHeading')}
          </h1>
        }
        body={
          <div
            data-testid="forgot-password-sent"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {sentBodyPre}
              <strong
                data-testid="forgot-sent-email"
                className="break-all font-semibold text-[var(--cl-ink)]"
              >
                {submittedEmail}
              </strong>
              {sentBodyPost}
            </p>

            <p
              data-testid="forgot-spam-hint"
              className="text-sm text-[var(--cl-ink-muted)]"
            >
              {t('auth.forgotPassword.spamHint')}
            </p>

            <button
              type="button"
              data-testid="forgot-wrong-email"
              onClick={onWrongEmail}
              className="text-sm text-[var(--cl-accent)] underline"
            >
              {t('auth.forgotPassword.wrongEmail')}
            </button>

            {formError && (
              <div
                role="alert"
                data-testid="forgot-error-alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {formError.kind === 'rate-limited'
                  ? t('auth.forgotPassword.error.rateLimited', {
                      // Interpolate the LIVE countdown value so the
                      // copy ticks down with the disabled-button gate
                      // — previously the snapshot froze and the user
                      // watched "Please wait 45s" for the full window
                      // ([Review][Patch] P7).
                      seconds: countdown.remaining,
                    })
                  : t('auth.forgotPassword.error.generic')}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              data-testid="forgot-resend-button"
              disabled={countdown.isActive || isPending}
              onClick={onResend}
            >
              {countdown.isActive
                ? t('auth.forgotPassword.resendCountdown', {
                    seconds: countdown.remaining,
                  })
                : t('auth.forgotPassword.resendCta')}
            </Button>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="forgot-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        }
      />
    )
  }

  return (
    <AuthCard
      regionLabel={regionLabel}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
          data-testid="forgot-password-heading"
        >
          {t('auth.forgotPassword.title')}
        </h1>
      }
      body={
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="grid gap-4"
            data-testid="forgot-password-form"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.forgotPassword.body')}
            </p>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.forgotPassword.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder={t('auth.common.emailPlaceholder')}
                      data-testid="forgot-email-input"
                      {...field}
                      ref={(node) => {
                        emailInputRef.current = node
                        field.ref(node)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError && (
              <div
                role="alert"
                data-testid="forgot-error-alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {formError.kind === 'rate-limited'
                  ? t('auth.forgotPassword.error.rateLimited', {
                      // Interpolate the LIVE countdown value so the
                      // copy ticks down with the disabled-button gate
                      // — previously the snapshot froze and the user
                      // watched "Please wait 45s" for the full window
                      // ([Review][Patch] P7).
                      seconds: countdown.remaining,
                    })
                  : t('auth.forgotPassword.error.generic')}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="h-12 w-full"
              disabled={submitDisabled}
              data-testid="forgot-submit"
            >
              {t('auth.forgotPassword.submit')}
            </Button>
          </form>
        </Form>
      }
      footer={
        <Link
          to="/login"
          data-testid="forgot-back-link"
          className="text-[var(--cl-accent)] underline"
        >
          {t('auth.forgotPassword.backToLogin')}
        </Link>
      }
    />
  )
}
