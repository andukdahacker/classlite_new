/**
 * FeedbackQuoteBox — Story 5.5b Task 3 (AC5). The teacher's overall feedback as an
 * attributed editorial quote. `feedback` is RAW teacher free-text → rendered as an
 * escaped React text node (NEVER `dangerouslySetInnerHTML`). No teacher identity is on
 * the wire (`StudentGradeView` excludes `graded_by`) — the attribution is generic.
 * Renders nothing when the feedback is null/empty (the caller still shows the ack line).
 */
import { useTranslation } from 'react-i18next'

export interface FeedbackQuoteBoxProps {
  /** Raw teacher free-text; escaped on render. */
  feedback: string | null
}

export function FeedbackQuoteBox({ feedback }: FeedbackQuoteBoxProps) {
  const { t } = useTranslation()
  if (feedback === null || feedback.trim() === '') return null
  return (
    <figure
      data-testid="student-grade-feedback"
      className="flex flex-col gap-2 rounded-[var(--cl-radius-md)] border-l-4 border-[var(--cl-line)] bg-[var(--cl-surface)] px-4 py-3"
    >
      <figcaption className="text-xs font-medium uppercase tracking-wide text-[var(--cl-ink-soft)]">
        {t('submissionReview.grade.feedbackLabel')}
      </figcaption>
      {/* Escaped text node — teacher free-text never becomes HTML (XSS). */}
      <blockquote className="text-base leading-relaxed text-[var(--cl-ink)]">
        {feedback}
      </blockquote>
      <cite className="text-sm not-italic text-[var(--cl-ink-soft)]">
        — {t('submissionReview.grade.feedbackAttribution')}
      </cite>
    </figure>
  )
}
