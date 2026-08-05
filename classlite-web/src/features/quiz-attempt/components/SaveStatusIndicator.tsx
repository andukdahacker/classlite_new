/**
 * SaveStatusIndicator — Story 5.2b Task 7 (AC12, Sally-B1). The PROMINENT inline
 * autosave indicator (Saving / Saved / Unsaved / Error). `aria-live="polite"`
 * announces transitions; a failed save is a prominent inline warning, never a
 * corner chip. Reads the UI-only `saveStatus` from the quiz-attempt store.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  useQuizAttemptStore,
  type AttemptSaveStatus,
} from '@/stores/quizAttemptStore'

const LABEL_KEY: Record<AttemptSaveStatus, string | null> = {
  idle: null,
  saving: 'attempt.save.saving',
  saved: 'attempt.save.saved',
  unsaved: 'attempt.save.unsaved',
  error: 'attempt.save.error',
}

export function SaveStatusIndicator() {
  const { t } = useTranslation()
  const status = useQuizAttemptStore((s) => s.saveStatus)
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
            )}
          />
          {t(labelKey)}
        </>
      ) : null}
    </div>
  )
}
