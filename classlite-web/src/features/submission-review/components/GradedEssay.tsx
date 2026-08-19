/**
 * GradedEssay — Story 5.5b Task 3/Task 5 (AC6/AC7/AC7a/AC10). The student's own essay
 * with each anchored comment painted as an inline `<mark>` via 6.1's SHARED
 * `buildEssayHtml` (UTF-16-safe, XSS-safe, SafeHtml-branded — byte-identical to the
 * teacher), plus the read-only comment cards. This REPLACES the plain
 * `ResultWritingReadback` when the grade is released — a single, highlighted essay copy
 * fed the SAME `readWritingText(submission)` (no re-index, no second copy).
 *
 * Reciprocity read-only: clicking a highlight scrolls its card into view
 * (`data-anchor-index` → `comment-card-{index}`). Whole-essay (null/null) and
 * demoted comments collapse into a "General notes" group so no teacher comment
 * silently vanishes (AC7a). Desktop = essay + side rail; mobile (s79) = comments
 * stacked full-width below the essay (NOT a cramped rail).
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { buildEssayHtml } from '@/lib/essayAnchors'
import { CommentCard } from '@/components/domain/CommentCard'
import type { components } from '@/lib/api/client'
import { readWritingText } from '../lib/submissionContent'
import {
  anchoredComments,
  prepareComments,
  toEssayAnchors,
  wholeEssayComments,
  type PreparedComment,
} from '../lib/gradeComments'

type StudentGradeView = components['schemas']['StudentGradeView']
type Submission = components['schemas']['Submission']

export interface GradedEssayProps {
  grade: StudentGradeView
  submission: Submission
}

/** A single read-only comment card (shared CommentCard in `readOnly` mode). */
function GradedCommentCard({ comment }: { comment: PreparedComment }) {
  return (
    <CommentCard
      readOnly
      type={comment.cardType}
      criterionKey={comment.criterionKey}
      body={comment.text}
      testIdSlug={String(comment.index)}
    />
  )
}

/** The "General notes" group (whole-essay + demoted comments), pinned so every
 * teacher comment stays reachable even without a line to anchor under (AC7a). */
function GeneralNotes({ comments }: { comments: PreparedComment[] }) {
  const { t } = useTranslation()
  if (comments.length === 0) return null
  return (
    <section
      data-testid="student-grade-general-notes"
      aria-label={t('submissionReview.grade.generalNotes')}
      className="flex flex-col gap-2"
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--cl-ink-soft)]">
        {t('submissionReview.grade.generalNotes')}
      </h3>
      <ul className="flex flex-col gap-2">
        {comments.map((comment) => (
          <li key={comment.index}>
            <GradedCommentCard comment={comment} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function GradedEssay({ grade, submission }: GradedEssayProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const rootRef = useRef<HTMLDivElement>(null)

  const essayText = readWritingText(submission)
  const prepared = prepareComments(grade.comments, essayText)
  const anchored = anchoredComments(prepared)
  const whole = wholeEssayComments(prepared)
  // Only NORMALIZED anchors reach the builder — identical demotion on both sides.
  const essayHtml = buildEssayHtml(essayText, toEssayAnchors(prepared))

  /** Reciprocity read-only: a highlight click scrolls its card into view. */
  function onEssayClick(event: React.MouseEvent<HTMLElement>) {
    const mark = (event.target as HTMLElement).closest('[data-anchor-index]')
    if (!mark) return
    const index = mark.getAttribute('data-anchor-index')
    if (index === null) return
    const card = rootRef.current?.querySelector<HTMLElement>(
      `[data-testid="comment-card-${index}"]`,
    )
    if (!card) return
    try {
      card.scrollIntoView({ block: 'nearest' })
    } catch {
      // jsdom / no-layout — scroll is a visual nicety, not load-bearing.
    }
  }

  const essay = (
    <article
      data-testid="graded-essay-text"
      aria-label={t('submissionReview.essay.label')}
      data-mobile-legible="true"
      onClick={onEssayClick}
      // The essay text is HTML-escaped by buildEssayHtml before any <mark>; the value
      // is branded SafeHtml. Teacher comment text is escaped inside the builder too.
      dangerouslySetInnerHTML={{ __html: essayHtml }}
      className="whitespace-pre-wrap rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] bg-[var(--cl-surface)] p-4 text-base leading-relaxed text-[var(--cl-ink)]"
    />
  )

  const anchoredCards =
    anchored.length > 0 ? (
      <ol
        aria-label={t('submissionReview.grade.commentsLabel')}
        className="flex flex-col gap-2"
      >
        {anchored.map((comment) => (
          <li key={comment.index}>
            <GradedCommentCard comment={comment} />
          </li>
        ))}
      </ol>
    ) : null

  return (
    <div ref={rootRef} className="flex flex-col gap-3" data-testid="graded-essay">
      {isDesktop ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
          {essay}
          <div
            data-testid="graded-essay-rail"
            className="flex flex-col gap-3"
          >
            <GeneralNotes comments={whole} />
            {anchoredCards}
          </div>
        </div>
      ) : (
        <div className={cn('flex flex-col gap-3')}>
          {/* Mobile s79: General notes ABOVE the essay; anchored comments stacked
              full-width BELOW it (not a side rail). */}
          <GeneralNotes comments={whole} />
          {essay}
          <div
            data-testid="graded-essay-comments-mobile"
            className="flex flex-col gap-2"
          >
            {anchoredCards}
          </div>
        </div>
      )}
    </div>
  )
}
