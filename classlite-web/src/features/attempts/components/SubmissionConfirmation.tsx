/**
 * SubmissionConfirmation — Story 5.2b Task 8 (AC23, Sally-S2 / John-b). The
 * post-submit end-state: a REAL confirmation receipt ("Your answers are
 * submitted ✓ · your teacher will release results") plus a safe primary action
 * (back to assignments) — never a bare "pending" placeholder / `<div>TODO</div>`.
 * The graded result view is Story 5.5.
 */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'

export function SubmissionConfirmation() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="submission-confirmation"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--cl-success)]/15 text-2xl text-[var(--cl-success)]"
      >
        ✓
      </div>
      <h1 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
        {t('attempt.done.title')}
      </h1>
      <p className="text-[var(--cl-ink-soft)]">{t('attempt.done.body')}</p>
      <Link
        to="/assignments"
        className={buttonVariants({ variant: 'default' })}
        data-testid="done-back-to-assignments"
      >
        {t('attempt.done.backToAssignments')}
      </Link>
    </div>
  )
}
