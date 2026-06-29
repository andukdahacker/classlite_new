/**
 * InviteAcceptancePage — Story 1-9c AC4 / AC5.
 *
 * Mounted at `/invite/:token` under AuthLayout. Token is read REACTIVELY
 * via `useParams<{ token: string }>()` inside a `useMemo` so same-tab
 * `/invite/A → /invite/B` URL-bar edits and email-client preview re-clicks
 * re-trigger derivation (Murat token-change-resets-errorState ATDD specimen).
 * Empty / whitespace tokens render the `invalidToken` state with NO network
 * call (the AC4 zero-MSW-count guard locks this).
 *
 * Sender-controlled center-name ribbon: `?c=centerName` is sanitized through
 * `sanitizeCenterName` and either renders as the `auth.invite.titleWithCenter`
 * H1 (when present) or falls back to the generic `auth.invite.title`. Pure
 * cosmetic bridge — no backend probe, no form pre-fill, no anti-enumeration
 * surface. Defense-in-depth: React's text-node escaping is the actual XSS
 * gate; the sanitization regex is a conservative ratchet against unverified
 * values reaching the DOM (Sally party-mode 2026-06-26).
 *
 * Backend contract (Story 1-6, pinned):
 *   - 200 `AcceptInviteResult` → useAcceptInvite hook populates session +
 *     broadcasts + navigates to /dashboard.
 *   - 404 INVITE_NOT_FOUND → terminal notFound region.
 *   - 410 INVITE_EXPIRED (details: centerName, inviterEmail) → terminal
 *     expired region with mailto CTA.
 *   - 409 INVITE_ALREADY_ACCEPTED (details: centerName) → terminal
 *     alreadyAccepted region with sign-in CTA + check-circle SVG (good
 *     outcome, not dead-link).
 *   - 409 INVITE_EMAIL_MISMATCH (details: invitedEmail, oauthEmail — DO NOT
 *     echo) → terminal emailMismatch region.
 *   - 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER → terminal passwordNotAllowed
 *     region with Google CTA re-rendered (only viable recovery).
 *   - 409 EMAIL_ALREADY_REGISTERED → terminal emailAlreadyRegistered region
 *     with sign-in CTA.
 *   - 400 INVALID_INVITE_TOKEN → terminal invalidToken region.
 *   - 429 RATE_LIMIT_EXCEEDED → form-level inline alert + countdown gating
 *     submit; form stays in input mode.
 *   - 422 / 5xx / network → form-level generic alert; form stays in input.
 *
 * TEST-FE-6 compliance: 8 distinct `data-testid` regions (invite-form +
 * 7 terminal states) with iterated negative assertions on the other 7 in
 * every test. The 7 terminal regions all carry a footer back-to-login link
 * that lands on PLAIN `/login` (no `?invited=true`) per the Amelia
 * party-mode privacy ratchet.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import AuthCard from '@/features/auth/components/AuthCard'
import CollapsibleEmailForm from '@/features/auth/components/CollapsibleEmailForm'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'
import PasswordInput from '@/features/auth/components/PasswordInput'
import { useAcceptInvite } from '@/features/auth/api/acceptInvite'
import {
  useInviteSchema,
  type InviteFormValues,
} from '@/features/auth/lib/inviteSchema'
import { sanitizeCenterName } from '@/features/auth/lib/sanitizeCenterName'
import {
  MAX_COUNTDOWN_SECONDS,
  useResendCountdown,
} from '@/features/auth/hooks/useResendCountdown'
import { ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'

type InviteExpiredDetails = components['schemas']['InviteExpiredDetails']
type InviteAlreadyAcceptedDetails =
  components['schemas']['InviteAlreadyAcceptedDetails']

// Terminal state discriminated union — mounting one of these regions
// REPLACES the form (no retry, the token is dead). Inline alerts (429 /
// 422 / 5xx) leave the form mounted via `formError` instead.
type ErrorState =
  | { kind: 'notFound' }
  | { kind: 'expired'; centerName: string; inviterEmail: string }
  | { kind: 'alreadyAccepted'; centerName: string }
  | { kind: 'emailMismatch' }
  | { kind: 'passwordNotAllowed' }
  | { kind: 'emailAlreadyRegistered' }
  | { kind: 'invalidToken' }
  | null

// Winston pattern (1-9b code-review P7 + P8) — defensive against
// `Retry-After: 0` clock-skew. Backend may emit 0 on a clock drift; we
// floor at 5s so the submit cannot re-fire instantly. Upper bound reuses
// `MAX_COUNTDOWN_SECONDS` from `useResendCountdown` so the page ceiling
// can never drift from the hook's clamp.
const MIN_RATE_LIMIT_SECONDS = 5
const DEFAULT_RATE_LIMIT_SECONDS = 60

function clampRateLimit(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_RATE_LIMIT_SECONDS
  return Math.min(
    MAX_COUNTDOWN_SECONDS,
    Math.max(MIN_RATE_LIMIT_SECONDS, Math.floor(seconds)),
  )
}

const CLOCK_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10"
    style={{ color: 'var(--cl-amber)' }}
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

// Sally party-mode 2026-06-26 — "good outcome" visual differentiation
// from the dead-link terminal states. Rendered above the
// `invite-already-accepted` heading.
const CHECK_CIRCLE_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10"
    style={{ color: 'var(--cl-status-success)' }}
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
      d="M12 20 L18 26 L28 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export default function InviteAcceptancePage() {
  const { t } = useTranslation()
  const { token: rawToken } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()

  // Reactive token read — re-derived on path-segment changes so same-tab
  // URL-bar edits + email-client preview re-clicks recompute. Empty /
  // whitespace short-circuit to invalidToken with NO network call.
  const token = useMemo(() => {
    if (rawToken == null) return null
    const trimmed = rawToken.trim()
    if (trimmed === '') return null
    return trimmed
  }, [rawToken])

  // Sender-embedded center-name ribbon — sanitized through the regex
  // before reaching the DOM. Reactive on searchParams change so a
  // same-tab `?c=A → ?c=B` URL-bar edit re-derives.
  const centerName = useMemo(
    () => sanitizeCenterName(searchParams.get('c')),
    [searchParams],
  )

  const [errorState, setErrorState] = useState<ErrorState>(
    token === null ? { kind: 'invalidToken' } : null,
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  const fullNameRef = useRef<HTMLInputElement | null>(null)
  // Ref-backed token snapshot for the stale-mutation guard in
  // `useAcceptInvite`. If the user edits the URL bar mid-flight, a stale
  // in-flight 200 must not setQueryData / broadcast / navigate for the
  // wrong center.
  const tokenRef = useRef<string | null>(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  const acceptInvite = useAcceptInvite(() => tokenRef.current)
  const countdown = useResendCountdown()

  // Murat token-change-resets-errorState ATDD specimen — without this
  // reset, a user landing on a stale token's terminal state and editing
  // to a fresh token in the URL bar stays trapped on the prior screen.
  // Also resets the mutation so a stale 410 onError doesn't smear into
  // the new token's request.
  const resetMutation = acceptInvite.reset
  useEffect(() => {
    // set-state-in-effect: `token` is an external input (URL path) that
    // changes outside React's render cycle on SPA navigation. The
    // terminal-state regions are the React projection of token identity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorState(token === null ? { kind: 'invalidToken' } : null)
    setFormError(null)
    resetMutation()
  }, [token, resetMutation])

  // Sally party-mode 2026-06-26 a11y pin — focus moves to fullName on
  // expand; aria-live region announces the state change. Effect keyed on
  // emailFormOpen so collapse re-open re-fires.
  useEffect(() => {
    if (!emailFormOpen) return
    // RAF wrapper handles the Radix Collapsible portal mount timing —
    // focus before the content node lands is a no-op.
    const id = requestAnimationFrame(() => {
      fullNameRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [emailFormOpen])

  const schema = useInviteSchema()
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', password: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  const isPending = acceptInvite.isPending
  const isRateLimited = countdown.isActive

  const onSubmit = (values: InviteFormValues) => {
    if (isPending || isRateLimited) return
    if (token === null) return
    setFormError(null)
    acceptInvite.mutate(
      {
        inviteToken: token,
        fullName: values.fullName,
        password: values.password,
      },
      {
        onError: (error) => {
          if (!(error instanceof ApiError)) {
            setFormError(t('auth.invite.error.generic'))
            return
          }
          if (error.status === 404 && error.code === 'INVITE_NOT_FOUND') {
            setErrorState({ kind: 'notFound' })
            return
          }
          if (error.status === 410 && error.code === 'INVITE_EXPIRED') {
            const details = (error.details as InviteExpiredDetails | null) ?? {
              centerName: '',
              inviterEmail: '',
            }
            setErrorState({
              kind: 'expired',
              centerName: details.centerName,
              inviterEmail: details.inviterEmail,
            })
            return
          }
          if (
            error.status === 409 &&
            error.code === 'INVITE_ALREADY_ACCEPTED'
          ) {
            const details =
              (error.details as InviteAlreadyAcceptedDetails | null) ?? {
                centerName: '',
              }
            setErrorState({
              kind: 'alreadyAccepted',
              centerName: details.centerName,
            })
            return
          }
          if (error.status === 409 && error.code === 'INVITE_EMAIL_MISMATCH') {
            // Privacy ratchet — do NOT echo `details.invitedEmail` or
            // `details.oauthEmail` to the DOM (Murat email-leak rejection
            // ATDD specimen).
            setErrorState({ kind: 'emailMismatch' })
            return
          }
          if (
            error.status === 409 &&
            error.code === 'PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER'
          ) {
            setErrorState({ kind: 'passwordNotAllowed' })
            return
          }
          if (
            error.status === 409 &&
            error.code === 'EMAIL_ALREADY_REGISTERED'
          ) {
            setErrorState({ kind: 'emailAlreadyRegistered' })
            return
          }
          if (error.status === 400 && error.code === 'INVALID_INVITE_TOKEN') {
            setErrorState({ kind: 'invalidToken' })
            return
          }
          if (error.status === 429 && error.code === 'RATE_LIMIT_EXCEEDED') {
            const requested = error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_SECONDS
            const clamped = clampRateLimit(requested)
            // formError is only the initial snapshot — the live alert text
            // re-derives `countdown.remaining` on every render below so the
            // displayed seconds tick down (mirrors 1-9b code-review P7).
            setFormError(
              t('auth.invite.error.rateLimited', { seconds: clamped }),
            )
            countdown.start(clamped)
            return
          }
          // 422 / 5xx / network — form stays in input mode.
          setFormError(t('auth.invite.error.generic'))
        },
      },
    )
  }

  // Heading slot — H1 is identical text + identical region label across
  // states so the AuthCard's `aria-label` doesn't churn on error swaps.
  const headingText =
    centerName !== null
      ? t('auth.invite.titleWithCenter', { centerName })
      : t('auth.invite.title')

  // Terminal: notFound
  if (errorState?.kind === 'notFound') {
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.notFound.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.notFound.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-not-found"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.notFound.body')}
            </p>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="invite-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.invite.backToLogin')}
          </Link>
        }
      />
    )
  }

  // Terminal: expired
  if (errorState?.kind === 'expired') {
    const { centerName: expiredCenter, inviterEmail } = errorState
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.expired.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.expired.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-expired"
            className="grid gap-4 text-center"
          >
            <div className="flex justify-center">{CLOCK_SVG}</div>
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.expired.body', {
                centerName: expiredCenter,
                inviterEmail,
              })}
            </p>
            <a
              href={`mailto:${inviterEmail}`}
              data-testid="invite-expired-contact-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.invite.error.expired.contactCta', { inviterEmail })}
            </a>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="invite-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.invite.backToLogin')}
          </Link>
        }
      />
    )
  }

  // Terminal: alreadyAccepted
  if (errorState?.kind === 'alreadyAccepted') {
    const { centerName: acceptedCenter } = errorState
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.alreadyAccepted.heading', {
          centerName: acceptedCenter,
        })}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.alreadyAccepted.heading', {
              centerName: acceptedCenter,
            })}
          </h1>
        }
        body={
          <div
            role="status"
            data-testid="invite-already-accepted"
            className="grid gap-4 text-center"
          >
            <div className="flex justify-center">{CHECK_CIRCLE_SVG}</div>
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.alreadyAccepted.body')}
            </p>
            <Link
              to="/login"
              data-testid="invite-already-accepted-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.invite.error.alreadyAccepted.cta')}
            </Link>
          </div>
        }
      />
    )
  }

  // Terminal: emailMismatch
  if (errorState?.kind === 'emailMismatch') {
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.emailMismatch.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.emailMismatch.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-email-mismatch"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.emailMismatch.body')}
            </p>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="invite-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.invite.backToLogin')}
          </Link>
        }
      />
    )
  }

  // Terminal: passwordNotAllowed (Google is the only viable recovery)
  if (errorState?.kind === 'passwordNotAllowed') {
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.passwordNotAllowed.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.passwordNotAllowed.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-password-not-allowed"
            className="grid gap-4"
          >
            <p className="text-center text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.passwordNotAllowed.body')}
            </p>
            {token !== null && (
              <GoogleOAuthButton
                label={t('auth.invite.googleCta')}
                searchParams={{ inviteToken: token }}
              />
            )}
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="invite-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.invite.backToLogin')}
          </Link>
        }
      />
    )
  }

  // Terminal: emailAlreadyRegistered (no footer — primary CTA already
  // routes to /login)
  if (errorState?.kind === 'emailAlreadyRegistered') {
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.emailAlreadyRegistered.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.emailAlreadyRegistered.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-email-already-registered"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.emailAlreadyRegistered.body')}
            </p>
            <Link
              to="/login"
              data-testid="invite-email-already-registered-cta"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-12 w-full',
              )}
            >
              {t('auth.invite.error.emailAlreadyRegistered.cta')}
            </Link>
          </div>
        }
      />
    )
  }

  // Terminal: invalidToken (mount-time empty token OR 400 INVALID_INVITE_TOKEN)
  if (errorState?.kind === 'invalidToken') {
    return (
      <AuthCard
        regionLabel={t('auth.invite.error.invalidToken.heading')}
        heading={
          <h1
            className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] md:text-3xl"
            data-testid="invite-heading"
          >
            {t('auth.invite.error.invalidToken.heading')}
          </h1>
        }
        body={
          <div
            role="alert"
            data-testid="invite-invalid-token"
            className="grid gap-4 text-center"
          >
            <p className="text-sm text-[var(--cl-ink-soft)]">
              {t('auth.invite.error.invalidToken.body')}
            </p>
          </div>
        }
        footer={
          <Link
            to="/login"
            data-testid="invite-back-link"
            className="text-[var(--cl-accent)] underline"
          >
            {t('auth.invite.backToLogin')}
          </Link>
        }
      />
    )
  }

  // Form mode — valid token, no terminal error yet.
  return (
    <AuthCard
      regionLabel={headingText}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
          data-testid="invite-heading"
        >
          {headingText}
        </h1>
      }
      body={
        <div className="grid gap-4" data-testid="invite-form">
          <p className="text-center text-sm text-[var(--cl-ink-soft)]">
            {t('auth.invite.body')}
          </p>

          {token !== null && (
            <GoogleOAuthButton
              label={t('auth.invite.googleCta')}
              searchParams={{ inviteToken: token }}
              disabled={isPending}
            />
          )}

          {emailFormOpen && (
            <div
              className="relative flex items-center"
              data-testid="invite-form-divider"
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
            triggerLabel={t('auth.invite.emailCollapse')}
          >
            {/* aria-live announcement node — Sally a11y pin. Lives
                inside the collapsible content so screen readers tied to
                the trigger region hear the announcement post-expand. */}
            <div
              role="status"
              aria-live="polite"
              data-testid="invite-aria-live"
              className="sr-only"
            >
              {emailFormOpen
                ? t('auth.invite.emailFormExpandedAnnouncement')
                : ''}
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
                className="grid gap-3"
              >
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.invite.fullNameLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="name"
                          placeholder={t('storybook.placeholder.name')}
                          data-testid="invite-fullname-input"
                          {...field}
                          ref={(node) => {
                            field.ref(node)
                            fullNameRef.current = node
                          }}
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
                      <FormLabel>{t('auth.invite.passwordLabel')}</FormLabel>
                      <FormControl>
                        <PasswordInput
                          autoComplete="new-password"
                          placeholder={t('auth.common.passwordPlaceholder')}
                          data-testid="invite-password-input"
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
                    data-testid="invite-error-alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {isRateLimited
                      ? t('auth.invite.error.rateLimited', {
                          seconds: countdown.remaining,
                        })
                      : formError}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full"
                  disabled={isPending || isRateLimited}
                  data-testid="invite-submit"
                >
                  {t('auth.invite.submit')}
                </Button>
              </form>
            </Form>
          </CollapsibleEmailForm>
        </div>
      }
      footer={
        <Link
          to="/login"
          data-testid="invite-back-link"
          className="text-[var(--cl-accent)] underline"
        >
          {t('auth.invite.backToLogin')}
        </Link>
      }
    />
  )
}
