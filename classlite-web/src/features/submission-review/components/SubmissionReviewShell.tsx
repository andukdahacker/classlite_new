/**
 * SubmissionReviewShell — Story 5.5a Task 5 + Story 5.5b Task 4. The terminal read-back
 * surface. In the pre-grade baseline it renders the quiet "grades not released" note +
 * the neutral badge, then the skill-dispatched read-back as the hero. When the grade is
 * RELEASED (`released === true` && `grade` non-null) for a WRITING submission, it
 * renders the `StudentGradeBlock` hero ABOVE the read-back, suppresses the
 * `NotReleasedNote`, and swaps the plain writing read-back for the highlighted
 * `GradedEssay` — the graded hero + the essay below read as ONE document (AC1/AC12).
 * `released` is the SOLE gate (D2): never branch on `submission.status`.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import type { components } from '@/lib/api/client'
import { NotReleasedNote } from './NotReleasedNote'
import { SubmissionStatusBadge } from './SubmissionStatusBadge'
import { ResultWritingReadback } from './ResultWritingReadback'
import { ResultQuizReceipt } from './ResultQuizReceipt'
import { ResultSpeakingPlayback } from './ResultSpeakingPlayback'
import { StudentGradeBlock } from './StudentGradeBlock'
import { GradedEssay } from './GradedEssay'

type Submission = components['schemas']['Submission']
type AttemptExercise = components['schemas']['AttemptExercise']
type StudentGradeView = components['schemas']['StudentGradeView']

export interface SubmissionReviewShellProps {
  assignmentId: string
  submission: Submission
  exercise: AttemptExercise
  /** Grade release flag (D2 — the SOLE gate; never `submission.status`). */
  released: boolean
  /** The released student-safe grade, or null when not released / invalid. */
  grade: StudentGradeView | null
  /** Inline first-paint audio URL (speaking only; null otherwise). */
  audioUrl: string | null
  /** Server clock from the result envelope — the audio-freshness anchor. */
  serverTime: string
}

function ReadBack({
  assignmentId,
  submission,
  exercise,
  audioUrl,
  serverTime,
}: SubmissionReviewShellProps) {
  switch (exercise.skill) {
    case 'writing':
      return <ResultWritingReadback submission={submission} />
    case 'speaking':
      return (
        <ResultSpeakingPlayback
          assignmentId={assignmentId}
          submission={submission}
          audioUrl={audioUrl}
          audioUrlMintedAt={serverTime}
        />
      )
    default:
      // reading / listening / vocabulary / grammar / general → the quiz receipt.
      return <ResultQuizReceipt submission={submission} exercise={exercise} />
  }
}

/** The non-writing released state (D6 — only writing can be released in v1; speaking
 * 6.3 / quiz 6.4 grade layouts are follow-ups). The IELTS-criteria / essay-anchor
 * machinery is NEVER fed a non-writing grade — `buildEssayHtml` is not called here. */
function GradeComingSoon() {
  const { t } = useTranslation()
  return (
    <p
      data-testid="student-grade-coming-soon"
      className="rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] bg-[var(--cl-surface)] px-4 py-3 text-sm text-[var(--cl-ink-soft)]"
    >
      {t('submissionReview.grade.comingSoon')}
    </p>
  )
}

export function SubmissionReviewShell(props: SubmissionReviewShellProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()

  const isWriting = props.exercise.skill === 'writing'
  // `released && grade === null` is a type-allowed contradiction → treat as pending
  // (render the NotReleasedNote path), never an empty grade block (AC12 invalid-state).
  const hasGrade = props.released && props.grade !== null
  const showWritingGrade = hasGrade && isWriting
  const showComingSoon = hasGrade && !isWriting
  const graded = showWritingGrade || showComingSoon

  return (
    <div data-testid="submission-review-shell" className="flex flex-col">
      <div
        data-testid={
          isDesktop
            ? 'submission-review-shell-desktop'
            : 'submission-review-shell-mobile'
        }
        className={cn('flex flex-col gap-6', isDesktop ? 'gap-6' : 'gap-5')}
      >
        <div className="flex flex-col gap-3">
          {/* Suppress "grades not released yet" in the graded state — the student must
              NEVER see it above their band score (AC12 seam). */}
          {graded ? null : <NotReleasedNote />}
          <SubmissionStatusBadge submission={props.submission} />
        </div>
        {showWritingGrade && props.grade !== null ? (
          <StudentGradeBlock grade={props.grade} submission={props.submission} />
        ) : null}
        {showComingSoon ? <GradeComingSoon /> : null}
        <div
          data-testid="submission-review-readback"
          aria-label={t('submissionReview.readbackLabel')}
        >
          {showWritingGrade && props.grade !== null ? (
            <GradedEssay grade={props.grade} submission={props.submission} />
          ) : (
            <ReadBack {...props} />
          )}
        </div>
      </div>
    </div>
  )
}
