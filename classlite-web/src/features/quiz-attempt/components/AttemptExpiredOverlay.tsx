/**
 * AttemptExpiredOverlay — Story 5.2b Task 7 (AC20/AC14). The full-screen
 * "Time's up — submitting your answers" state that narrates the timer-expiry
 * finalize (never a silent blink). `aria-live="assertive"` so a screen reader
 * announces the takeover immediately.
 */
import { useTranslation } from 'react-i18next'

export function AttemptExpiredOverlay() {
  const { t } = useTranslation()
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={t('attempt.timer.expiredTitle')}
      data-testid="attempt-expired-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--cl-paper)]/95 px-6 text-center"
    >
      <div
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-2 border-[var(--cl-line)] border-t-[var(--cl-accent)]"
      />
      <h2 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
        {t('attempt.timer.expiredTitle')}
      </h2>
      <p className="text-[var(--cl-ink-soft)]">{t('attempt.timer.expiredBody')}</p>
    </div>
  )
}
