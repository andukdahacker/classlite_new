/**
 * WorkspaceBlockedState — Story 1-9d AC3 / Task 4.2.
 *
 * Mode-replacement region rendered when LoginPage mounts with
 * `?error=google_userinfo_failed` OR `?error=google_email_unverified`
 * (Workspace-policy 403s and forced-verification flows both surface here
 * per `auth_handler.go:562,564`).
 *
 * Body copy is FORKED by the error code (Sally STRONG fork pin — the two
 * error codes have divergent user-fixable surfaces; rendering identical
 * copy is a UX-DR16 "what next" failure):
 *
 *   - `google_userinfo_failed` → Workspace-policy framing
 *     ("Workspace administrator hasn't allowed this app")
 *   - `google_email_unverified` → forced-verification framing
 *     ("Verify your email at myaccount.google.com")
 *
 * Recovery CTAs (shared across both branches):
 *   1. "Try a personal Google account" — `prompt=select_account` re-OAuth
 *   2. "Sign up with email instead" — `/register` (NOT invite-anchored)
 *
 * A11y: heading takes `tabIndex={-1}` + focuses on mount.
 */
import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'

const BLOCK_SVG = (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className="h-12 w-12 text-[color:var(--cl-status-warning)]"
  >
    <circle
      cx="24"
      cy="24"
      r="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      d="M10 10 L38 38"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
)

export type WorkspaceBlockedReason =
  | 'google_userinfo_failed'
  | 'google_email_unverified'

export interface WorkspaceBlockedStateProps {
  reason: WorkspaceBlockedReason
}

export default function WorkspaceBlockedState({
  reason,
}: WorkspaceBlockedStateProps): JSX.Element {
  const { t } = useTranslation()
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const bodyKey =
    reason === 'google_userinfo_failed'
      ? 'auth.login.workspaceBlocked.bodyUserinfoFailed'
      : 'auth.login.workspaceBlocked.bodyEmailUnverified'

  return (
    <div
      role="alert"
      data-testid="login-workspace-blocked"
      className="grid gap-4 rounded-md border border-[color:var(--cl-status-warning)]/40 bg-[color:var(--cl-status-warning)]/5 p-6 text-center"
    >
      <div className="flex justify-center">{BLOCK_SVG}</div>
      <h1
        tabIndex={-1}
        ref={headingRef}
        data-testid="login-workspace-blocked-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] outline-none"
      >
        {t('auth.login.workspaceBlocked.heading')}
      </h1>
      <p
        data-testid="login-workspace-blocked-body"
        className="text-sm text-[var(--cl-ink)]"
      >
        {t(bodyKey)}
      </p>
      <GoogleOAuthButton
        label={t('auth.login.workspaceBlocked.tryPersonalCta')}
        searchParams={{ prompt: 'select_account' }}
        testId="login-workspace-blocked-retry-cta"
      />
      <Link
        to="/register"
        data-testid="login-workspace-blocked-register-cta"
        className={cn(
          buttonVariants({ variant: 'outline', size: 'lg' }),
          'h-12 w-full',
        )}
      >
        {t('auth.login.workspaceBlocked.registerCta')}
      </Link>
    </div>
  )
}
