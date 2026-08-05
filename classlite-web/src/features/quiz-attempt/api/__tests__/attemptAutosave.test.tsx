// Story 5.2b Task 2 — the finalizer/race/no-loss BLOCKER coverage (WF-8, risk 7).
// Real QueryClient + MSW at the HTTP boundary (never mock Query, TEST-FE-1);
// real timers with a short injected autosave interval (no fake-timer/RTL
// deadlock). Covers WF-8 red list #4 (no-data-loss body-verified), #5 (saveSeq
// out-of-order), #6 (0:00 convergence race), #7 (finalize happy-path), #10
// (flush-on-unmount beacon), #11 (N keystrokes → one PUT).
import { useCallback, useEffect, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { server } from '@/test/msw-server'
import {
  emptyAttemptContent,
  withAnswer,
  type AttemptContent,
} from '../../lib/attemptContent'
import {
  initialState,
  useQuizAttemptStore,
  type AttemptSaveStatus,
} from '@/stores/quizAttemptStore'
import { useAttemptAutosave } from '../useAttemptAutosave'
import { useSubmitAttempt } from '../useSubmitAttempt'
import { finalizeAttempt, type FinalizeLatch, type FinalizeResult } from '../finalizeAttempt'

const SUBMISSION_ID = 'sub-1'

interface RecordedPut {
  answers: Record<string, string>
}
interface Recorder {
  events: string[]
  puts: RecordedPut[]
  posts: number
}

/** A submission body good enough for the client to resolve `mutateAsync`. */
function submissionResponse() {
  return {
    data: {
      id: SUBMISSION_ID,
      status: 'submitted',
      content: {},
      schemaVersion: 1,
    },
    meta: { serverTime: '2026-08-04T00:00:00Z' },
  }
}

interface HarnessApi {
  setAnswer: (handle: string, value: string) => void
  scheduleSave: () => void
  flush: () => Promise<void>
  finalize: () => Promise<FinalizeResult>
  getDraft: () => AttemptContent
  latch: FinalizeLatch
}

function Harness({
  onReady,
  intervalMs,
  enabled = true,
}: {
  onReady: (api: HarnessApi) => void
  intervalMs: number
  enabled?: boolean
}) {
  const draftRef = useRef<AttemptContent>(emptyAttemptContent())
  const latchRef = useRef<FinalizeLatch>({ current: false })
  const { scheduleSave, flush } = useAttemptAutosave(SUBMISSION_ID, {
    getContent: () => draftRef.current,
    intervalMs,
    enabled,
  })
  const submitMutation = useSubmitAttempt(SUBMISSION_ID)

  const finalize = useCallback(
    () =>
      finalizeAttempt({
        flush,
        submit: () => submitMutation.mutateAsync(),
        alreadyFinalized: latchRef.current,
      }),
    [flush, submitMutation],
  )

  useEffect(() => {
    onReady({
      setAnswer: (handle, value) => {
        draftRef.current = withAnswer(draftRef.current, handle, value)
      },
      scheduleSave,
      flush,
      finalize,
      getDraft: () => draftRef.current,
      latch: latchRef.current,
    })
  }, [onReady, scheduleSave, flush, finalize])

  return null
}

function seedSession(): void {
  const user: UserSummary = {
    id: 'u1',
    email: 's@e.com',
    fullName: 'S',
    emailVerified: true,
  }
  queryClient.setQueryData<Session>(authKeys.session(), {
    user,
    accessToken: 'a.b.c',
    center: {
      id: 'c1',
      name: 'C',
      shortCode: 'c',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'student',
  })
}

function renderHarness(intervalMs: number, enabled = true) {
  let api!: HarnessApi
  const client = createTestQueryClient()
  const utils = render(
    <QueryClientProvider client={client}>
      <Harness
        intervalMs={intervalMs}
        enabled={enabled}
        onReady={(a) => {
          api = a
        }}
      />
    </QueryClientProvider>,
  )
  return { getApi: () => api, ...utils }
}

/** Record every PUT body + POST hit, in order. */
function installRecorder(putStatuses: number[] = []): Recorder {
  const rec: Recorder = { events: [], puts: [], posts: 0 }
  let putIndex = 0
  server.use(
    http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
      const body = (await request.json()) as { content: RecordedPut }
      const status = putStatuses[putIndex] ?? 200
      putIndex += 1
      rec.events.push('PUT')
      rec.puts.push({ answers: body.content.answers })
      if (status !== 200) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status },
        )
      }
      return HttpResponse.json(submissionResponse())
    }),
    http.post(`/api/submissions/${SUBMISSION_ID}/submit`, () => {
      rec.events.push('POST')
      rec.posts += 1
      return HttpResponse.json(submissionResponse())
    }),
  )
  return rec
}

