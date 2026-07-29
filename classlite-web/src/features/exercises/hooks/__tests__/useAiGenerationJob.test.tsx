// Story 4.3b T1 (AC2/AC4/AC5) — the job-polling hook. MSW at the HTTP boundary
// (TEST-FE-1, never mock Query); real QueryClient. Fake timers drive the
// progressive-backoff cadence and the 5-minute stuck threshold.
//
// NB: NO RTL `waitFor` here — it polls via `setInterval`, which fake timers
// freeze, so it deadlocks (the same trap the editor suite dodged by running on
// real time). Instead we advance the fake clock inside `act` via
// `advanceTimersByTimeAsync` (which flushes the queryFn microtasks AND the React
// re-render) and then assert directly on `result.current`.
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
import { useAiGenerationJob } from '../useAiGenerationJob'

type Job = components['schemas']['Job']
type ExerciseContent = components['schemas']['ExerciseContent']

const EX_ID = 'ex-1'
const JOB_ID = 'job-1'

function resultFragment(): ExerciseContent {
  return {
    sections: [
      { type: 'reading', title: 'Generated passage', content: 'Once upon a time…', questionGroups: [] },
    ],
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    type: 'ai_generate_section',
    status: 'pending',
    result: null,
    errorDetails: null,
    createdAt: '2026-07-29T00:00:00.000000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Installs the enqueue 202 + a scripted poll sequence. Each poll returns the
 * NEXT status in `statuses` (holding on the last). Records the fake-clock time
 * of every poll so backoff gaps are assertable, and captures enqueue bodies. */
function installJobFlow(statuses: Job[], opts: { enqueueStatus?: number } = {}) {
  const pollTimes: number[] = []
  const enqueues: Array<{ mode: string; params: unknown }> = []
  let pollIndex = 0
  server.use(
    http.post('/api/exercises/:id/ai-generate', async ({ request }) => {
      enqueues.push((await request.json()) as { mode: string; params: unknown })
      if (opts.enqueueStatus) {
        return HttpResponse.json(
          { error: { code: 'INVALID_MODE', message: 'boom', requestId: 'r' } },
          { status: opts.enqueueStatus },
        )
      }
      return HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 })
    }),
    http.get('/api/jobs/:jobId', () => {
      pollTimes.push(Date.now())
      const current = statuses[Math.min(pollIndex, statuses.length - 1)]
      pollIndex += 1
      return HttpResponse.json({ data: current, meta: { serverTime: 't' } })
    }),
  )
  return { pollTimes, enqueues }
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

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  server.resetHandlers()
})

describe('useAiGenerationJob — enqueue + poll to complete (AC2, AC3)', () => {
  test('enqueue POSTs the request, then polls to complete and exposes the result', async () => {
    const flow = installJobFlow([
      job({ status: 'pending' }),
      job({ status: 'processing' }),
      job({ status: 'complete', result: resultFragment() }),
    ])
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })

    expect(result.current.phase).toBe('idle')

    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 'space travel' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.phase).toBe('generating')
    expect(flow.enqueues).toEqual([{ mode: 'section', params: { topic: 'space travel' } }])

    await tick(2000 + 4000 + 8000)
    expect(result.current.phase).toBe('preview')
    expect(result.current.result).toEqual(resultFragment())
  })

  test('progressive backoff ramps 2s → 4s → 8s then holds', async () => {
    const flow = installJobFlow([job({ status: 'processing' })]) // never completes
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 't' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(1)

    await tick(2000 + 4000 + 8000 + 8000) // fire ~4 more polls
    const gaps = flow.pollTimes.slice(1).map((t, i) => t - flow.pollTimes[i])
    expect(gaps[0]).toBe(2000)
    expect(gaps[1]).toBe(4000)
    expect(gaps[2]).toBe(8000)
    expect(gaps[3]).toBe(8000)
  })
})

describe('useAiGenerationJob — failure surfaces (AC5)', () => {
  test('generic provider failure → phase failed, errorKind generation_failed', async () => {
    installJobFlow([job({ status: 'failed', errorDetails: 'max_retries_exhausted' })])
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'questions', params: { sectionId: '0', count: 5 } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe('generation_failed')
  })

  test('invalid_ai_response → distinct errorKind (retry is pointless)', async () => {
    installJobFlow([job({ status: 'failed', errorDetails: 'invalid_ai_response' })])
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 't' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.phase).toBe('failed')
    expect(result.current.errorKind).toBe('invalid_ai_response')
  })
})

describe('useAiGenerationJob — stuck threshold (AC4)', () => {
  test('a job still processing after 5 minutes surfaces phase stuck', async () => {
    installJobFlow([job({ status: 'processing' })]) // holds processing forever
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 't' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.phase).toBe('generating')

    await tick(5 * 60 * 1000)
    expect(result.current.phase).toBe('stuck')
  })
})

describe('useAiGenerationJob — lifecycle stop conditions (AC2)', () => {
  test('polling stops on unmount — no leaked interval', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result, unmount } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 't' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    await tick(2000 + 4000)
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(2)
    const countAtUnmount = flow.pollTimes.length
    unmount()
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtUnmount)
  })

  test('cancel stops polling and returns to idle', async () => {
    const flow = installJobFlow([job({ status: 'processing' })])
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 't' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    await tick(2000)
    expect(flow.pollTimes.length).toBeGreaterThanOrEqual(1)
    await act(async () => {
      result.current.cancel()
    })
    expect(result.current.phase).toBe('idle')
    const countAtCancel = flow.pollTimes.length
    await tick(60_000)
    expect(flow.pollTimes.length).toBe(countAtCancel)
  })

  test('regenerate re-enqueues a fresh job', async () => {
    const flow = installJobFlow([job({ status: 'complete', result: resultFragment() })])
    const { result } = renderHook(() => useAiGenerationJob(EX_ID), { wrapper: makeWrapper() })
    await act(async () => {
      result.current.enqueue({ mode: 'section', params: { topic: 'first' } })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.phase).toBe('preview')
    await act(async () => {
      result.current.regenerate()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(flow.enqueues.length).toBe(2)
    expect(flow.enqueues[1]).toEqual({ mode: 'section', params: { topic: 'first' } })
  })
})
