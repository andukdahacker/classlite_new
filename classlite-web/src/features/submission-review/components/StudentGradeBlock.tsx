/**
 * StudentGradeBlock — Story 5.5b Task 3 (AC3/AC4/AC5/AC9). The graded HERO that sits
 * ABOVE the read-back: the circular band-ring, the four per-criterion bars (each with
 * its pinned-comment count + the ONLY sanctioned red — an error-pin border), the
 * strength-first / focus-area coaching line, the teacher feedback quote, the neutral
 * late-penalty math, and the one-way acknowledgment line (D-ACK). It NEVER recomputes
 * the band (`grade.overallBand` is server-authoritative) and NEVER re-derives anchor
 * tone — the essay highlights live in the sibling `GradedEssay`.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/client'
import { readWritingText } from '../lib/submissionContent'
import {
  CRITERION_KEYS,
  criterionInsight,
  pinnedByCriterion,
  prepareComments,
} from '../lib/gradeComments'
import { FeedbackQuoteBox } from './FeedbackQuoteBox'
import { LatePenaltyBreakdown } from './LatePenaltyBreakdown'

type StudentGradeView = components['schemas']['StudentGradeView']
type Submission = components['schemas']['Submission']

export interface StudentGradeBlockProps {
  grade: StudentGradeView
  submission: Submission
}

/** One decimal, mirroring `formatBand` from WritingGradingSurface. */
function formatBand(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

export function StudentGradeBlock({ grade, submission }: StudentGradeBlockProps) {
  const { t } = useTranslation()
  const essayText = readWritingText(submission)
  const prepared = prepareComments(grade.comments, essayText)
  const pins = pinnedByCriterion(prepared)
  const insight = criterionInsight(grade.criterionScores)
  const bandText = formatBand(grade.overallBand)

  return (
    <section
      data-testid="student-grade-block"
      aria-label={t('submissionReview.grade.heading')}
      className="flex flex-col gap-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="font-[var(--cl-font-display)] text-xl text-[var(--cl-ink)]">
          {t('submissionReview.grade.heading')}
        </h2>
      </header>

      {/* Band-ring hero — appears, does not perform. One neutral ink stroke for every
          band (never tinted); static (no count-up, no sweep-fill). */}
      <div className="flex flex-col items-center gap-2">
        <div
          data-testid="student-grade-band-ring"
          role="img"
          aria-label={t('submissionReview.grade.bandAria', { band: bandText })}
          className="flex size-32 flex-col items-center justify-center rounded-full border-4 border-[var(--cl-line)] bg-[var(--cl-surface)]"
        >
          <span
            data-testid="student-grade-band-value"
            aria-hidden="true"
            className="font-mono text-4xl leading-none text-[var(--cl-ink)]"
          >
            {bandText}
          </span>
          <span aria-hidden="true" className="mt-1 text-[0.625rem] uppercase tracking-wide text-[var(--cl-ink-soft)]">
            {t('submissionReview.grade.overallBandLabel')}
          </span>
        </div>
      </div>

      {/* Per-criterion breakdown — strength-first, with pinned counts + error border. */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-[var(--cl-ink-soft)]">
          {t('submissionReview.grade.criteriaLabel')}
        </h3>
        <ul className="flex flex-col gap-2">
          {CRITERION_KEYS.map((key) => {
            const score = grade.criterionScores[key]
            const pin = pins[key]
            return (
              <li
                key={key}
                data-testid={`student-grade-criterion-${key}`}
                data-has-error={pin.hasError ? 'true' : 'false'}
                className={cn(
                  'flex flex-col gap-1 rounded-[var(--cl-radius-md)] border px-3 py-2',
                  pin.hasError
                    ? 'border-l-4 border-l-destructive border-[var(--cl-line)]'
                    : 'border-[var(--cl-line)]',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-[var(--cl-ink)]" lang="en">
                    {t(`criterion.${key}`)}
                  </span>
                  <span
                    data-testid={`student-grade-criterion-${key}-value`}
                    className="font-mono text-sm text-[var(--cl-ink)]"
                  >
                    {formatBand(score)}
                  </span>
                </div>
                {/* Neutral fill bar — proportional, not tinted by band. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--cl-line)]">
                  <div
                    className="h-full rounded-full bg-[var(--cl-ink-soft)]"
                    style={{
                      // Guard non-finite scores → 0% (mirrors the `formatBand` guard);
                      // a malformed score must not emit an invalid `NaN%` width.
                      width: Number.isFinite(score)
                        ? `${Math.max(0, Math.min(100, (score / 9) * 100))}%`
                        : '0%',
                    }}
                  />
                </div>
                {pin.count > 0 ? (
                  <span
                    data-testid={`student-grade-criterion-${key}-pinned`}
                    className="text-xs text-[var(--cl-ink-soft)]"
                  >
                    {t('submissionReview.grade.pinned', { count: pin.count })}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>

        {/* Strength-first coaching line — a focus area is REQUIRED, but a uniform essay
            degrades to a single neutral "keep it up" line: naming an arbitrary "strongest"
            when all four scores tie manufactures the relative framing AC4 forbids. */}
        <div className="flex flex-col gap-1 text-sm">
          {insight.uniform ? (
            <p data-testid="student-grade-focus-area" className="text-[var(--cl-ink-soft)]">
              {t('submissionReview.grade.focusAreaUniform')}
            </p>
          ) : (
            <>
              <p data-testid="student-grade-strength" className="text-[var(--cl-ink)]">
                {t('submissionReview.grade.strength', {
                  criterion: t(`criterion.${insight.strongest}`),
                })}
              </p>
              <p data-testid="student-grade-focus-area" className="text-[var(--cl-ink-soft)]">
                {t('submissionReview.grade.focusArea', {
                  criterion: t(`criterion.${insight.weakest}`),
                })}
              </p>
            </>
          )}
        </div>
      </div>

      <LatePenaltyBreakdown submission={submission} overallBand={grade.overallBand} />

      <FeedbackQuoteBox feedback={grade.feedback} />

      {/* D-ACK — one quiet, honest line that the anchored-comment channel is one-way
          here (anchored-Q&A is Epic 7). NO reply-shaped affordance anywhere. */}
      <p data-testid="student-grade-ack" className="text-sm text-[var(--cl-ink-soft)]">
        {t('submissionReview.grade.ack')}
      </p>
    </section>
  )
}
