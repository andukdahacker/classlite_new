/**
 * SubmissionReviewPage — Story 5.5a Task 5 (AC1/AC5/AC11/AC14). The route entry for
 * `/assignments/:assignmentId/submission` — the full-bleed "review my submission"
 * surface. Reads the caller's own submission via `useSubmissionReview` (no write
 * side-effect — AC2), renders the Loading / Empty / Error trilogy (UX-1) with the
 * LOADING skeleton, routes the terminal states (404 → not-started, in_progress →
 * resume CTA), and mounts the read-back shell for a terminal submission. The page
 * identity is "review my submission" (D12), the quiet "grades not released" note is
 * secondary, and NO grade data renders anywhere (5-5b).
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { markResultSeen } from '@/lib/resultSeen'
import { useSubmissionReview } from './api/useSubmissionReview'
import { SubmissionReviewShell } from './components/SubmissionReviewShell'

/** Where the "not started / not submitted" CTAs point — the assignments list, from
 * which the correct skill-specific attempt route is reachable (the review payload
 * carries no skill for the not-started/in_progress cases). */
const ASSIGNMENTS_ROUTE = '/assignments'

/** Review-surface-shaped skeleton (AC11 — a skeleton, never a spinner). */
function ReviewSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="submission-review-skeleton"
      aria-busy="true"
      aria-label={t('submissionReview.loading')}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8"
    >
      <div className="h-8 w-1/2 animate-pulse rounded bg-[var(--cl-line)]" />
      <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--cl-line)]" />
      {/* Grade-block skeleton (AC12): the band-ring hero + criteria placeholders resolve
          BEFORE/with the essay below — never a lone grey pulse throbbing over a loaded
          essay. A skeleton, never a spinner. */}
      <div
        data-testid="submission-review-grade-skeleton"
        className="flex flex-col items-center gap-3"
      >
        <div className="size-32 animate-pulse rounded-full bg-[var(--cl-line)]" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--cl-line)]" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--cl-line)]" />
      </div>
      <div className="h-64 animate-pulse rounded bg-[var(--cl-line)]" />
    </div>
  )
}

/** How a failed read routes (AC11): a 404 is the "not started" empty state; a 403
 * is a non-retryable error; anything else (5xx / network) is retryable. */
type ErrorKind = 'notStarted' | 'nonRetryable' | 'retryable'

function classifyError(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'notStarted'
    if (error.status === 403) return 'nonRetryable'
  }
  return 'retryable'
}

