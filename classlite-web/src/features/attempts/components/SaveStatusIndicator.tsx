/**
 * SaveStatusIndicator — Story 5.2b Task 7 (AC12, Sally-B1), moved to the shared
 * `attempts` module in Story 5.2d (AC3). The PROMINENT inline autosave indicator
 * (Saving / Saved / Unsaved / Error / Offline). `aria-live="polite"` announces
 * transitions; a failed save is a prominent inline warning, never a corner chip.
 * Reads the UI-only `saveStatus` from the shared attempt store.
 *
 * The `offline` branch is forward-ready for 5.3's offline autosave (AC3): quiz
 * never emits it, but the branch + its `attempt.save.offline` copy ship now so
 * writing consumes a stable indicator.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  useAttemptStore,
  type AttemptSaveStatus,
} from '@/stores/attemptStore'

const LABEL_KEY: Record<AttemptSaveStatus, string | null> = {
  idle: null,
  saving: 'attempt.save.saving',
  saved: 'attempt.save.saved',
  unsaved: 'attempt.save.unsaved',
  error: 'attempt.save.error',
  offline: 'attempt.save.offline',
}

export function SaveStatusIndicator() {
  const { t } = useTranslation()
  const status = useAttemptStore((s) => s.saveStatus)
  const labelKey = LABEL_KEY[status]

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('attempt.save.label')}
      data-testid="save-status"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium',
        status === 'error' && 'text-[var(--cl-danger)]',
        status === 'offline' && 'text-[var(--cl-amber)]',
        status === 'saved' && 'text-[var(--cl-ink-soft)]',
        (status === 'saving' || status === 'unsaved') && 'text-[var(--cl-ink)]',
      )}
    >
      {labelKey ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              status === 'saving' && 'animate-pulse bg-[var(--cl-accent)]',
              status === 'saved' && 'bg-[var(--cl-success)]',
              status === 'unsaved' && 'bg-[var(--cl-ink-soft)]',
              status === 'error' && 'bg-[var(--cl-danger)]',
              status === 'offline' && 'bg-[var(--cl-amber)]',
            )}
          />
          {t(labelKey)}
        </>
      ) : null}
    </div>
  )
}
