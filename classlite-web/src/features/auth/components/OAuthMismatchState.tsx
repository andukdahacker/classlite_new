/**
 * OAuthMismatchState — Story 1-9d AC2 / Task 4.1.
 *
 * Mode-replacement region rendered when LoginPage mounts with
 * `?error=invite_email_mismatch` (set by the OAuth callback at
 * `auth_handler.go:626`). Replaces 1-9c's generic
 * `auth.login.error.oauthGeneric` banner with a polished recovery surface.
 *
 * Body copy intentionally does NOT echo expected/actual emails (the
 * backend doesn't expose them — see `auth_handler.go:590-597` SEC-11
 * privacy contract — and inventing them would widen the anti-enumeration
 * surface). Mirrors the 1-9c REST-path `invite-email-mismatch` ratchet.
 *
 * Recovery CTAs (Sally STRONG pin):
 *   1. "Try a different Google account" — threads `prompt=select_account`
 *      through GoogleOAuthButton so Google forces the account-picker on
 *      the re-OAuth.
 *   NO register CTA — the user landed here via `/invite/:token`, and
 *   routing to `/register` strands the invite-token entirely. The
 *   `reopenInviteHint` copy line covers the UX-DR16 "what next" beat
 *   without the dead-end fallback.
 *
 * A11y: heading takes `tabIndex={-1}` + focuses on mount.
 */
import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'

const WARNING_TRIANGLE_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className="h-12 w-12 text-[color:var(--cl-status-warning)]"
  >
    <path
      d="M24 6 L44 40 L4 40 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M24 18 L24 28"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <circle cx="24" cy="34" r="2" fill="currentColor" />
  </svg>
)

export default function OAuthMismatchState(): JSX.Element {
  const { t } = useTranslation()
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div
      role="alert"
      data-testid="login-oauth-mismatch"
      className="grid gap-4 rounded-md border border-[color:var(--cl-status-warning)]/40 bg-[color:var(--cl-status-warning)]/5 p-6 text-center"
    >
      <div className="flex justify-center">{WARNING_TRIANGLE_SVG}</div>
      <h1
        tabIndex={-1}
        ref={headingRef}
        data-testid="login-oauth-mismatch-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] outline-none"
      >
        {t('auth.login.oauthMismatch.heading')}
      </h1>
      <p className="text-sm text-[var(--cl-ink)]">
        {t('auth.login.oauthMismatch.body')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('auth.login.oauthMismatch.reopenInviteHint')}
      </p>
      <GoogleOAuthButton
        label={t('auth.login.oauthMismatch.retryGoogleCta')}
        searchParams={{ prompt: 'select_account' }}
        testId="login-oauth-mismatch-retry-cta"
      />
    </div>
  )
}
