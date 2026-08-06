// Story 5.2d Task 4 (AC4/AC5) — the generic-contract harness. A SYNTHETIC,
// non-quiz (string-shaped) content type drives the extracted spine, proving the
// primitives are genuinely content-generic — coverage the quiz suite
// structurally cannot give (it only ever exercises the quiz `{answers,flagged}`
// object shape). Real QueryClient + MSW at the HTTP boundary (TEST-FE-1), real
// timers with an injected short cadence.
import { useEffect, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { server } from '@/test/msw-server'
import {
  useAttemptAutosave,
  readStoredDraft,
  writeStoredDraft,
  reconcileStoredDraftIntoCache,
  attemptKeys,
  SaveStatusIndicator,
  type DraftMerge,
  type ReconcileConfig,
} from '@/features/attempts'
import { initialState, useAttemptStore } from '@/stores/attemptStore'

const SUBMISSION_ID = 'sub-generic'

/** A synthetic non-quiz content: a single opaque string value. */
interface StringDoc {
  schemaVersion: 1
  value: string
}
function normalizeStringDoc(raw: unknown): StringDoc {
  if (raw !== null && typeof raw === 'object') {
    const value = (raw as Record<string, unknown>).value
    if (typeof value === 'string') return { schemaVersion: 1, value }
  }
  return { schemaVersion: 1, value: '' }
}

interface RecordedPut {
  value: string
}
interface Recorder {
  puts: RecordedPut[]
}

function submissionResponse() {
  return {
    data: { id: SUBMISSION_ID, status: 'in_progress', content: {}, schemaVersion: 1 },
    meta: { serverTime: '2026-08-05T00:00:00Z' },
  }
}

interface HarnessApi {
  setValue: (value: string) => void
  scheduleSave: () => void
  flush: () => Promise<void>
}

function Harness({
  onReady,
  intervalMs,
}: {
  onReady: (api: HarnessApi) => void
  intervalMs: number
}) {
  const draftRef = useRef<StringDoc>({ schemaVersion: 1, value: '' })
  const { scheduleSave, flush } = useAttemptAutosave<StringDoc>(SUBMISSION_ID, {
    getContent: () => draftRef.current,
    intervalMs,
  })
  useEffect(() => {
    onReady({
      setValue: (value) => {
        draftRef.current = { schemaVersion: 1, value }
      },
      scheduleSave,
      flush,
    })
  }, [onReady, scheduleSave, flush])
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

function renderHarness(intervalMs: number) {
  let api!: HarnessApi
  const client = createTestQueryClient()
  render(
    <QueryClientProvider client={client}>
      <Harness intervalMs={intervalMs} onReady={(a) => (api = a)} />
    </QueryClientProvider>,
  )
  return { getApi: () => api }
}

function installRecorder(putStatuses: number[] = []): Recorder {
  const rec: Recorder = { puts: [] }
  let putIndex = 0
  server.use(
    http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
      const body = (await request.json()) as { content: RecordedPut }
      const status = putStatuses[putIndex] ?? 200
      putIndex += 1
      rec.puts.push({ value: body.content.value })
      if (status !== 200) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status },
        )
      }
      return HttpResponse.json(submissionResponse())
    }),
  )
  return rec
}

beforeEach(() => {
  seedSession()
  useAttemptStore.setState({ ...initialState })
  window.localStorage.clear()
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  useAttemptStore.setState({ ...initialState })
  window.localStorage.clear()
  server.resetHandlers()
})

describe('generic autosave — full-replace no-data-loss over a string shape (AC4)', () => {
  test('a failed save keeps the edit; the retried PUT carries the FULL latest value', async () => {
    const rec = installRecorder([503, 200])
    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setValue('AB')
    await expect(api.flush()).rejects.toBeTruthy() // PUT #1 'AB' → 503
    expect(rec.puts[0].value).toBe('AB')
    await waitFor(() => expect(useAttemptStore.getState().saveStatus).toBe('error'))

    api.setValue('ABCD')
    await api.flush() // PUT #2 → 200
    // The retried body is the FULL latest value, not the stale in-flight body.
    expect(rec.puts[1].value).toBe('ABCD')
    await waitFor(() => expect(useAttemptStore.getState().saveStatus).toBe('saved'))
  })
})

