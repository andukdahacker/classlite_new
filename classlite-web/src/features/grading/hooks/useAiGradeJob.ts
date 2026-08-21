/**
 * useAiGradeJob — Story 6.2b (T1; AC1-3/AC11). The async AI-writing-grade
 * lifecycle: enqueue an `ai_grade_writing` job for a submission, then poll it to
 * a terminal state with the SAME client-driven PROGRESSIVE BACKOFF the 4.3b
 * generation hook uses (2s → 4s → 8s, then hold). It is a near-verbatim clone of
 * `useAiGenerationJob` (FD1) — the only differences are the enqueue endpoint (an
 * EMPTY-body POST to `/api/submissions/{id}/ai-grade`), the result narrowing
 * (`AIWritingGradeResult` via the `'criteria'` discriminant, not
 * `AIGenerationResult`'s `sections`), and the elapsed-based slow-messaging levels
 * (AC11) the grading panel renders while a run is in flight.
 *
 * The poll REUSES the shared `jobKeys.detail(jobId)` (`['jobs', jobId]`, the
 * unchanged creator-private `GET /api/jobs/{jobId}` — 6.2a D9), so both ai-grade
 * consumers share one job-poll cache slot. `staleTime: 0` is the one justified
 * FW-3 deviation — a job's status is live and must never be served stale.
 *
 * IDEMPOTENT 200 (FD1 / 6.2a D6): the enqueue op answers `202` for a fresh job
 * and `200` when an `ai_grade_writing` job is already pending/processing for the
 * submission. `apiFetch` treats both as success and unwraps the same
 * `{ jobId }`, so the two are handled IDENTICALLY here — we simply poll the
 * returned jobId. No second credit is implied (the panel never assumes one).
 *
 * Jobs are server state → Query, never Zustand (TS-3/FW-6). Enqueue is a plain
 * mutation (no FW-2 optimistic triple — it creates a job, it does not mutate a
 * cached entity).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { jobKeys } from '@/features/exercises'
import type { components } from '@/lib/api/client'
import { gradingKeys } from '../api/gradingKeys'

type Job = components['schemas']['Job']
type JobStatus = components['schemas']['JobStatus']
type AIWritingGradeResult = components['schemas']['AIWritingGradeResult']
type JobEnqueued = components['schemas']['JobEnqueued']

/** Backoff schedule between successive polls: 2s, 4s, then hold at 8s. */
const BACKOFF_MS = [2000, 4000, 8000] as const
/** Poll this-many-times slower while the tab is hidden (navigated away). */
const HIDDEN_POLL_MULTIPLIER = 3
/** A job still non-terminal after this long surfaces the `stuck` affordance. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000
/** Surface `failed` after this many CONSECUTIVE poll errors — a persistent
 * `GET /jobs/{id}` failure (404/500/network) is an infra failure, not a job
 * still grading. >1 so a single transient blip recovers on the next poll. */
const POLL_FAILURE_LIMIT = 3
/** Elapsed-since-enqueue at which "taking longer than expected" shows (AC11). */
const SLOW_THRESHOLD_MS = 30 * 1000
/** Elapsed-since-enqueue at which "unusually slow — grade manually" shows (AC11). */
const VERY_SLOW_THRESHOLD_MS = 60 * 1000

/** localStorage key prefix for the in-flight jobId (code-review 2026-08-21). A remount
 * mid-poll (queue nav / reload) would otherwise abandon a PAID in-flight job — `jobId`
 * is component state, and `view.aiSuggestion` is null until the job completes, so the
 * panel would fall idle with no in-flight indicator. Persisting the jobId (per
 * submission, mirroring the durable draft) lets a remount reconnect the creator-private
 * poll and resume the generating state. Cleared on terminal + reset so a later remount
 * rehydrates from `aiSuggestion` (FD3) rather than re-polling a finished job. */
const JOB_ID_KEY_PREFIX = 'classlite:ai-grade-job:'

function jobIdStorageKey(submissionId: string): string {
  return `${JOB_ID_KEY_PREFIX}${submissionId}`
}

function readPersistedJobId(submissionId: string): string | null {
  try {
    return window.localStorage.getItem(jobIdStorageKey(submissionId))
  } catch {
    return null
  }
}

function writePersistedJobId(submissionId: string, jobId: string): void {
  try {
    window.localStorage.setItem(jobIdStorageKey(submissionId), jobId)
  } catch {
    // storage full / disabled — the in-memory jobId is still authoritative this session.
  }
}

function clearPersistedJobId(submissionId: string): void {
  try {
    window.localStorage.removeItem(jobIdStorageKey(submissionId))
  } catch {
    // ignore
  }
}

/** The five UI-facing states the grading panel renders. `ready` is the
 * completed-with-result state; `stuck` and `failed` are the non-`ready` unhappy
 * paths. */
export type AiGradePhase = 'idle' | 'generating' | 'ready' | 'stuck' | 'failed'

