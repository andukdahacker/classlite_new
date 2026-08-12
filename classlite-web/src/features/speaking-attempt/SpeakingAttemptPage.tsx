/**
 * SpeakingAttemptPage — Story 5.4 Task 8 (AC1,22,23). The route entry for
 * `/assignments/:assignmentId/speak`. Runs the shared two-call bootstrap, renders
 * the Loading / Empty / Error trilogy (UX-1), reconciles the localStorage mirror
 * into the draft cache ON LOAD (AC15, D5 — ASYMMETRIC: a stale/empty local mirror
 * never blanks a real server key), then mounts `SpeakingAttemptShell`. A terminal
 * start (409 SUBMISSION_EXISTS) and the post-submit receipt route to the shared
 * confirmation end-state (AC22/AC23) — never a raw error page.
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
import { SpeakingAttemptShell } from './components/SpeakingAttemptShell'
import { speakingReconcileConfig } from './lib/speakingContent'

/** Speaking-surface-shaped skeleton (AC22 — cue-card + record-block, not a spinner). */
function SpeakingSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="speaking-skeleton"
      aria-busy="true"
      aria-label={t('attempt.loading.label')}
      className="flex min-h-screen flex-col bg-[var(--cl-paper)]"
    >
      <div className="h-12 border-b border-[var(--cl-line)] bg-[var(--cl-surface)]" />
      <div className="mx-auto mt-6 flex w-full max-w-2xl flex-col items-center gap-6 px-4">
        <div className="h-28 w-full animate-pulse rounded bg-[var(--cl-line)]" />
        <div className="h-16 w-16 animate-pulse rounded-full bg-[var(--cl-line)]" />
      </div>
    </div>
  )
}

function SpeakingErrorState({ bodyKey, onRetry }: { bodyKey: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      data-testid="speaking-error"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="text-[var(--cl-ink)]">{t(bodyKey)}</p>
      {onRetry ? (
        <Button type="button" onClick={onRetry} data-testid="speaking-error-retry">
          {t('attempt.error.retry')}
        </Button>
      ) : null}
    </div>
  )
}

function errorBodyKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'attempt.error.notFound'
    if (error.status === 403 && error.code === 'NOT_ENROLLED') return 'attempt.error.notEnrolled'
    if (error.status === 409 && error.code === 'SUBMISSION_LOCKED') return 'attempt.readonly.locked'
  }
  return 'attempt.error.body'
}

export function SpeakingAttemptPage() {
  const { assignmentId } = useParams()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)

  const query = useAttemptBootstrap(assignmentId ?? '')

  // Reconcile the localStorage mirror into the draft cache once the bundle lands
  // (AC15, D5 asymmetric). A cache seed + toast side-effect. `seededId` drives the
  // shell gate; it is set INSIDE the once-guarded reconcile effect and compared
  // against the live submission in render, so a client-side nav to a DIFFERENT
  // attempt re-gates automatically (no pre-reconcile blank, no setState-in-effect
  // reset).
  const seededFor = useRef<string | null>(null)
  const [seededId, setSeededId] = useState<string | null>(null)

  const resetAttemptStore = useAttemptStore((s) => s.reset)
  useEffect(() => {
    resetAttemptStore()
  }, [assignmentId, resetAttemptStore])

  const data = query.data
  useEffect(() => {
    if (!data) return
    if (seededFor.current === data.submissionId) return
    seededFor.current = data.submissionId
    const result = reconcileStoredDraftIntoCache(
      queryClient,
      data.submissionId,
      data.bundle.submission.content,
      speakingReconcileConfig,
    )
    setSeededId(data.submissionId)
    if (result.conflict.recoveredLocalKey) {
      toast.info(t('speaking.draft.recoveredToast'))
    }
  }, [data, queryClient, t])

  if (submitted) return <SubmissionConfirmation />

  if (query.isPending) return <SpeakingSkeleton />

  if (query.isError) {
    if (
      query.error instanceof ApiError &&
      query.error.status === 409 &&
      query.error.code === 'SUBMISSION_EXISTS'
    ) {
      return <SubmissionConfirmation />
    }
    const bodyKey = errorBodyKey(query.error)
    const retryable = !(query.error instanceof ApiError) || query.error.status >= 500
    return (
      <SpeakingErrorState
        bodyKey={bodyKey}
        onRetry={retryable ? () => void query.refetch() : undefined}
      />
    )
  }

  if (!data || seededId !== data.submissionId) return <SpeakingSkeleton />

  return (
    <SpeakingAttemptShell
      // Key by submission so a client-side nav to a DIFFERENT attempt remounts the
      // shell — otherwise the recorder leaf + take state survive across attempts.
      key={data!.submissionId}
      submissionId={data!.submissionId}
      bundle={data!.bundle}
      serverTime={data!.serverTime}
      perfAtLoad={data!.perfAtLoad}
      onSubmitted={() => setSubmitted(true)}
    />
  )
}

export default SpeakingAttemptPage
