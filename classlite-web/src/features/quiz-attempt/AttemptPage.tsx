/**
 * AttemptPage — Story 5.2b (AC1/AC16/AC23). The route entry for
 * `/assignments/:assignmentId/attempt`. Runs the two-call bootstrap
 * (`useAttemptBootstrap`), renders the Loading / Empty / Error trilogy (UX-1),
 * reconciles the localStorage mirror into the draft cache on load (AC22), and
 * mounts the `ExerciseAttemptShell`. A terminal/locked start and the post-submit
 * receipt route to the confirmation end-state (AC23) — never a raw error page or
 * a bare placeholder.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import {
  useAttemptBootstrap,
  reconcileStoredDraftIntoCache,
  SubmissionConfirmation,
} from '@/features/attempts'
import { useAttemptStore } from '@/stores/attemptStore'
import { useQuizAttemptStore } from '@/stores/quizAttemptStore'
import { ExerciseAttemptShell } from './components/ExerciseAttemptShell'
import { quizReconcileConfig } from './lib/quizDraftReconcile'

/** Split-pane-shaped skeleton (AC16 — not a spinner). */
function AttemptSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="attempt-skeleton"
      aria-busy="true"
      aria-label={t('attempt.loading.label')}
      className="flex min-h-screen flex-col bg-[var(--cl-paper)]"
    >
      <div className="h-12 border-b border-[var(--cl-line)] bg-[var(--cl-surface)]" />
      <div className="flex flex-1">
        <div className="hidden w-[45%] flex-col gap-3 p-4 md:flex">
          <div className="h-6 w-1/2 animate-pulse rounded bg-[var(--cl-line)]" />
          <div className="h-40 animate-pulse rounded bg-[var(--cl-line)]" />
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="h-10 animate-pulse rounded bg-[var(--cl-line)]" />
          <div className="h-10 animate-pulse rounded bg-[var(--cl-line)]" />
          <div className="h-10 animate-pulse rounded bg-[var(--cl-line)]" />
        </div>
      </div>
    </div>
  )
}

function AttemptErrorState({
  bodyKey,
  onRetry,
}: {
  bodyKey: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      data-testid="attempt-error"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="text-[var(--cl-ink)]">{t(bodyKey)}</p>
      {onRetry ? (
        <Button type="button" onClick={onRetry} data-testid="attempt-error-retry">
          {t('attempt.error.retry')}
        </Button>
      ) : null}
    </div>
  )
}

/** Map a bootstrap ApiError to a trilogy outcome. */
function errorBodyKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'attempt.error.notFound'
    if (error.status === 403 && error.code === 'NOT_ENROLLED')
      return 'attempt.error.notEnrolled'
    if (error.status === 409 && error.code === 'SUBMISSION_LOCKED')
      return 'attempt.readonly.locked'
  }
  return 'attempt.error.body'
}

export function AttemptPage() {
  const { assignmentId } = useParams()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)

  const query = useAttemptBootstrap(assignmentId ?? '')

  // Reset the UI-only stores on entering a fresh attempt (TEST-FE-3 hygiene).
  // Two stores after the 5.2d split: the quiz UI store (navigator/split) + the
  // shared save-status store.
  const resetQuizStore = useQuizAttemptStore((s) => s.reset)
  const resetAttemptStore = useAttemptStore((s) => s.reset)
  useEffect(() => {
    resetQuizStore()
    resetAttemptStore()
  }, [assignmentId, resetQuizStore, resetAttemptStore])

  // Reconcile the localStorage mirror into the draft cache once the bundle lands
  // (AC22). This is a cache seed + toast side-effect (not data fetching), so an
  // effect is the right home.
  const seededFor = useRef<string | null>(null)
  const data = query.data
  useEffect(() => {
    if (!data) return
    if (seededFor.current === data.submissionId) return
    seededFor.current = data.submissionId
    const result = reconcileStoredDraftIntoCache(
      queryClient,
      data.submissionId,
      data.bundle.submission.content,
      quizReconcileConfig,
    )
    if (result.conflict.hadConflict) toast.info(t('attempt.draft.conflictToast'))
    else if (result.conflict.recoveredLocalOnly)
      toast.info(t('attempt.draft.recoveredToast'))
  }, [data, queryClient, t])

  if (submitted) return <SubmissionConfirmation />

  if (query.isPending) return <AttemptSkeleton />

  if (query.isError) {
    // A terminal submission already exists → the confirmation end-state (AC1/AC23).
    if (
      query.error instanceof ApiError &&
      query.error.status === 409 &&
      query.error.code === 'SUBMISSION_EXISTS'
    ) {
      return <SubmissionConfirmation />
    }
    const bodyKey = errorBodyKey(query.error)
    // Only a transient failure (network / 5xx) is worth retrying. Any 4xx —
    // 403 INSUFFICIENT_ROLE, an unknown terminal 409, 404 — is deterministic, so
    // offering Retry would just loop the same failure.
    const retryable =
      !(query.error instanceof ApiError) || query.error.status >= 500
    return (
      <AttemptErrorState
        bodyKey={bodyKey}
        onRetry={retryable ? () => void query.refetch() : undefined}
      />
    )
  }

  return (
    <ExerciseAttemptShell
      submissionId={data!.submissionId}
      bundle={data!.bundle}
      serverTime={data!.serverTime}
      perfAtLoad={data!.perfAtLoad}
      onSubmitted={() => setSubmitted(true)}
    />
  )
}

export default AttemptPage
