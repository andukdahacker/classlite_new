/**
 * InlineFieldError — the canonical per-field inline error idiom (Story 10.4 AC6).
 * A `role="alert"` red one-liner shown directly under a form field, generalizing
 * the ad-hoc `<p className="text-xs text-[color:var(--cl-red)]" role="alert">`
 * copies scattered across the forms (ClassFormDialog's `Field`, the settings
 * tabs). DUMB leaf — all strings arrive i18n-resolved (it never calls `t()`).
 */
import type { ReactElement } from 'react'

export interface InlineFieldErrorProps {
  /** i18n-RESOLVED error message. */
  message: string
  'data-testid'?: string
}

export function InlineFieldError({
  message,
  'data-testid': dataTestId,
}: InlineFieldErrorProps): ReactElement {
  return (
    <p role="alert" data-testid={dataTestId} className="text-xs text-[color:var(--cl-red)]">
      {message}
    </p>
  )
}
