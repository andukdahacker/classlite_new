/**
 * GoogleOAuthButton — Story 1-8 AC1.
 *
 * Anchor-based top-level navigation per `api.yaml` `/api/auth/google`
 * 302 contract — NOT an XHR. Inline 4-color Google "G" SVG (Google ToS
 * permits inline brand assets when the link initiates a Google sign-in
 * flow + label is "Continue with Google" / locale equivalent).
 *
 * States:
 *   - default / hover / focus-visible (anchor)
 *   - disabled (parallel email-form submission is in flight) — render
 *     `aria-disabled="true"` + `pointer-events: none` + opacity. `<a>`
 *     doesn't accept the native `disabled` attribute; aria-disabled is
 *     the contract.
 *   - nav-pending (on click) — set local `isNavigating=true` and render
 *     `aria-busy="true"` + visually-pressed for the ~80-200ms top-level
 *     nav teardown. Prevents flaky-network double-click (Sally amendment
 *     2026-06-25).
 *
 * Optional `searchParams` prop ships in the type signature but is NOT
 * consumed by Story 1-8 — Story 1.9c (invite acceptance) will pass
 * `?inviteToken=...` through.
 */
import { useState, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

const GOOGLE_INIT_PATH = '/api/auth/google'

export interface GoogleOAuthButtonProps {
  /** Localized button label, e.g. `t('auth.login.googleCta')`. */
  label: string
  /**
   * Disable the anchor visually when a parallel email-form submission
   * is in flight. Renders `aria-disabled="true"` + `pointer-events:
   * none`. `<a>` ignores native `disabled`; the visual + aria contract
   * is the only sanctioned signal.
   */
  disabled?: boolean
  /**
   * Story 1.9c will pass `{ inviteToken: '...' }` so the OAuth init
   * endpoint can thread the invite through the callback. Not consumed
   * by Story 1-8; ships in the type signature for downstream
   * stability.
   */
  searchParams?: Record<string, string>
}

// Google brand color literals — REQUIRED by Google's Sign-in branding
// guidelines (https://developers.google.com/identity/branding-guidelines).
// These are NOT ClassLite design tokens; they are Google's identity. The
// `no-restricted-syntax` hex-color guard is disabled per path because the
// brand assets are an external trademark spec, not a ClassLite color choice.
const GOOGLE_LOGO = (
  <svg
    aria-hidden="true"
    focusable="false"
    width="18"
    height="18"
    viewBox="0 0 18 18"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      // eslint-disable-next-line no-restricted-syntax -- Google brand color (trademark spec)
      fill="#4285F4"
      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
    />
    <path
      // eslint-disable-next-line no-restricted-syntax -- Google brand color (trademark spec)
      fill="#34A853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
    />
    <path
      // eslint-disable-next-line no-restricted-syntax -- Google brand color (trademark spec)
      fill="#FBBC05"
      d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
    />
    <path
      // eslint-disable-next-line no-restricted-syntax -- Google brand color (trademark spec)
      fill="#EA4335"
      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
    />
  </svg>
)

function appendQuery(path: string, params: Record<string, string>): string {
  const usp = new URLSearchParams(params)
  return `${path}?${usp.toString()}`
}

export default function GoogleOAuthButton({
  label,
  disabled = false,
  searchParams,
}: GoogleOAuthButtonProps) {
  const [isNavigating, setIsNavigating] = useState(false)
  const href =
    searchParams && Object.keys(searchParams).length > 0
      ? appendQuery(GOOGLE_INIT_PATH, searchParams)
      : GOOGLE_INIT_PATH

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    setIsNavigating(true)
  }

  return (
    <a
      href={href}
      data-testid="google-oauth-cta"
      data-slot="google-oauth-button"
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      aria-busy={isNavigating || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        'inline-flex h-12 w-full items-center justify-center gap-3 rounded-lg border bg-background text-base font-medium text-foreground transition-colors',
        'border-[var(--cl-line)] hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        disabled && 'pointer-events-none opacity-50',
        isNavigating && 'bg-muted',
      )}
    >
      {GOOGLE_LOGO}
      <span>{label}</span>
    </a>
  )
}
