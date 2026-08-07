/**
 * WritingAttemptPage — Story 5.3 Task 7 (AC1/AC20). The route entry for
 * `/assignments/:assignmentId/write`. Runs the shared two-call bootstrap
 * (`useAttemptBootstrap`), renders the Loading / Empty / Error trilogy (UX-1),
 * reconciles the localStorage mirror into the draft cache ON LOAD (AC12, D4 —
 * local-newer-wins) and derives the seeded `initialText` for the UNCONTROLLED
 * editor leaf, then mounts `WritingAttemptShell`. A terminal/locked start and the
 * post-submit receipt route to the confirmation end-state (AC19) — never a raw
 * error page or a bare placeholder.
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
import { WritingAttemptShell } from './components/WritingAttemptShell'
import { writingReconcileConfig } from './lib/writingContent'

/** Writing-surface-shaped skeleton (AC20 — not a spinner). */
function WritingSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="writing-skeleton"
      aria-busy="true"
      aria-label={t('attempt.loading.label')}
      className="flex min-h-screen flex-col bg-[var(--cl-paper)]"
    >
      <div className="h-12 border-b border-[var(--cl-line)] bg-[var(--cl-surface)]" />
      <div className="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-4 px-4">
        <div className="h-8 w-1/3 animate-pulse rounded bg-[var(--cl-line)]" />
        <div className="h-24 animate-pulse rounded bg-[var(--cl-line)]" />
        <div className="h-72 animate-pulse rounded bg-[var(--cl-line)]" />
      </div>
    </div>
  )
}

function WritingErrorState({
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
      data-testid="writing-error"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="text-[var(--cl-ink)]">{t(bodyKey)}</p>
      {onRetry ? (
        <Button type="button" onClick={onRetry} data-testid="writing-error-retry">
          {t('attempt.error.retry')}
        </Button>
      ) : null}
    </div>
  )
}

/** Map a bootstrap ApiError to a trilogy outcome (AC20). */
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

export function WritingAttemptPage() {
  const { assignmentId } = useParams()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)

  const query = useAttemptBootstrap(assignmentId ?? '')

  // Reset the shared save-status store on entering a fresh attempt (TEST-FE-3).
  const resetAttemptStore = useAttemptStore((s) => s.reset)
  useEffect(() => {
    resetAttemptStore()
  }, [assignmentId, resetAttemptStore])

  // Reconcile the localStorage mirror into the draft cache once the bundle lands
  // (AC12, D4 local-newer-wins) and derive the seeded `initialText` for the
  // uncontrolled leaf. A cache seed + toast side-effect (not data fetching), so an
  // effect is the right home; the shell is gated on `initialText` so the leaf's
  // `defaultValue` seeds from the recovered text, never a pre-reconcile blank.
  const seededFor = useRef<string | null>(null)
  const [initialText, setInitialText] = useState<string | null>(null)
  const data = query.data
  useEffect(() => {
    if (!data) return
    if (seededFor.current === data.submissionId) return
    seededFor.current = data.submissionId
    const result = reconcileStoredDraftIntoCache(
      queryClient,
      data.submissionId,
      data.bundle.submission.content,
      writingReconcileConfig,
    )
    setInitialText(result.merged.text)
    if (result.conflict.recoveredLocalNewer) {
      toast.info(t('writing.draft.recoveredToast'))
    }
  }, [data, queryClient, t])

  if (submitted) return <SubmissionConfirmation />

  if (query.isPending) return <WritingSkeleton />

  if (query.isError) {
    // A terminal submission already exists → the confirmation end-state (AC1).
    if (
      query.error instanceof ApiError &&
      query.error.status === 409 &&
      query.error.code === 'SUBMISSION_EXISTS'
    ) {
      return <SubmissionConfirmation />
    }
    const bodyKey = errorBodyKey(query.error)
    // Only a transient failure (network / 5xx) is worth retrying; any 4xx is
    // deterministic, so offering Retry would just loop the same failure (AC20).
    const retryable =
      !(query.error instanceof ApiError) || query.error.status >= 500
    return (
      <WritingErrorState
        bodyKey={bodyKey}
        onRetry={retryable ? () => void query.refetch() : undefined}
      />
    )
  }

  // Bundle is loaded; wait one tick for the synchronous reconcile to seed the
  // uncontrolled leaf's initial text.
  if (initialText === null) return <WritingSkeleton />

  return (
    <WritingAttemptShell
      // Key by submission so a client-side nav to a DIFFERENT attempt (same route
      // pattern) remounts the shell — otherwise the live-text store + seeded
      // initialText survive and attempt B renders attempt A's draft text.
      key={data!.submissionId}
      submissionId={data!.submissionId}
      bundle={data!.bundle}
      serverTime={data!.serverTime}
      perfAtLoad={data!.perfAtLoad}
      initialText={initialText}
      onSubmitted={() => setSubmitted(true)}
    />
  )
}

export default WritingAttemptPage
