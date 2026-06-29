/**
 * Banner — variant-driven alert/status surface for LoginPage.
 *
 * Discharges the Winston 1-9c gate (1-9d pre-merge mandate): four banner
 * branches in `LoginPage.tsx` is a smell; five is a defect. This component
 * collapses the four-(now-five)-way inline JSX chain into a discriminated
 * union keyed by `variant`.
 *
 * Priority semantics live in `LoginPage.deriveBannerKey` — Banner does NOT
 * own selection, only rendering. Aria role is derived from the variant
 * (`alert` for urgent destructive/warning; `status` for acknowledgment
 * success), honoring UX-DR16's urgency distinction.
 *
 * SCOPE GUARDRAIL (Winston W6 pin — 1-9d): this component owns ONLY
 * variant styling + aria-role. Glyph, message text, and any CTAs are
 * CALLER concerns. Do NOT add `heading`, `cta`, `dismissible`,
 * `onDismiss`, `autohide`, etc. props here. Future variants extend
 * `BannerVariant` + `VARIANT_STYLES`; behavior props belong on the
 * caller. Mirrors AuthCard's 1-8 posture — composition, not god-component.
 */
import type { JSX, ReactNode } from 'react'

export type BannerVariant =
  | 'session-expired'
  | 'invited'
  | 'reset'
  | 'verified'
  | 'oauth-error'

interface BannerProps {
  variant: BannerVariant
  message: string
  /** Optional inline glyph rendered before the message. */
  icon?: ReactNode
  /** Test seam — matches the existing LoginPage testids. */
  testId?: string
}

interface VariantStyle {
  containerClass: string
  ariaRole: 'alert' | 'status'
}

const SUCCESS_CONTAINER =
  'flex items-start gap-2 rounded-md border border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 p-3 text-sm text-[color:var(--cl-status-success)]'
const WARNING_CONTAINER =
  'flex items-start gap-2 rounded-md border border-[color:var(--cl-status-warning)]/40 bg-[color:var(--cl-status-warning)]/10 p-3 text-sm text-[color:var(--cl-status-warning)]'
const DESTRUCTIVE_CONTAINER =
  'flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'

const VARIANT_STYLES: Record<BannerVariant, VariantStyle> = {
  'session-expired': {
    containerClass: WARNING_CONTAINER,
    ariaRole: 'alert',
  },
  invited: {
    containerClass: SUCCESS_CONTAINER,
    ariaRole: 'status',
  },
  reset: {
    containerClass: SUCCESS_CONTAINER,
    ariaRole: 'status',
  },
  verified: {
    containerClass: SUCCESS_CONTAINER,
    ariaRole: 'status',
  },
  'oauth-error': {
    containerClass: DESTRUCTIVE_CONTAINER,
    ariaRole: 'alert',
  },
}

export default function Banner({
  variant,
  message,
  icon,
  testId = 'login-form-banner',
}: BannerProps): JSX.Element {
  const style = VARIANT_STYLES[variant]
  return (
    <div
      role={style.ariaRole}
      data-testid={testId}
      data-variant={variant}
      className={style.containerClass}
    >
      {icon}
      <span>{message}</span>
    </div>
  )
}
