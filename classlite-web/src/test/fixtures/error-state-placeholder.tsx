import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * ErrorStatePlaceholder — Story 1d-1 AC3.
 *
 * Pre-Epic-10 stand-in for the real `ErrorState` component (ships in
 * Epic 10 Story 10.4). Same lifecycle as `EmptyStatePlaceholder` — when
 * 10.4 lands, a find-replace swaps imports and this file is deleted.
 *
 * Shape mirrors `ErrorBoundary.tsx`'s `ErrorFallback` (alert role + i18n
 * heading + retry button via the shared `Button` primitive) so styling,
 * focus rings, and token usage stay in lockstep. Epic 10's real
 * `ErrorState` should subsume both consumers.
 *
 * Per UX-DR24 the message uses i18n keys passed in by the story; the
 * placeholder never hardcodes English. Stack traces / HTTP codes are
 * never surfaced here.
 */
export function ErrorStatePlaceholder({
  message,
  retryLabel,
  onRetry,
}: {
  message?: string
  retryLabel?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-10 text-center"
      data-testid="error-state-placeholder"
    >
      <h3 className="font-heading text-lg text-destructive">
        {message ?? t('app.errorBoundary.title')}
      </h3>
      {retryLabel && onRetry ? (
        <Button variant="destructive" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
