// ─────────────────────────────────────────────────────────────────────────────
// Story 6.3c · Task 1 (AC1-4, 14) — RED-PHASE ATDD scaffold (/bmad-tea AT 6-3c).
//
// This file is RED until Task 1 lands: it imports `../useAiGradeSpeakingJob`,
// which does not exist yet, so `tsc -b` and `vitest` both fail at module
// resolution. That is the intended red signal (repo FE red convention:
// import-the-missing-module → compile/resolve fail, NOT `test.skip()`).
//
// GREEN-PHASE SEAMS the dev must satisfy to turn this green (SD1):
//   • Clone `../useAiGradeJob.ts` → `../useAiGradeSpeakingJob.ts`. IDENTICAL:
//     empty-body POST /api/submissions/{id}/ai-grade; reused jobKeys poll on
//     GET /api/jobs/{id}; BACKOFF_MS=[2000,4000,8000]; staleTime:0; retry:false;
//     5-min stuck; POLL_FAILURE_LIMIT=3 (→ 'poll_error', no refund toast);
//     persisted-jobId resume (SAME key scheme — a submission is Writing XOR
//     Speaking, no collision); 200≡202 idempotent (a 200 ⇒ an ai_grade_speaking
//     job is already in flight → poll it, imply NO second credit).
//   • DIFF a — `asSpeakingGradeResult` narrows Job.result on `'moments' in result`
//     (the disjoint-oneOf discriminant; writing has `comments`, generation has
//     `sections`, speaking has `moments`+`transcriptionStatus`).
//   • DIFF b — `errorKind` union gains `'audio_unavailable'` (terminal, refunded).
//   • DIFF c — expose `transcriptionStatus`: a `complete` job with
//     transcriptionStatus==='unavailable' is a SUCCESS (partial_success), phase
//     'ready', errorKind null, NOT refunded (D3/D15).
//
// Twin of `useAiGradeJob.test.tsx` — same MSW-at-HTTP-boundary + fake-timer
// discipline (TEST-FE-1; no RTL `waitFor` — advance the fake clock inside `act`).
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
// RED: this module does not exist yet (Task 1). Import resolves green once
// useAiGradeSpeakingJob.ts is authored.
import { useAiGradeSpeakingJob } from '../useAiGradeSpeakingJob'

type Job = components['schemas']['Job']
type AISpeakingGradeResult = components['schemas']['AISpeakingGradeResult']

