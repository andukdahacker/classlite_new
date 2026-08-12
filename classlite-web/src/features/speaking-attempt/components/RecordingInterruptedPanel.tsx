/**
 * RecordingInterruptedPanel — Story 5.4 Task 6 (AC11, Sally B2 — the mobile-PRIMARY
 * case). Shown when the mic was seized mid-take (an incoming call / Siri / another
 * app, or a permission revoke). Distinct from the cold-denial panel (AC10): the
 * recording stopped cleanly and the partial was dropped, so the message is a calm
 * "recording interrupted — tap to record again", not a permission lecture.
 */
import { useTranslation } from 'react-i18next'

export interface RecordingInterruptedPanelProps {
  /** Re-arm the mic to record again. Omitted under a read-only lock (no re-arm). */
  onRetry?: () => void
}

export function RecordingInterruptedPanel({ onRetry }: RecordingInterruptedPanelProps) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      data-testid="speaking-interrupted-panel"
      className="flex flex-col items-center gap-3 rounded-md border border-[color:var(--cl-line-soft)] bg-[color:var(--cl-tint-red)] p-4 text-center"
    >
      <h2 className="text-base font-semibold text-[color:var(--cl-ink)]">
        {t('speaking.interrupted.title')}
      </h2>
      <p className="max-w-sm text-sm text-[color:var(--cl-ink-soft)]">
        {t('speaking.interrupted.body')}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="speaking-interrupted-retry"
          className="min-h-12 rounded-md bg-[color:var(--cl-red)] px-4 text-base font-medium text-white hover:opacity-90"
        >
          {t('speaking.interrupted.retry')}
        </button>
      ) : null}
    </div>
  )
}
