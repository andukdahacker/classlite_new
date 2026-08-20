/**
 * useAiGenerationJob — Story 4.3b (T1; AC2/AC4/AC5). The async AI-generation
 * lifecycle: enqueue a job, then poll it to a terminal state with client-driven
 * PROGRESSIVE BACKOFF, surfacing a single derived `phase` the dialog renders.
 *
 * Why a client-driven interval (not a fixed `refetchInterval` number): the
 * cadence must RAMP 2s → 4s → 8s and then hold (architecture.md:246), which a
 * constant can't express. `refetchInterval` is therefore a function of the poll
 * count, and it slows further while the tab is hidden (`document.hidden`) so a
 * navigated-away teacher stops hammering Gemini's queue. `staleTime: 0` is the
 * one justified FW-3 deviation — a job's status is live and must never be served
 * stale from cache.
 *
 * Polling STOPS on a terminal status (`complete`/`failed`), on `cancel()`, and
 * on unmount — the last two for free because the poll is a `useQuery`, not a
 * hand-rolled `setInterval` (so there is no interval to leak; FW-4). The 5-minute
 * `stuck` surface (AC4) is derived from elapsed wall-clock, not a separate timer.
 *
 * Jobs are server state → Query, never Zustand (TS-3/FW-6). Enqueue is a plain
 * mutation (no FW-2 optimistic triple — it creates a job, it does not mutate a
 * cached entity).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'
import { jobKeys } from '../api/jobKeys'

type Job = components['schemas']['Job']
type JobStatus = components['schemas']['JobStatus']
type AIGenerateRequest = components['schemas']['AIGenerateRequest']
type AIGenerationResult = components['schemas']['AIGenerationResult']
type JobEnqueued = components['schemas']['JobEnqueued']

/** Backoff schedule between successive polls: 2s, 4s, then hold at 8s. */
const BACKOFF_MS = [2000, 4000, 8000] as const
/** Poll this-many-times slower while the tab is hidden (navigated away). */
const HIDDEN_POLL_MULTIPLIER = 3
/** A job still non-terminal after this long surfaces the `stuck` affordance. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000
/** Surface `failed` after this many CONSECUTIVE poll errors — a persistent
 * `GET /jobs/{id}` failure (404/500/network) is an infra failure, not a job
 * still generating. >1 so a single transient blip recovers on the next poll. */
const POLL_FAILURE_LIMIT = 3

/** The five UI-facing states the dialog renders (AC3/AC4/AC5). `preview` is the
 * completed-with-result state; `stuck` and `failed` are non-`preview` unhappy
 * paths that keep the config reachable via cancel/regenerate. */
export type AiJobPhase = 'idle' | 'generating' | 'preview' | 'stuck' | 'failed'

/** Distinguishes the two honest failure actions (AC5): `invalid_ai_response`
 * means re-running the SAME prompt is pointless (adjust it), whereas
 * `generation_failed` (retries exhausted / provider error) is retry-or-manual. */
export type AiErrorKind = 'invalid_ai_response' | 'generation_failed'

export interface UseAiGenerationJobResult {
  phase: AiJobPhase
  result: AIGenerationResult | null
  errorKind: AiErrorKind | null
  /** Enqueue a generation. Replaces any in-flight job (regenerate uses this). */
  enqueue: (request: AIGenerateRequest) => void
  /** Re-run the last enqueued request as a fresh job (new credit cost). */
  regenerate: () => void
  /** Abandon the current job: stop polling, return to `idle`. */
  cancel: () => void
  isEnqueuing: boolean
  /** A non-null enqueue error (e.g. a cross-scope 404/403 — AC7). */
  enqueueError: ApiError | null
}

function isTerminal(status: JobStatus | undefined): boolean {
  return status === 'complete' || status === 'failed'
}

/**
 * Narrow the widened `Job.result` union back to this hook's AIGenerationResult.
 * Story 6.2a widened `Job.result` to a `oneOf` that also includes
 * ai_grade_writing's AIWritingGradeResult (D11). This hook only ever enqueues
 * ai_generate_* jobs, so a completed job's result IS an AIGenerationResult; the
 * `sections` discriminant (present on AIGenerationResult/ExerciseContent, absent on
 * AIWritingGradeResult which has `criteria`) guards against an unexpected shape —
 * an unknown type falls to `null`, the safe default (D11).
 */
