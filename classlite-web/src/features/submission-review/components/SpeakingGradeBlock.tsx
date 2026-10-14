/**
 * SpeakingGradeBlock — Story 11-5a AC4 (FU-11-5A-SPEAKING-GRADEVIEW). The speaking
 * analog of `StudentGradeBlock`: the circular band-ring hero + the four IELTS Speaking
 * per-criterion bars (fluencyCoherence / lexicalResource / grammaticalRange /
 * pronunciation), the teacher feedback quote, the neutral late-penalty math, and the
 * one-way acknowledgment line. It sits ABOVE the `ResultSpeakingPlayback` read-back.
 *
 * Unlike the writing block it carries NO essay-anchor machinery: speaking comments are
 * audio-timestamped (a distinct wire shape) and are NOT rendered here (parity with the
 * writing block's scope at first ship — timestamped-comment rendering is a follow-up).
 * It NEVER recomputes the band (`grade.overallBand` is server-authoritative).
 */
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { isSpeakingScores } from '../lib/gradeComments'
import { FeedbackQuoteBox } from './FeedbackQuoteBox'
import { LatePenaltyBreakdown } from './LatePenaltyBreakdown'

type StudentGradeView = components['schemas']['StudentGradeView']
type Submission = components['schemas']['Submission']
type SpeakingCriterionScores = components['schemas']['SpeakingCriterionScores']

/** The four IELTS Speaking criterion keys, in canonical (spec) order. */
const SPEAKING_CRITERION_KEYS: readonly (keyof SpeakingCriterionScores)[] = [
  'fluencyCoherence',
  'lexicalResource',
  'grammaticalRange',
  'pronunciation',
]

export interface SpeakingGradeBlockProps {
  grade: StudentGradeView
  submission: Submission
}

/** One decimal, mirroring `formatBand` in StudentGradeBlock. */
function formatBand(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

export function SpeakingGradeBlock({ grade, submission }: SpeakingGradeBlockProps) {
  const { t } = useTranslation()
  // The shell renders this block for speaking only; narrow the skill-polymorphic
  // criterionScores union (Story 11-5a AC4) to the speaking shape. A writing grade is
  // routed to StudentGradeBlock and never reaches here (defensive null fallback).
  const criterionScores = isSpeakingScores(grade.criterionScores)
    ? grade.criterionScores
    : null
  const bandText = formatBand(grade.overallBand)
  if (criterionScores === null) return null

  return (
    <section
      data-testid="student-grade-block-speaking"
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

      {/* Per-criterion breakdown — neutral fill bars, no essay-pin machinery. */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-[var(--cl-ink-soft)]">
          {t('submissionReview.grade.criteriaLabel')}
        </h3>
        <ul className="flex flex-col gap-2">
          {SPEAKING_CRITERION_KEYS.map((key) => {
            const score = criterionScores[key]
            return (
              <li
                key={key}
                data-testid={`student-grade-criterion-${key}`}
                className="flex flex-col gap-1 rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] px-3 py-2"
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
              </li>
            )
          })}
        </ul>
      </div>

      <LatePenaltyBreakdown submission={submission} overallBand={grade.overallBand} />

      <FeedbackQuoteBox feedback={grade.feedback} />

      {/* D-ACK — one quiet, honest line that the comment channel is one-way here. */}
      <p data-testid="student-grade-ack" className="text-sm text-[var(--cl-ink-soft)]">
        {t('submissionReview.grade.ackSpeaking')}
      </p>
    </section>
  )
}
