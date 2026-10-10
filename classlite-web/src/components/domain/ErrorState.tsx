/**
 * ErrorState — the canonical inline error-state leaf (Story 10.4, AC1; the
 * error-states twin of `EmptyState`). ONE presentational component generalizing
 * the ~12 copy-pasted local `ErrorAlert`s (`DashboardErrorAlert`, the ClassesPage
 * `ErrorAlert`, the `ErrorStatePlaceholder` stand-in, …) into a single inline
 * `role="alert"` retry-banner in the shipped red idiom (`--cl-red` /
 * `--cl-tint-red`).
 *
 * It is DUMB on purpose (UX-1 / UX-3 / TEST-FE-4, mirroring `EmptyState`):
 *   - It NEVER calls `t()` — every string arrives already i18n-resolved from the
 *     consumer, so role-dependent CTAs (owner "Upgrade" vs member "ask owner")
 *     are decided at the call site.
 *   - It NEVER reads role.
 *   - The interface is FLAT (no discriminated union) — a DU buys ~no safety on a
 *     presentational leaf and fights ergonomics.
 *   - HTTP codes / stack traces are NEVER surfaced (UX-DR24).
 *
 * The three-part §6.4 recovery pattern (FR-70) maps to the props:
 *   `message` (what happened) + `detail` (why) + `retry` / `action` (what to do).
 * A transient fetch-retry alert legitimately uses `message` + `retry` only (its
 * "why" is self-evident); `detail` is required in spirit only for the designed
 * error states (s63–s67, storage).
 *
 * This leaf is the inline idiom ONLY — the fullscreen orientation screens
 * (`ErrorBoundary` `ErrorFallback`, `PermissionDenied`, `NotFound`) are a
 * different shape and are NOT replatformed onto it (D1 scope).
 */
import type { ReactElement, ReactNode } from 'react'

import { Button } from '@/components/ui/button'

export interface ErrorStateProps {
  /** Optional ghosted glyph (a lucide icon, e.g. `AlertTriangle`) supplied by the call site; rendered `aria-hidden`. */
  icon?: ReactNode
  /** i18n-RESOLVED "what happened" line — REQUIRED. Never an HTTP code / stack trace. */
  message: string
  /** i18n-RESOLVED "why" context line — optional (the three-part middle). */
  detail?: string
  /** i18n-RESOLVED retry label; renders a retry Button only when paired with `onRetry`. */
  retryLabel?: string
  /** Re-issues the underlying fetch (TanStack Query `refetch`). */
  onRetry?: () => void
  /** Optional "what to do next" CTA / escape (View storage, Go to Dashboard, Upgrade…). */
  action?: ReactNode
  'data-testid'?: string
}

/**
 * ErrorState renders an inline `role="alert"` recovery banner in the red idiom.
 * See the module docstring for the contract; all strings must arrive
 * i18n-resolved (the component never calls `t()`).
 */
export function ErrorState({
  icon,
  message,
  detail,
  retryLabel,
  onRetry,
  action,
  'data-testid': dataTestId,
}: ErrorStateProps): ReactElement {
  const showRetry = onRetry != null && retryLabel != null
  const showActions = showRetry || action != null

  return (
    <div
      role="alert"
      data-testid={dataTestId}
      className="flex flex-col gap-3 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
    >
      <div className="flex items-start gap-2">
        {icon != null ? (
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {icon}
          </span>
        ) : null}
        <div className="flex flex-col gap-1">
          <p className="font-medium">{message}</p>
          {detail ? <p className="font-normal">{detail}</p> : null}
        </div>
      </div>
      {showActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {showRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  )
}