const SUBMISSION_ID = 'sub-spk-1'
const JOB_ID = 'job-spk-1'
const AI_GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/ai-grade`
// SD1: SAME persisted-jobId key scheme as the writing hook — no collision.
const JOB_KEY = `classlite:ai-grade-job:${SUBMISSION_ID}`

/** A complete speaking-grade result. `transcriptionStatus` defaults to the
 * happy path ('available'); the partial_success suite overrides it. */
function speakingResult(
  overrides: Partial<AISpeakingGradeResult> = {},
): AISpeakingGradeResult {
  const criterion = (band: number) => ({ band, rationale: 'because', confidence: 'high' as const })
  return {
    criteria: {
      fluencyCoherence: criterion(6.5),
      lexicalResource: criterion(6),
      grammaticalRange: criterion(7),
      pronunciation: criterion(6.5),
    },
    moments: [
      { type: 'praise', criterion: 'pronunciation', timestampMs: 4200, text: 'Clear /θ/', confidence: 'high' },
      { type: 'error', criterion: 'grammaticalRange', timestampMs: null, text: 'Tense slip', confidence: 'medium' },
    ],
    transcript: 'Well, I think the most important...',
    transcriptionStatus: 'available',
    overallFeedback: 'Confident delivery.',
    analyzedDurationMs: 92_000,
    latencyMs: 1800,
    ...overrides,
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    type: 'ai_grade_speaking',
    status: 'pending',
    result: null,
    errorDetails: null,
    createdAt: '2026-08-24T00:00:00.000000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Installs enqueue (202 by default) + a scripted poll sequence, holding on the
 * last status. Records fake-clock poll times so backoff gaps are assertable, and
 * counts enqueues so we can prove no second credit is charged. */
function installJobFlow(statuses: Job[], opts: { enqueueStatus?: number } = {}) {
  const pollTimes: number[] = []
  let enqueueCount = 0
  let pollIndex = 0
  server.use(
    http.post(AI_GRADE_PATH, () => {
      enqueueCount += 1
      return HttpResponse.json(
        { data: { jobId: JOB_ID }, meta: { serverTime: 't' } },
        { status: opts.enqueueStatus ?? 202 },
      )
    }),
    http.get('/api/jobs/:jobId', () => {
      pollTimes.push(Date.now())
      const current = statuses[Math.min(pollIndex, statuses.length - 1)]
      pollIndex += 1
      return HttpResponse.json({ data: current, meta: { serverTime: 't' } })
    }),
  )
  return { pollTimes, enqueues: () => enqueueCount }
}

function makeWrapper() {
  const client = createTestQueryClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function enqueueAndSettle(result: { current: ReturnType<typeof useAiGradeSpeakingJob> }) {
  await act(async () => {
    result.current.enqueue()
    await vi.advanceTimersByTimeAsync(10)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  server.resetHandlers()
  localStorage.clear()
})

describe('useAiGradeSpeakingJob — enqueue + poll to ready (AC1)', () => {
  test('empty-body POST, then polls to ready and narrows the speaking result on `moments`', async () => {
    const flow = installJobFlow([
      job({ status: 'pending' }),
      job({ status: 'processing' }),
      job({ status: 'complete', result: speakingResult() }),
    ])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })

    expect(result.current.phase).toBe('idle')
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')
    expect(flow.enqueues()).toBe(1)

    await tick(2000 + 4000 + 8000)
    expect(result.current.phase).toBe('ready')
    // The narrowed result carries `moments` (the speaking discriminant), NOT `comments`.
    expect(result.current.result).toEqual(speakingResult())
    expect(result.current.result?.moments).toHaveLength(2)
    expect(result.current.errorKind).toBeNull()
    expect(result.current.transcriptionStatus).toBe('available')
  })

  test('progressive backoff ramps 2s → 4s → 8s then holds (AC1)', async () => {
    const flow = installJobFlow([job({ status: 'processing' })]) // never completes
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)

    await tick(2000 + 4000 + 8000 + 8000)
    const gaps = flow.pollTimes.slice(1).map((t, i) => t - flow.pollTimes[i])
    expect(gaps[0]).toBe(2000)
    expect(gaps[1]).toBe(4000)
    expect(gaps[2]).toBe(8000)
    expect(gaps[3]).toBe(8000)
  })
})

describe('useAiGradeSpeakingJob — idempotent 200 (AC2; 6.3b D6)', () => {
  test('a 200 enqueue is handled identically to 202 — poll the returned jobId, imply no second credit', async () => {
    const flow = installJobFlow(
      [job({ status: 'processing' }), job({ status: 'complete', result: speakingResult() })],
      { enqueueStatus: 200 },
    )
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')
    expect(flow.enqueues()).toBe(1) // exactly one POST — no re-enqueue

    await tick(2000 + 4000)
    expect(result.current.phase).toBe('ready')
    expect(result.current.result).toEqual(speakingResult())
  })
})

describe('useAiGradeSpeakingJob — partial_success is a SUCCESS, not a failure (AC11; SD1 DIFF c / D15)', () => {
  test('complete + transcriptionStatus "unavailable" → phase ready, NOT refunded, bands+moments intact', async () => {
    installJobFlow([
      job({ status: 'complete', result: speakingResult({ transcript: null, transcriptionStatus: 'unavailable' }) }),
    ])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000)

    // The load-bearing invariant: unavailable transcript ≠ failed job (no refund).
    expect(result.current.phase).toBe('ready')
    expect(result.current.errorKind).toBeNull()
    expect(result.current.transcriptionStatus).toBe('unavailable')
    expect(result.current.result?.criteria.fluencyCoherence.band).toBe(6.5)
    expect(result.current.result?.moments).toHaveLength(2)
  })
})

describe('useAiGradeSpeakingJob — terminal failures surface (AC16, AC17; SD1 DIFF b)', () => {
  test.each([
    ['audio_unavailable', 'audio_unavailable'], // NEW terminal — refunded (SD8/AC16)
    ['invalid_band_scores', 'invalid_band_scores'],
    ['invalid_ai_response', 'invalid_ai_response'],
    ['stuck_timeout', 'stuck_timeout'],
    ['max_retries_exhausted', 'max_retries_exhausted'],
    ['generation_failed', 'generation_failed'],
  ])('errorDetails %s → phase failed + errorKind %s', async (errorDetails, expectedKind) => {
    installJobFlow([job({ status: 'failed', errorDetails })])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe(expectedKind)
    expect(result.current.result).toBeNull()
  })

  test('a persistent poll-endpoint failure → phase failed + errorKind poll_error (infra, NOT a refund) (AC17)', async () => {
    server.use(
      http.post(AI_GRADE_PATH, () =>
        HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 }),
      ),
      http.get('/api/jobs/:jobId', () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000 + 4000 + 8000) // three consecutive poll failures (POLL_FAILURE_LIMIT)
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe('poll_error')
  })
})

describe('useAiGradeSpeakingJob — persisted jobId resume (SD1; no double-charge)', () => {
  test('a remount mid-poll resumes the persisted job — no second enqueue', async () => {
    const flow = installJobFlow([job({ status: 'processing' })]) // never completes
    const first = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(first.result)
    expect(first.result.current.phase).toBe('generating')
    expect(localStorage.getItem(JOB_KEY)).toBe(JOB_ID)
    first.unmount()

    const second = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    expect(second.result.current.phase).not.toBe('idle')
    await tick(10)
    expect(second.result.current.phase).toBe('generating')
    expect(flow.enqueues()).toBe(1) // resume is not an enqueue (FD4 intact)
  })

  test('reaching a terminal state clears the persisted jobId (a later remount rehydrates from aiSpeakingSuggestion)', async () => {
    installJobFlow([job({ status: 'complete', result: speakingResult() })])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000)
    expect(result.current.phase).toBe('ready')
    expect(localStorage.getItem(JOB_KEY)).toBeNull()
  })
})

describe('useAiGradeSpeakingJob — elapsed slow bands (AC14)', () => {
  test('slowLevel steps 0 → 1 at 30s → 2 at 60s while still generating', async () => {
    installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.slowLevel).toBe(0)

    await tick(30 * 1000)
    expect(result.current.slowLevel).toBe(1)

    await tick(30 * 1000)
    expect(result.current.slowLevel).toBe(2)
  })
})

describe('useAiGradeSpeakingJob — stuck threshold (AC14 hard cap)', () => {
  test('a job still processing after 5 minutes surfaces phase stuck', async () => {
    installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')

    await tick(5 * 60 * 1000)
    expect(result.current.phase).toBe('stuck')
  })
})

describe('useAiGradeSpeakingJob — lifecycle stop conditions', () => {
  test('polling stops on unmount — no leaked interval', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result, unmount } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000 + 4000)
    const countAtUnmount = flow.pollTimes.length
    unmount()
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtUnmount)
  })

  test('reset stops polling and returns to idle', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGradeSpeakingJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000)
    await act(async () => {
      result.current.reset()
    })
    expect(result.current.phase).toBe('idle')
    const countAtReset = flow.pollTimes.length
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtReset)
  })
})
