/**
 * LatePenaltyBreakdown — Story 5.5b Task 4 (AC9; FR-31). Composes the server-
 * authoritative numbers into the exact FR-31 string:
 *   "Original: 6.0 − Late penalty: 0.5 = Final: 5.5"
 * The client only ARRANGES numbers it is given — `grade.overallBand` (the pure IELTS
 * mean, NOT penalty-adjusted by the backend) minus `submission.appliedPenalty` (the
 * immutable submit-time snapshot). Framed FACTUALLY, never alarmed / never red. When
 * on-time or `appliedPenalty === 0` the component renders NOTHING — a phantom
 * "Late penalty: 0.0" line accuses an on-time student of a crime they didn't commit.
 */
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'

type Submission = components['schemas']['Submission']

export interface LatePenaltyBreakdownProps {
  submission: Submission
  /** The server-authoritative overall band (the "Original" — not penalty-adjusted). */
  overallBand: number
}

export function LatePenaltyBreakdown({ submission, overallBand }: LatePenaltyBreakdownProps) {
  const { t } = useTranslation()
  // Gate: absent unless the submission is late AND carries a real penalty (AC9).
  if (!submission.isLate || submission.appliedPenalty <= 0) return null

  const original = overallBand
  const penalty = submission.appliedPenalty
  const final = Math.max(0, original - penalty)

  return (
    <div
      data-testid="student-grade-penalty"
      data-tone="muted"
      className="flex flex-col gap-1 rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] bg-[var(--cl-surface)] px-4 py-3 text-[var(--cl-ink-soft)]"
    >
      <p className="font-mono text-sm text-[var(--cl-ink)]">
        {t('submissionReview.grade.penaltyBreakdown', {
          original: original.toFixed(1),
          penalty: penalty.toFixed(1),
          final: final.toFixed(1),
        })}
      </p>
      <p className="text-xs">{t('submissionReview.grade.penaltyExplainer')}</p>
    </div>
  )
}