function asGenerationResult(result: Job['result']): AIGenerationResult | null {
  if (result !== null && typeof result === 'object' && 'sections' in result) {
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
): AiJobPhase {
  if (jobId === null) return 'idle'
  // A `complete` job with no result is a degenerate success — nothing to
  // preview, so surface it as `failed` rather than a dead-end empty dialog.
  if (status === 'complete') return hasResult ? 'preview' : 'failed'
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
 * Drive an AI-generation job for `exerciseId`. Returns a derived `phase` plus the
 * enqueue / regenerate / cancel controls the dialog binds.
 */
export function useAiGenerationJob(exerciseId: string): UseAiGenerationJobResult {
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  // `stuck` is time-driven, not poll-driven: a poll can land up to a full backoff
  // interval (8s) after the 5-min mark, so deriving stuck from the last poll's
  // timestamp would surface it late. A dedicated timer fires it precisely at the
  // threshold. Keyed to `jobId` below so it auto-clears on cancel/unmount/new job.
  const [stuckReached, setStuckReached] = useState(false)
  // Consecutive poll-error count is STATE (not a ref): it drives the derived
  // `phase`, so it MUST trigger a re-render when it crosses POLL_FAILURE_LIMIT.
  const [pollFailures, setPollFailures] = useState(0)

  // Backoff cadence bookkeeping (a ref — must not trigger re-render on its own).
  const pollCountRef = useRef(0)
  const lastRequestRef = useRef<AIGenerateRequest | null>(null)

  const startJob = useCallback(
    (newJobId: string) => {
      // Clear any prior data at this key so a re-enqueue that reuses the id (or
      // a completed job being regenerated) polls fresh instead of reading the
      // stale terminal snapshot and never re-enabling.
      queryClient.removeQueries({ queryKey: jobKeys.detail(newJobId) })
      pollCountRef.current = 0
      setPollFailures(0)
      setStuckReached(false)
      setJobId(newJobId)
    },
    [queryClient],
  )

  // Schedule the 5-minute stuck timer for the active job (AC4). Cleanup fires on
  // cancel (jobId → null), unmount, or a new job — so there is never a leaked
  // timer and a re-enqueue restarts the clock.
  useEffect(() => {
    if (jobId === null) return
    const timer = setTimeout(() => setStuckReached(true), STUCK_THRESHOLD_MS)
    return () => clearTimeout(timer)
  }, [jobId])

  const enqueueMutation = useMutation<JobEnqueued, ApiError, AIGenerateRequest>({
    mutationFn: (request) =>
      apiFetch<JobEnqueued>(`/api/exercises/${exerciseId}/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    onSuccess: (data, request) => {
      lastRequestRef.current = request
      startJob(data.jobId)
    },
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
    // staleTime:0 — job status is live; never serve a cached poll (FW-3 deviation).
    staleTime: 0,
    // No per-attempt retry: polling re-fetches on its own interval, and a retry
    // would both inflate the backoff poll-count and mask a genuine endpoint
    // failure. Each poll fails fast and counts toward POLL_FAILURE_LIMIT instead.
    retry: false,
    // A terminal job must not re-poll on tab focus / network reconnect; the
    // `refetchInterval` guard below stops the recurring poll, and these stop the
    // event-driven ones — together they guarantee "polling stops on terminal".
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Keep polling (slower) while the tab is hidden rather than pausing outright.
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      if (isTerminal(query.state.data?.status)) return false
      // Stop hammering a persistently-failing endpoint — the UI shows `failed`.
      if (pollFailures >= POLL_FAILURE_LIMIT) return false
      const step = Math.min(Math.max(pollCountRef.current - 1, 0), BACKOFF_MS.length - 1)
      const base = BACKOFF_MS[step]
      return isTabHidden() ? base * HIDDEN_POLL_MULTIPLIER : base
    },
  })

  const job = jobId === null ? undefined : jobQuery.data

  // Plain derivations — the React Compiler memoizes these; a manual `useMemo`
  // here trips `preserve-manual-memoization` (its inferred deps are coarser).
  // `?? null` guards a degenerate complete-without-result (handled as `failed`
  // by derivePhase, not a dead-end preview).
  const result = job?.status === 'complete' ? asGenerationResult(job.result ?? null) : null
  // A persistent poll failure has surfaced once POLL_FAILURE_LIMIT is exhausted.
  const pollFailed = jobQuery.isError && pollFailures >= POLL_FAILURE_LIMIT
  const phase: AiJobPhase = derivePhase(jobId, job?.status, result !== null, stuckReached, pollFailed)
  const errorKind: AiErrorKind | null =
    job?.status === 'failed'
      ? job.errorDetails === 'invalid_ai_response'
        ? 'invalid_ai_response'
        : 'generation_failed'
      : pollFailed || (job?.status === 'complete' && result === null)
        ? 'generation_failed'
        : null

  const enqueue = useCallback(
    (request: AIGenerateRequest) => enqueueMutate(request),
    [enqueueMutate],
  )

  const regenerate = useCallback(() => {
    if (lastRequestRef.current) enqueueMutate(lastRequestRef.current)
  }, [enqueueMutate])

  const cancel = useCallback(() => {
    pollCountRef.current = 0
    setPollFailures(0)
    setJobId(null)
  }, [])

  return {
    phase,
    result,
    errorKind,
    enqueue,
    regenerate,
    cancel,
    isEnqueuing: enqueueMutation.isPending,
    enqueueError: enqueueMutation.error ?? null,
  }
}