beforeEach(() => {
  seedSession()
  useQuizAttemptStore.setState({ ...initialState })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  useQuizAttemptStore.setState({ ...initialState })
  server.resetHandlers()
})

describe('useAttemptAutosave — FW-4 loop guard (WF-8 #11)', () => {
  test('N keystrokes inside one window produce exactly one PUT', async () => {
    const rec = installRecorder()
    const { getApi } = renderHarness(40)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    // Five rapid edits — the cadence is armed once, never reset per keystroke.
    for (let i = 0; i < 5; i++) {
      api.setAnswer(`0:0:${i}`, `v${i}`)
      api.scheduleSave()
    }

    await waitFor(() => expect(rec.puts.length).toBe(1))
    // Give a second window a chance to (wrongly) fire — it must not.
    await delay(120)
    expect(rec.puts.length).toBe(1)
    // The single PUT carries all five accumulated answers (full-replace, D1).
    expect(Object.keys(rec.puts[0].answers)).toHaveLength(5)
  })
})

describe('useAttemptAutosave — no-data-loss, body-verified (WF-8 #4 BLOCKER)', () => {
  test('a failed save keeps edits; the retried PUT carries the FULL content', async () => {
    // First PUT 503s; the next 200s.
    const rec = installRecorder([503, 200])
    const { getApi } = renderHarness(999_999) // cadence irrelevant — we flush explicitly
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'Q1')
    api.setAnswer('0:0:1', 'Q2')
    await expect(api.flush()).rejects.toBeTruthy() // PUT #1 {Q1,Q2} → 503

    expect(rec.puts[0].answers).toEqual({ '0:0:0': 'Q1', '0:0:1': 'Q2' })
    await waitFor(() =>
      expect(useQuizAttemptStore.getState().saveStatus).toBe('error'),
    )

    // No success in between — add two more answers, then flush again.
    api.setAnswer('0:0:2', 'Q3')
    api.setAnswer('0:0:3', 'Q4')
    await api.flush() // PUT #2 → 200

    // The retried body is the FULL {Q1,Q2,Q3,Q4}, not the stale in-flight body.
    expect(rec.puts[1].answers).toEqual({
      '0:0:0': 'Q1',
      '0:0:1': 'Q2',
      '0:0:2': 'Q3',
      '0:0:3': 'Q4',
    })
    await waitFor(() =>
      expect(useQuizAttemptStore.getState().saveStatus).toBe('saved'),
    )
  })
})

describe('useAttemptAutosave — saveSeq out-of-order guard (WF-8 #5 BLOCKER)', () => {
  test('the newest save wins; a superseded save never reports "saved"', async () => {
    const rec = installRecorder()
    // Delay the FIRST PUT so a second, newer save is issued while it is pending.
    let putCount = 0
    server.use(
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
        const body = (await request.json()) as { content: RecordedPut }
        putCount += 1
        if (putCount === 1) await delay(60)
        rec.events.push('PUT')
        rec.puts.push({ answers: body.content.answers })
        return HttpResponse.json(submissionResponse())
      }),
    )

    // Count how many times the store transitions INTO 'saved'.
    let savedTransitions = 0
    let prev: AttemptSaveStatus = useQuizAttemptStore.getState().saveStatus
    const unsub = useQuizAttemptStore.subscribe((s) => {
      if (s.saveStatus === 'saved' && prev !== 'saved') savedTransitions += 1
      prev = s.saveStatus
    })

    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'A')
    const first = api.flush() // seq1, delayed
    api.setAnswer('0:0:1', 'B')
    const second = api.flush() // seq2, chained after seq1

    await Promise.all([first, second])
    unsub()

    // Two serialized PUTs; the last one carries the newest full content (D1).
    expect(rec.puts.length).toBe(2)
    expect(rec.puts[1].answers).toEqual({ '0:0:0': 'A', '0:0:1': 'B' })
    // The out-of-order guard: only the NEWEST save flipped the indicator to
    // 'saved'. The superseded seq-1 completion (mySeq < latestSeq) was dropped,
    // so it never reported "saved" — without the guard this would be 2.
    expect(savedTransitions).toBe(1)
    expect(useQuizAttemptStore.getState().saveStatus).toBe('saved')
  })
})

