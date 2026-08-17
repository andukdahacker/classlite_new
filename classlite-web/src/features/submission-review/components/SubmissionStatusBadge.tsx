/**
 * SubmissionStatusBadge — Story 5.5a Task 5 (AC6/D5). A NEUTRAL on-time / late
 * badge derived from `submission.isLate`. On-time renders an explicit calm
 * "Submitted on time" (never a blank); late renders "Submitted after the due date"
 * plus a quiet reassurance note — muted, NEVER red/alarm, and with NO penalty
 * number (the penalty math is 5-5b). Laid out at Vietnamese length (min-width +
 * wrap) so a longer VN string never clips.
 */
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'

type Submission = components['schemas']['Submission']

export interface SubmissionStatusBadgeProps {
  submission: Submission
}

export function SubmissionStatusBadge({ submission }: SubmissionStatusBadgeProps) {
  const { t } = useTranslation()
  const late = submission.isLate
  return (
    <div className="flex flex-col gap-1">
      <span
        data-testid="submission-status-badge"
        data-tone="muted"
        className="inline-flex min-w-[7rem] max-w-full items-center justify-center whitespace-normal rounded-[var(--cl-radius-full)] border border-[var(--cl-line)] px-3 py-1 text-center text-sm text-[var(--cl-ink-soft)]"
      >
        {late
          ? t('submissionReview.status.late')
          : t('submissionReview.status.onTime')}
      </span>
      {late ? (
        <p
          data-testid="submission-review-late-note"
          className="text-xs text-[var(--cl-ink-soft)]"
        >
          {t('submissionReview.status.lateNote')}
        </p>
      ) : null}
    </div>
  )
}
