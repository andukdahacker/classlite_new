// Story 6.2b T1 (AC1-3/AC11) — the ai-grade job hook. MSW at the HTTP boundary
// (TEST-FE-1, never mock Query); real QueryClient. Fake timers drive the
// progressive-backoff cadence, the elapsed slow bands (30s/60s), and the 5-min
// stuck threshold. Mirrors useAiGenerationJob.test.tsx — NO RTL `waitFor` (fake
// timers freeze setInterval); advance the fake clock inside `act`.
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
import { useAiGradeJob } from '../useAiGradeJob'

type Job = components['schemas']['Job']
type AIWritingGradeResult = components['schemas']['AIWritingGradeResult']

const SUBMISSION_ID = 'sub-1'
const JOB_ID = 'job-w-1'
const AI_GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/ai-grade`

function gradeResult(): AIWritingGradeResult {
  const criterion = (band: number) => ({ band, rationale: 'because', confidence: 'high' as const })
  return {
    criteria: {
      taskResponse: criterion(6.5),
      coherenceCohesion: criterion(6),
      lexicalResource: criterion(7),
      grammaticalRange: criterion(6.5),
    },
    comments: [
      { type: 'praise', criterion: 'taskResponse', anchorStart: 0, anchorEnd: 3, text: 'Nice', confidence: 'high' },
    ],
    overallFeedback: 'Solid effort.',
    analyzedWordCount: 287,
    latencyMs: 1400,
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    type: 'ai_grade_writing',
    status: 'pending',
    result: null,
    errorDetails: null,
    createdAt: '2026-08-20T00:00:00.000000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Installs the enqueue (202 by default) + a scripted poll sequence. Each poll
 * returns the NEXT status in `statuses` (holding on the last). Records fake-clock
 * poll times so backoff gaps are assertable, and counts enqueues. */
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

async function enqueueAndSettle(result: { current: ReturnType<typeof useAiGradeJob> }) {
  await act(async () => {
    result.current.enqueue()
    await vi.advanceTimersByTimeAsync(10)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  // The hook now persists the in-flight jobId per submission (code-review 2026-08-21);
  // clear it so a non-terminal test doesn't seed/auto-resume the next.
  localStorage.clear()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  server.resetHandlers()
  localStorage.clear()
})

describe('useAiGradeJob — enqueue + poll to ready (AC1)', () => {
  test('empty-body POST, then polls to ready and exposes the narrowed grade result', async () => {
    const flow = installJobFlow([
      job({ status: 'pending' }),
      job({ status: 'processing' }),
      job({ status: 'complete', result: gradeResult() }),
    ])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })

    expect(result.current.phase).toBe('idle')
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')
    expect(flow.enqueues()).toBe(1)

    await tick(2000 + 4000 + 8000)
    expect(result.current.phase).toBe('ready')
    expect(result.current.result).toEqual(gradeResult())
    expect(result.current.errorKind).toBeNull()
  })

  test('progressive backoff ramps 2s → 4s → 8s then holds', async () => {
    const flow = installJobFlow([job({ status: 'processing' })]) // never completes
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(1)

    await tick(2000 + 4000 + 8000 + 8000)
    const gaps = flow.pollTimes.slice(1).map((t, i) => t - flow.pollTimes[i])
    expect(gaps[0]).toBe(2000)
    expect(gaps[1]).toBe(4000)
    expect(gaps[2]).toBe(8000)
    expect(gaps[3]).toBe(8000)
  })
})

describe('useAiGradeJob — idempotent 200 (AC2, FD1/6.2a D6)', () => {
  test('a 200 enqueue is handled identically to 202 — the returned jobId is polled', async () => {
    const flow = installJobFlow(
      [job({ status: 'processing' }), job({ status: 'complete', result: gradeResult() })],
      { enqueueStatus: 200 },
    )
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')
    // Exactly one enqueue call — the hook does not re-POST (no second credit).
    expect(flow.enqueues()).toBe(1)

    await tick(2000 + 4000)
    expect(result.current.phase).toBe('ready')
    expect(result.current.result).toEqual(gradeResult())
  })
})

describe('useAiGradeJob — terminal failure surfaces (AC13/AC14)', () => {
  test.each([
    ['invalid_band_scores', 'invalid_band_scores'],
    ['invalid_ai_response', 'invalid_ai_response'],
    ['stuck_timeout', 'stuck_timeout'],
    ['max_retries_exhausted', 'max_retries_exhausted'],
    ['generation_failed', 'generation_failed'],
  ])('errorDetails %s → phase failed + errorKind %s', async (errorDetails, expectedKind) => {
    installJobFlow([job({ status: 'failed', errorDetails })])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe(expectedKind)
    expect(result.current.result).toBeNull()
  })

  // code-review 2026-08-21: a poll-ENDPOINT failure is infra, NOT a job/refund failure.
  test('a persistent poll-endpoint failure → phase failed + errorKind poll_error (not generation_failed)', async () => {
    server.use(
      http.post(AI_GRADE_PATH, () =>
        HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 }),
      ),
      http.get('/api/jobs/:jobId', () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    // Three consecutive poll failures (POLL_FAILURE_LIMIT) across the backoff schedule.
    await tick(2000 + 4000 + 8000)
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe('poll_error')
  })
})

describe('useAiGradeJob — persisted jobId resume (code-review 2026-08-21)', () => {
  const jobKey = `classlite:ai-grade-job:${SUBMISSION_ID}`

  test('a remount mid-poll resumes polling the persisted job — no second enqueue', async () => {
    const flow = installJobFlow([job({ status: 'processing' })]) // never completes
    const first = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(first.result)
    expect(first.result.current.phase).toBe('generating')
    expect(localStorage.getItem(jobKey)).toBe(JOB_ID)
    first.unmount()

    // Fresh hook instance (queue nav / reload) — seeds jobId from storage and polls,
    // WITHOUT re-enqueuing (no double charge; FD4 intact — a resume is not an enqueue).
    const second = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    expect(second.result.current.phase).not.toBe('idle')
    await tick(10)
    expect(second.result.current.phase).toBe('generating')
    expect(flow.enqueues()).toBe(1)
  })

  test('reaching a terminal state clears the persisted jobId (a later remount rehydrates from aiSuggestion, not the poll)', async () => {
    installJobFlow([job({ status: 'complete', result: gradeResult() })])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000)
    expect(result.current.phase).toBe('ready')
    expect(localStorage.getItem(jobKey)).toBeNull()
  })
})

describe('useAiGradeJob — elapsed slow bands (AC11)', () => {
  test('slowLevel steps 0 → 1 at 30s → 2 at 60s while still generating', async () => {
    installJobFlow([job({ status: 'processing' })]) // holds processing
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.slowLevel).toBe(0)

    await tick(30 * 1000)
    expect(result.current.slowLevel).toBe(1)

    await tick(30 * 1000)
    expect(result.current.slowLevel).toBe(2)
  })

  test('slowLevel returns to 0 once the job completes', async () => {
    installJobFlow([job({ status: 'complete', result: gradeResult() })])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    // Advance well past both slow thresholds — but the job already completed.
    await tick(90 * 1000)
    expect(result.current.phase).toBe('ready')
    expect(result.current.slowLevel).toBe(0)
  })
})

describe('useAiGradeJob — stuck threshold (AC4-parity)', () => {
  test('a job still processing after 5 minutes surfaces phase stuck', async () => {
    installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    expect(result.current.phase).toBe('generating')

    await tick(5 * 60 * 1000)
    expect(result.current.phase).toBe('stuck')
  })
})

describe('useAiGradeJob — lifecycle stop conditions', () => {
  test('polling stops on unmount — no leaked interval', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result, unmount } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000 + 4000)
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(2)
    const countAtUnmount = flow.pollTimes.length
    unmount()
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtUnmount)
  })

  test('reset stops polling and returns to idle', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGradeJob(SUBMISSION_ID), { wrapper: makeWrapper() })
    await enqueueAndSettle(result)
    await tick(2000)
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(1)
    await act(async () => {
      result.current.reset()
    })
    expect(result.current.phase).toBe('idle')
    const countAtReset = flow.pollTimes.length
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtReset)
  })
})