/** Elapsed-since-enqueue slow band (AC11): 0 = normal, 1 = >30s, 2 = >60s. */
export type AiGradeSlowLevel = 0 | 1 | 2

/**
 * The terminal failure detail, narrowed to the ai_grade_writing cases the panel
 * distinguishes (AC13/AC14): `invalid_band_scores` → empty-form "grade manually"
 * (the AI proposed off-grid/out-of-range bands); `invalid_ai_response` →
 * "invalid output, credit returned" refund toast; `stuck_timeout` /
 * `max_retries_exhausted` / any other → the generic "grading failed, credit
 * returned" refund toast. The refund itself is backend (6.2a); the FE surfaces it.
 *
 * `poll_error` is DISTINCT from the above: it means the `GET /api/jobs/{id}` poll
 * ENDPOINT failed repeatedly (network/500) — an infra failure, NOT a terminal job
 * failure. The backend job may still be running/succeeding and NO refund is implied,
 * so the panel must show the inline "couldn't check progress" retry WITHOUT the
 * "credit returned" toast (code-review 2026-08-21).
 */
export type AiGradeErrorKind =
  | 'invalid_band_scores'
  | 'invalid_ai_response'
  | 'stuck_timeout'
  | 'max_retries_exhausted'
  | 'generation_failed'
  | 'poll_error'

export interface UseAiGradeJobResult {
  phase: AiGradePhase
  result: AIWritingGradeResult | null
  errorKind: AiGradeErrorKind | null
  /** Elapsed slow band while `generating` (AC11); 0 once terminal / idle. */
  slowLevel: AiGradeSlowLevel
  /** Enqueue an ai-grade run for this submission (gated by the confirm dialog). */
  enqueue: () => void
  /** Abandon / acknowledge the current job: stop polling, return to `idle`. */
  reset: () => void
  isEnqueuing: boolean
  /** A non-null enqueue error (e.g. 403/404/409/429 — Dev Notes contract). */
  enqueueError: ApiError | null
}

function isTerminal(status: JobStatus | undefined): boolean {
  return status === 'complete' || status === 'failed'
}

/**
 * Narrow the widened `Job.result` union to this hook's AIWritingGradeResult.
 * 6.2a widened `Job.result` to a `oneOf` (D11): ai_generate_* → AIGenerationResult
 * (has `sections`), ai_grade_writing → AIWritingGradeResult (has `criteria`). This
 * hook only enqueues ai_grade_writing, so a completed job's result IS a grade
 * result; the `criteria` discriminant guards an unexpected shape — an unknown type
 * falls to `null`, the safe default.
 */
function asWritingGradeResult(result: Job['result']): AIWritingGradeResult | null {
  if (result !== null && typeof result === 'object' && 'criteria' in result) {
    return result
  }
  return null
}

function derivePhase(
  jobId: string | null,
  status: JobStatus | undefined,
  hasResult: boolean,
  stuckReached: boolean,
  pollFailed: boolean,
): AiGradePhase {
  if (jobId === null) return 'idle'
  // A `complete` job with no (narrowable) result is a degenerate success —
  // surface it as `failed` rather than a dead-end empty panel.
  if (status === 'complete') return hasResult ? 'ready' : 'failed'
  if (status === 'failed') return 'failed'
  // A persistent poll-endpoint failure is an infra failure, not "still working".
  if (pollFailed) return 'failed'
  if (stuckReached) return 'stuck'
  return 'generating'
}

function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/**
 * Drive an AI-grade job for `submissionId`. Returns a derived `phase` + `result`
 * + `errorKind` + elapsed `slowLevel`, plus the `enqueue` / `reset` controls the
 * grading panel binds.
 */
