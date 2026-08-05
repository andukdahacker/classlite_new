// Story 5.2b Task 4 (AC22) — write-through mirror + load-time reconcile-into-cache.
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '../../api/attemptKeys'
import {
  readStoredDraft,
  writeStoredDraft,
} from '../../lib/attemptDraftStorage'
import type { AttemptContent } from '../../lib/attemptContent'
import {
  reconcileStoredDraftIntoCache,
  useAttemptDraftPersistence,
} from '../useAttemptDraftPersistence'

const SUB = 'sub-1'

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** Seed the draft cache slot so the write-through gate (Review Patch #2) is open. */
function seededClient(seed: AttemptContent): QueryClient {
  const client = createTestQueryClient()
  client.setQueryData<AttemptContent>(attemptKeys.draft(SUB), seed)
  return client
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useAttemptDraftPersistence — write-through', () => {
  test('mirrors the content to localStorage on mount and on change (once seeded)', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:0': 'x' },
      flagged: [],
    }
    const client = seededClient(content)
    const { rerender } = renderHook(
      ({ c }) => useAttemptDraftPersistence({ submissionId: SUB, content: c }),
      { initialProps: { c: content }, wrapper: wrapperFor(client) },
    )
    expect(readStoredDraft(SUB)?.answers).toEqual({ '0:0:0': 'x' })

    const next: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:0': 'x', '0:0:1': 'y' },
      flagged: [],
    }
    rerender({ c: next })
    expect(readStoredDraft(SUB)?.answers).toEqual({ '0:0:0': 'x', '0:0:1': 'y' })
  })

  test('does not write when disabled (read-only attempt)', () => {
    const client = seededClient({ schemaVersion: 1, answers: {}, flagged: [] })
    renderHook(
      () =>
        useAttemptDraftPersistence({
          submissionId: SUB,
          content: { schemaVersion: 1, answers: { a: 'b' }, flagged: [] },
          enabled: false,
        }),
      { wrapper: wrapperFor(client) },
    )
    expect(readStoredDraft(SUB)).toBeNull()
  })

  // Review Patch #2 (CRITICAL) — the child write-through effect runs before the
  // page's reconcile effect. Before the cache slot is seeded it must NOT write,
  // or it clobbers the crash-recovery mirror with the empty draft (AC22).
  test('does NOT write before the draft cache is seeded — no clobber of the recovery mirror', () => {
    const recovery: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:2': 'unsaved-before-crash' },
      flagged: ['0:0:2'],
    }
    writeStoredDraft(SUB, recovery) // a pre-existing mirror from before the reload
    const unseeded = createTestQueryClient() // slot NOT seeded yet

    renderHook(
      () =>
        useAttemptDraftPersistence({
          submissionId: SUB,
          content: { schemaVersion: 1, answers: {}, flagged: [] }, // pre-seed empty draft
        }),
      { wrapper: wrapperFor(unseeded) },
    )

    // Mirror untouched — recovery data survives for reconcile to read.
    expect(readStoredDraft(SUB)).toEqual(recovery)
  })

  // Review Patch #7 — quota/disabled surfaces once via onMirrorUnavailable.
  test('fires onMirrorUnavailable exactly once when the mirror write fails', () => {
    const client = seededClient({ schemaVersion: 1, answers: {}, flagged: [] })
    // Spy the prototype method — jsdom's localStorage instance does not shadow.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const onMirrorUnavailable = vi.fn()

    const { rerender } = renderHook(
      ({ c }) =>
        useAttemptDraftPersistence({
          submissionId: SUB,
          content: c,
          onMirrorUnavailable,
        }),
      {
        initialProps: { c: { schemaVersion: 1, answers: { a: '1' }, flagged: [] } as AttemptContent },
        wrapper: wrapperFor(client),
      },
    )
    rerender({ c: { schemaVersion: 1, answers: { a: '2' }, flagged: [] } })

    expect(onMirrorUnavailable).toHaveBeenCalledTimes(1) // once, not per change
  })
})

describe('reconcileStoredDraftIntoCache — load-time recovery', () => {
  test('recovers a local-only answer into the seeded draft cache', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, answers: { '0:0:2': 'unsaved' }, flagged: [] })
    const client = createTestQueryClient()

    const result = reconcileStoredDraftIntoCache(client, SUB, {
      schemaVersion: 1,
      answers: { '0:0:0': 'server' },
      flagged: [],
    })

    expect(result.recoveredLocalOnly).toBe(true)
    const seeded = client.getQueryData<AttemptContent>(attemptKeys.draft(SUB))
    expect(seeded?.answers).toEqual({ '0:0:0': 'server', '0:0:2': 'unsaved' })
  })

  test('seeds the merged draft and flags a conflict on first load (empty slot)', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, answers: { '0:0:0': 'localEdit' }, flagged: [] })
    const client = createTestQueryClient()

    const result = reconcileStoredDraftIntoCache(client, SUB, {
      schemaVersion: 1,
      answers: { '0:0:0': 'server' },
      flagged: [],
    })

    expect(result.hadConflict).toBe(true)
    // server wins on conflict
    expect(
      client.getQueryData<AttemptContent>(attemptKeys.draft(SUB))?.answers,
    ).toEqual({ '0:0:0': 'server' })
  })

  // Review Patch #4 — a remount (slot already seeded) must not re-report a
  // resolved conflict/recovery, else the page re-fires the toast every remount.
  test('on remount (already-seeded slot): no clobber AND no re-reported flags', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, answers: { '0:0:0': 'localEdit' }, flagged: [] })
    const client = createTestQueryClient()
    // Pre-seed the slot (simulating a prior mount): reconcile must not overwrite.
    client.setQueryData<AttemptContent>(attemptKeys.draft(SUB), {
      schemaVersion: 1,
      answers: { '0:0:0': 'inProgress' },
      flagged: [],
    })

    const result = reconcileStoredDraftIntoCache(client, SUB, {
      schemaVersion: 1,
      answers: { '0:0:0': 'server' },
      flagged: [],
    })

    expect(result.hadConflict).toBe(false)
    expect(result.recoveredLocalOnly).toBe(false)
    expect(
      client.getQueryData<AttemptContent>(attemptKeys.draft(SUB))?.answers,
    ).toEqual({ '0:0:0': 'inProgress' }) // untouched
  })
})
