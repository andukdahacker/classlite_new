/**
 * SubmissionReviewShell — Story 5.5a Task 5. The terminal read-back surface: the
 * quiet "grades not released" note + the neutral on-time/late badge, then the
 * skill-dispatched read-back as the HERO (writing pre-wrap · quiz receipt ·
 * speaking playback). Single tree per breakpoint (`useIsDesktop`) — only the
 * variant marker + spacing differ; the genuine mobile investment lives inside the
 * read-back leaves (audio touch target, reading measure). NO class average, NO
 * band / score / feedback (grade data is 5-5b).
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

type Submission = components['schemas']['Submission']
type AttemptExercise = components['schemas']['AttemptExercise']

export interface SubmissionReviewShellProps {
  assignmentId: string
  submission: Submission
  exercise: AttemptExercise
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

export function SubmissionReviewShell(props: SubmissionReviewShellProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
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
          <NotReleasedNote />
          <SubmissionStatusBadge submission={props.submission} />
        </div>
        <div data-testid="submission-review-readback" aria-label={t('submissionReview.readbackLabel')}>
          <ReadBack {...props} />
        </div>
      </div>
    </div>
  )
}