export function SubmissionReviewPage() {
  const { assignmentId } = useParams()
  const { t } = useTranslation()
  const query = useSubmissionReview(assignmentId ?? '')
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Which assignment we have already moved focus for — so a background refetch
  // (query stays settled) never re-steals focus from what the student is reading.
  const focusedForRef = useRef<string | null>(null)

  // D10 — the submission is a resume-CTA case when the backend flags inProgress OR
  // the row is still in_progress (belt-and-suspenders: both are set together server-
  // side, but the status is the ground truth the terminal read-back must never render).
  const inProgress =
    query.isSuccess &&
    (query.data.result.inProgress ||
      query.data.result.submission.status === 'in_progress')

  // D-DISCOVERY (AC15): when a RELEASED result is opened, clear its "new result"
  // unread indicator on the /assignments list. Keyed by assignmentId ONLY — the 5.2c
  // list row carries no `gradedAt`, so page-write and list-read must align on the same
  // key (the re-grade-rearm limitation is tracked in FU-5-5b-DISCOVERY).
  const resultReleased =
    query.isSuccess && query.data.result.released && query.data.result.grade !== null
  useEffect(() => {
    if (resultReleased) markResultSeen(assignmentId ?? '')
  }, [resultReleased, assignmentId])

  // DOM side-effects (FW-4 permits imperative DOM ops in useEffect): title for the
  // SR route-change announcement, and focus the heading once the read-back mounts.
  useEffect(() => {
    document.title = t('submissionReview.heading')
  }, [t])
  // AC14: focus the settled heading on load for SR route-change — once per
  // assignment, for whichever settled state renders (terminal read-back, not-
  // started, resume, or error), never re-stealing focus on a background refetch.
  useEffect(() => {
    const key = assignmentId ?? ''
    if (!query.isPending && focusedForRef.current !== key) {
      focusedForRef.current = key
      headingRef.current?.focus()
    }
  }, [query.isPending, assignmentId])

  const backLink = (
    <Link
      to={ASSIGNMENTS_ROUTE}
      data-testid="submission-review-back"
      className="self-start text-sm text-[var(--cl-ink-soft)] hover:text-[var(--cl-ink)]"
    >
      ← {t('submissionReview.back')}
    </Link>
  )

  let body: React.ReactNode
  if (query.isPending) {
    body = <ReviewSkeleton />
  } else if (query.isError) {
    const kind = classifyError(query.error)
    if (kind === 'notStarted') {
      body = (
        <div
          role="status"
          data-testid="submission-review-not-started"
          className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-[var(--cl-font-display)] text-xl text-[var(--cl-ink)] outline-none"
          >
            {t('submissionReview.notStarted.title')}
          </h1>
          <p className="text-[var(--cl-ink-soft)]">
            {t('submissionReview.notStarted.body')}
          </p>
          <Link
            to={ASSIGNMENTS_ROUTE}
            data-testid="submission-review-not-started-cta"
            className="text-sm font-medium text-[var(--cl-accent)] underline"
          >
            {t('submissionReview.notStarted.cta')}
          </Link>
        </div>
      )
    } else {
      body = (
        <div
          role="alert"
          data-testid="submission-review-error"
          className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-[var(--cl-font-display)] text-xl text-[var(--cl-ink)] outline-none"
          >
            {t('submissionReview.error.title')}
          </h1>
          <p className="text-[var(--cl-ink-soft)]">{t('submissionReview.error.body')}</p>
          {kind === 'retryable' ? (
            <Button
              type="button"
              onClick={() => void query.refetch()}
              data-testid="submission-review-retry"
            >
              {t('submissionReview.error.retry')}
            </Button>
          ) : null}
        </div>
      )
    }
  } else if (inProgress) {
    // D10 — the in_progress short-circuit: a resume CTA, never the terminal leaves.
    body = (
      <div
        role="status"
        data-testid="submission-review-resume"
        className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
      >
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-[var(--cl-font-display)] text-xl text-[var(--cl-ink)] outline-none"
        >
          {t('submissionReview.notSubmitted.title')}
        </h1>
        <Link
          to={ASSIGNMENTS_ROUTE}
          data-testid="submission-review-resume-cta"
          className="text-sm font-medium text-[var(--cl-accent)] underline"
        >
          {t('submissionReview.notSubmitted.cta')}
        </Link>
      </div>
    )
  } else {
    const { result, serverTime } = query.data
    // Terminal → the backend guarantees a stripped exercise; narrow it (no `!`) and
    // fall through to the error card on the impossible null rather than crash.
    const exercise = result.exercise
    body = exercise ? (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        {backLink}
        <h1
          ref={headingRef}
          tabIndex={-1}
          data-testid="submission-review-heading"
          className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)] outline-none"
        >
          {t('submissionReview.heading')}
        </h1>
        <SubmissionReviewShell
          key={assignmentId ?? ''}
          assignmentId={assignmentId ?? ''}
          submission={result.submission}
          exercise={exercise}
          released={result.released}
          grade={result.grade}
          audioUrl={result.audioUrl}
          serverTime={serverTime}
        />
      </div>
    ) : (
      <div
        role="alert"
        data-testid="submission-review-error"
        className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
      >
        <h1 className="font-[var(--cl-font-display)] text-xl text-[var(--cl-ink)]">
          {t('submissionReview.error.title')}
        </h1>
        <p className="text-[var(--cl-ink-soft)]">{t('submissionReview.error.body')}</p>
        <Button
          type="button"
          onClick={() => void query.refetch()}
          data-testid="submission-review-retry"
        >
          {t('submissionReview.error.retry')}
        </Button>
      </div>
    )
  }

  return (
    <main
      data-testid="submission-review-page"
      className="min-h-screen bg-[var(--cl-paper)]"
    >
      {body}
    </main>
  )
}