describe('useAttemptAutosave — edit during an in-flight save (Review Patch #3)', () => {
  test('an edit made WHILE a PUT is in flight is not falsely reported "saved"', async () => {
    const rec = installRecorder()
    // Delay the FIRST PUT so an edit can land while it is still in flight.
    let putCount = 0
    server.use(
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
        const body = (await request.json()) as { content: RecordedPut }
        putCount += 1
        if (putCount === 1) await delay(60)
        rec.events.push('PUT')
        rec.puts.push({ answers: body.content.answers })
        return HttpResponse.json(submissionResponse())
      }),
    )

    const { getApi } = renderHarness(999_999) // cadence irrelevant — flush explicitly
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'Q1')
    const first = api.flush() // seq1 — PUT {Q1}, delayed 60ms
    // Let runSave START (read {Q1} + capture its edit generation) and suspend on
    // the delayed PUT, THEN land the edit — so it is genuinely "during flight".
    await delay(10)
    api.setAnswer('0:0:1', 'Q2')
    api.scheduleSave() // bumps the edit generation AFTER seq1 captured its own
    await first

    // The completing seq1 must NOT clear dirty / report "saved": Q2 was not in it.
    expect(useQuizAttemptStore.getState().saveStatus).toBe('unsaved')

    // The next save carries the FULL {Q1,Q2} and only then reports "saved".
    await api.flush()
    expect(rec.puts[1].answers).toEqual({ '0:0:0': 'Q1', '0:0:1': 'Q2' })
    await waitFor(() =>
      expect(useQuizAttemptStore.getState().saveStatus).toBe('saved'),
    )
  })
})

describe('finalizeAttempt wired to autosave — 0:00 convergence (WF-8 #6 BLOCKER)', () => {
  test('in-flight save + expiry flush + submit → PUT(final)→POST, POST once, POST after flush', async () => {
    const rec = installRecorder()
    // Delay the first PUT so the finalize flush races an in-flight autosave.
    let putCount = 0
    server.use(
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
        const body = (await request.json()) as { content: RecordedPut }
        putCount += 1
        if (putCount === 1) await delay(50)
        rec.events.push('PUT')
        rec.puts.push({ answers: body.content.answers })
        return HttpResponse.json(submissionResponse())
      }),
    )

    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'Q1')
    const inflight = api.flush() // the "30s" autosave, in-flight (delayed)
    // Expiry converges: finalize flushes the latest content then POSTs.
    const result = await api.finalize()
    await inflight

    expect(result.kind).toBe('submitted')
    // POST fired exactly once, and only AFTER the final PUT.
    expect(rec.posts).toBe(1)
    expect(rec.events[rec.events.length - 1]).toBe('POST')
    const lastPutIdx = rec.events.lastIndexOf('PUT')
    const postIdx = rec.events.indexOf('POST')
    expect(lastPutIdx).toBeLessThan(postIdx)
  })

  test('finalize happy-path with nothing in flight → one PUT then one POST (WF-8 #7)', async () => {
    const rec = installRecorder()
    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'Q1')
    const result = await api.finalize()

    expect(result.kind).toBe('submitted')
    expect(rec.events).toEqual(['PUT', 'POST'])
    expect(rec.posts).toBe(1)
  })
})

describe('useAttemptAutosave — flush-on-unmount beacon (WF-8 #10)', () => {
  test('pending edits are beaconed to the progress endpoint on unmount', async () => {
    const rec = installRecorder()
    const { getApi, unmount } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setAnswer('0:0:0', 'draft')
    api.scheduleSave() // dirty, but the 30s timer will not fire in this test

    unmount()

    await waitFor(() => expect(rec.puts.length).toBe(1))
    expect(rec.puts[0].answers).toEqual({ '0:0:0': 'draft' })
  })
})