describe('generic autosave — saveSeq out-of-order guard over a string shape (AC4)', () => {
  test('the newest save wins; a superseded save never reports "saved"', async () => {
    const rec = installRecorder()
    let putCount = 0
    server.use(
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
        const body = (await request.json()) as { content: RecordedPut }
        putCount += 1
        if (putCount === 1) await delay(60)
        rec.puts.push({ value: body.content.value })
        return HttpResponse.json(submissionResponse())
      }),
    )

    let savedTransitions = 0
    let prev = useAttemptStore.getState().saveStatus
    const unsub = useAttemptStore.subscribe((s) => {
      if (s.saveStatus === 'saved' && prev !== 'saved') savedTransitions += 1
      prev = s.saveStatus
    })

    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setValue('A')
    const first = api.flush() // seq1, delayed
    api.setValue('AB')
    const second = api.flush() // seq2, chained after seq1
    await Promise.all([first, second])
    unsub()

    expect(rec.puts.length).toBe(2)
    expect(rec.puts[1].value).toBe('AB') // newest full value last
    expect(savedTransitions).toBe(1) // only the newest reported 'saved'
    expect(useAttemptStore.getState().saveStatus).toBe('saved')
  })
})

describe('generic autosave — edit during an in-flight save over a string shape (AC4)', () => {
  test('an edit made WHILE a PUT is in flight is not falsely reported "saved"', async () => {
    const rec = installRecorder()
    let putCount = 0
    server.use(
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
        const body = (await request.json()) as { content: RecordedPut }
        putCount += 1
        if (putCount === 1) await delay(60)
        rec.puts.push({ value: body.content.value })
        return HttpResponse.json(submissionResponse())
      }),
    )

    const { getApi } = renderHarness(999_999)
    await waitFor(() => expect(getApi()).toBeTruthy())
    const api = getApi()

    api.setValue('A')
    const first = api.flush() // seq1 — PUT 'A', delayed 60ms
    await delay(10)
    api.setValue('AB')
    api.scheduleSave() // bumps the edit generation AFTER seq1 captured its own
    await first

    // The completing seq1 must NOT clear dirty / report "saved": 'AB' wasn't in it.
    expect(useAttemptStore.getState().saveStatus).toBe('unsaved')

    await api.flush()
    expect(rec.puts[1].value).toBe('AB')
    await waitFor(() => expect(useAttemptStore.getState().saveStatus).toBe('saved'))
  })
})

describe('generic reconcile — injected normalizer + injected merge (AC4)', () => {
  // A whole-value replace merge (the writing-style policy): local-newer-wins,
  // conflict = whether the two differed.
  const wholeReplace: DraftMerge<StringDoc, { changed: boolean }> = (local, server) => {
    if (local === null) return { merged: server, conflict: { changed: false } }
    return { merged: local, conflict: { changed: local.value !== server.value } }
  }
  const config: ReconcileConfig<StringDoc, { changed: boolean }> = {
    normalize: normalizeStringDoc,
    merge: wholeReplace,
    noConflict: { changed: false },
  }

  test('the injected normalizer coerces a stored blob back into T on read', () => {
    // An untrusted blob with an extra field + the value we want.
    window.localStorage.setItem(
      'classlite:attempt-draft:sub-generic',
      JSON.stringify({ value: 'restored', junk: 42 }),
    )
    const read = readStoredDraft(SUBMISSION_ID, normalizeStringDoc)
    expect(read).toEqual({ schemaVersion: 1, value: 'restored' })
  })

  test('the injected merge decides the merged value + conflict signal', () => {
    writeStoredDraft(SUBMISSION_ID, { schemaVersion: 1, value: 'localNewer' })
    const client = createTestQueryClient()
    const result = reconcileStoredDraftIntoCache(
      client,
      SUBMISSION_ID,
      { value: 'server' }, // server content (opaque blob)
      config,
    )
    // whole-value replace → local wins, conflict flagged because they differ.
    expect(result.merged.value).toBe('localNewer')
    expect(result.conflict.changed).toBe(true)
    expect(
      client.getQueryData<StringDoc>(attemptKeys.draft(SUBMISSION_ID))?.value,
    ).toBe('localNewer')
  })
})

describe('SaveStatusIndicator — the forward-ready offline branch (AC3)', () => {
  test('renders the offline label + data-status when the store is offline', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SaveStatusIndicator />
      </I18nextProvider>,
    )
    act(() => useAttemptStore.getState().setSaveStatus('offline'))

    const el = screen.getByTestId('save-status')
    expect(el).toHaveAttribute('data-status', 'offline')
    expect(el).toHaveTextContent(i18n.t('attempt.save.offline'))
  })
})