export function useAiGradeJob(submissionId: string): UseAiGradeJobResult {
  const queryClient = useQueryClient()
  // Seed from a persisted in-flight jobId so a remount mid-poll reconnects the
  // creator-private poll instead of abandoning a PAID job (code-review 2026-08-21).
  // This is a POLL resume, NOT an enqueue — it never spends a credit (FD4 intact).
  const [jobId, setJobId] = useState<string | null>(() => readPersistedJobId(submissionId))
  // `stuck` is time-driven, not poll-driven (a poll can land a full 8s backoff
  // after the 5-min mark). A dedicated timer fires it precisely at the threshold,
  // keyed to `jobId` so it auto-clears on reset/unmount/new job.
  const [stuckReached, setStuckReached] = useState(false)
  // Elapsed-since-enqueue slow band (AC11) — timers, same rationale as `stuck`.
  const [slowLevel, setSlowLevel] = useState<AiGradeSlowLevel>(0)
  // Consecutive poll-error count is STATE (not a ref): it drives the derived
  // `phase`, so it MUST re-render when it crosses POLL_FAILURE_LIMIT.
  const [pollFailures, setPollFailures] = useState(0)

  const pollCountRef = useRef(0)

  const startJob = useCallback(
    (newJobId: string) => {
      // Clear any prior data at this key so a re-enqueue that reuses the id (or a
      // completed job being re-run) polls fresh instead of reading the stale
      // terminal snapshot and never re-enabling.
      queryClient.removeQueries({ queryKey: jobKeys.detail(newJobId) })
      pollCountRef.current = 0
      setPollFailures(0)
      setStuckReached(false)
      setSlowLevel(0)
      writePersistedJobId(submissionId, newJobId)
      setJobId(newJobId)
    },
    [queryClient, submissionId],
  )

  // Schedule the elapsed-based slow (30s/60s, AC11) + stuck (5-min, AC4) timers
  // for the active job. Cleanup fires on reset (jobId → null), unmount, or a new
  // job — so there is never a leaked timer and a re-enqueue restarts the clocks.
  useEffect(() => {
    if (jobId === null) return
    const slow1 = setTimeout(() => setSlowLevel((lvl) => (lvl < 1 ? 1 : lvl)), SLOW_THRESHOLD_MS)
    const slow2 = setTimeout(() => setSlowLevel(2), VERY_SLOW_THRESHOLD_MS)
    const stuck = setTimeout(() => setStuckReached(true), STUCK_THRESHOLD_MS)
    return () => {
      clearTimeout(slow1)
      clearTimeout(slow2)
      clearTimeout(stuck)
    }
  }, [jobId])

  const enqueueMutation = useMutation<JobEnqueued, ApiError, void>({
    mutationKey: gradingKeys.aiGradeMutation(submissionId),
    // Empty-body POST — the ai-grade op takes no request body (the submissionId is
    // in the path; the job-row center_id is the sole trust anchor, SEC-7).
    mutationFn: () =>
      apiFetch<JobEnqueued>(`/api/submissions/${encodeURIComponent(submissionId)}/ai-grade`, {
        method: 'POST',
      }),
    onSuccess: (data) => startJob(data.jobId),
  })

  const { mutate: enqueueMutate } = enqueueMutation

  const jobQuery = useQuery<Job>({
    queryKey: jobKeys.detail(jobId ?? '__idle__'),
    queryFn: async () => {
      pollCountRef.current += 1
      try {
        const data = await apiFetch<Job>(`/api/jobs/${jobId}`)
        setPollFailures(0)
        return data
      } catch (error) {
        setPollFailures((n) => n + 1)
        throw error
      }
    },
    enabled: jobId !== null,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      if (isTerminal(query.state.data?.status)) return false
      if (pollFailures >= POLL_FAILURE_LIMIT) return false
      const step = Math.min(Math.max(pollCountRef.current - 1, 0), BACKOFF_MS.length - 1)
      const base = BACKOFF_MS[step]
      return isTabHidden() ? base * HIDDEN_POLL_MULTIPLIER : base
    },
  })

  const job = jobId === null ? undefined : jobQuery.data

  const result = job?.status === 'complete' ? asWritingGradeResult(job.result ?? null) : null
  const pollFailed = jobQuery.isError && pollFailures >= POLL_FAILURE_LIMIT
  const phase = derivePhase(jobId, job?.status, result !== null, stuckReached, pollFailed)

  const errorKind: AiGradeErrorKind | null =
    job?.status === 'failed'
      ? job.errorDetails === 'invalid_band_scores'
        ? 'invalid_band_scores'
        : job.errorDetails === 'invalid_ai_response'
          ? 'invalid_ai_response'
          : job.errorDetails === 'stuck_timeout'
            ? 'stuck_timeout'
            : job.errorDetails === 'max_retries_exhausted'
              ? 'max_retries_exhausted'
              : 'generation_failed'
      : pollFailed
        ? // a persistent poll-ENDPOINT failure is infra, not a job failure or a
          // refund — distinct from `generation_failed` so the panel suppresses the
          // "credit returned" toast (code-review 2026-08-21).
          'poll_error'
        : job?.status === 'complete' && result === null
          ? 'generation_failed'
          : null

  // Clear the persisted jobId once the job is terminal (or poll-dead) so a later
  // remount rehydrates from `aiSuggestion` (FD3) rather than re-polling a finished
  // job. The in-memory jobId stays for the current mount's display.
  useEffect(() => {
    if (jobId !== null && (phase === 'ready' || phase === 'failed' || phase === 'stuck')) {
      clearPersistedJobId(submissionId)
    }
  }, [jobId, phase, submissionId])

  const enqueue = useCallback(() => enqueueMutate(), [enqueueMutate])

  const reset = useCallback(() => {
    pollCountRef.current = 0
    setPollFailures(0)
    setStuckReached(false)
    setSlowLevel(0)
    clearPersistedJobId(submissionId)
    setJobId(null)
  }, [submissionId])

  // Only surface the slow band while a run is actually in flight (AC11).
  const effectiveSlowLevel: AiGradeSlowLevel = phase === 'generating' ? slowLevel : 0

  return {
    phase,
    result,
    errorKind,
    slowLevel: effectiveSlowLevel,
    enqueue,
    reset,
    isEnqueuing: enqueueMutation.isPending,
    enqueueError: enqueueMutation.error ?? null,
  }
}
