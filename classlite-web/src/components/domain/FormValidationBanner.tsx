/**
 * FormValidationBanner — a top-of-form `role="alert"` summary that enumerates the
 * current field errors (Story 10.4 AC6). Shown when ≥1 error is present so a user
 * (especially a screen-reader user) gets the whole list at once instead of hunting
 * field by field. DUMB leaf — the title and every message arrive i18n-resolved
 * (it never calls `t()`); it renders nothing when there are no messages.
 */
import type { ReactElement } from 'react'

export interface FormValidationBannerProps {
  /** i18n-RESOLVED summary title (typically carrying the error {{count}}). */
  title: string
  /** i18n-RESOLVED per-error lines. */
  messages: readonly string[]
  'data-testid'?: string
}

export function FormValidationBanner({
  title,
  messages,
  'data-testid': dataTestId,
}: FormValidationBannerProps): ReactElement | null {
  if (messages.length === 0) return null
  return (
    <div
      role="alert"
      data-testid={dataTestId}
      className="flex flex-col gap-1 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
    >
      <p className="font-medium">{title}</p>
      <ul className="list-disc pl-5">
        {messages.map((message, index) => (
          <li key={`${index}-${message}`}>{message}</li>
        ))}
      </ul>
    </div>
  )
}
