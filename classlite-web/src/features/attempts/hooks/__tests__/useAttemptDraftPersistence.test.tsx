// Story 5.2b Task 4 (AC22) → Story 5.2d Task 3/4 (AC4/AC5). The GENERIC
// write-through mirror + load-time reconcile-into-cache, driven by a synthetic
// non-quiz content shape + an injected reconcile config. The 5.2b CRITICAL #2
// seed-before-write ordering guard and the once-guarded reconcile are
// characterization-tested here, content-agnostic.
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '../../api/attemptKeys'
import {
  readStoredDraft,
  writeStoredDraft,
  type DraftMerge,
} from '../../lib/attemptDraftStorage'
import {
  reconcileStoredDraftIntoCache,
  useAttemptDraftPersistence,
  type ReconcileConfig,
} from '../useAttemptDraftPersistence'

const SUB = 'sub-1'

/** A synthetic non-quiz content shape — proves the layer reads no quiz field. */
interface Doc {
  schemaVersion: 1
  value: string
}
function normalize(raw: unknown): Doc {
  if (raw !== null && typeof raw === 'object') {
    const value = (raw as Record<string, unknown>).value
    if (typeof value === 'string') return { schemaVersion: 1, value }
  }
  return { schemaVersion: 1, value: '' }
}
interface DocConflict {
  changed: boolean
  recovered: boolean
}
const NO_CONFLICT: DocConflict = { changed: false, recovered: false }
// A merge that recovers when the server is empty, else server-wins on a diff.
const merge: DraftMerge<Doc, DocConflict> = (local, server) => {
  if (local === null) return { merged: server, conflict: { ...NO_CONFLICT } }
  if (server.value === '') {
    return { merged: { schemaVersion: 1, value: local.value }, conflict: { changed: false, recovered: true } }
  }
  return { merged: server, conflict: { changed: local.value !== server.value, recovered: false } }
}
const config: ReconcileConfig<Doc, DocConflict> = { normalize, merge, noConflict: NO_CONFLICT }

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** Seed the draft cache slot so the write-through gate (Review Patch #2) is open. */
function seededClient(seed: Doc): QueryClient {
  const client = createTestQueryClient()
  client.setQueryData<Doc>(attemptKeys.draft(SUB), seed)
  return client
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useAttemptDraftPersistence — write-through', () => {
  test('mirrors the content to localStorage on mount and on change (once seeded)', () => {
    const content: Doc = { schemaVersion: 1, value: 'x' }
    const client = seededClient(content)
    const { rerender } = renderHook(
      ({ c }) => useAttemptDraftPersistence({ submissionId: SUB, content: c }),
      { initialProps: { c: content }, wrapper: wrapperFor(client) },
    )
    expect(readStoredDraft(SUB, normalize)?.value).toBe('x')

    const next: Doc = { schemaVersion: 1, value: 'xy' }
    rerender({ c: next })
    expect(readStoredDraft(SUB, normalize)?.value).toBe('xy')
  })

  test('does not write when disabled (read-only attempt)', () => {
    const client = seededClient({ schemaVersion: 1, value: '' })
    renderHook(
      () =>
        useAttemptDraftPersistence({
          submissionId: SUB,
          content: { schemaVersion: 1, value: 'b' } as Doc,
          enabled: false,
        }),
      { wrapper: wrapperFor(client) },
    )
    expect(readStoredDraft(SUB, normalize)).toBeNull()
  })

  // Review Patch #2 (CRITICAL #2) — the child write-through effect runs before the
  // page's reconcile effect. Before the cache slot is seeded it must NOT write,
  // or it clobbers the crash-recovery mirror with the empty draft (AC22).
  test('does NOT write before the draft cache is seeded — no clobber of the recovery mirror', () => {
    const recovery: Doc = { schemaVersion: 1, value: 'unsaved-before-crash' }
    writeStoredDraft(SUB, recovery) // a pre-existing mirror from before the reload
    const unseeded = createTestQueryClient() // slot NOT seeded yet

    renderHook(
      () =>
        useAttemptDraftPersistence({
          submissionId: SUB,
          content: { schemaVersion: 1, value: '' } as Doc, // pre-seed empty draft
        }),
      { wrapper: wrapperFor(unseeded) },
    )

    // Mirror untouched — recovery data survives for reconcile to read.
    expect(readStoredDraft(SUB, normalize)).toEqual(recovery)
  })

  // Review Patch #7 — quota/disabled surfaces once via onMirrorUnavailable.
  test('fires onMirrorUnavailable exactly once when the mirror write fails', () => {
    const client = seededClient({ schemaVersion: 1, value: '' })
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
        initialProps: { c: { schemaVersion: 1, value: '1' } as Doc },
        wrapper: wrapperFor(client),
      },
    )
    rerender({ c: { schemaVersion: 1, value: '2' } })

    expect(onMirrorUnavailable).toHaveBeenCalledTimes(1) // once, not per change
  })
})

describe('reconcileStoredDraftIntoCache — load-time recovery (injected config)', () => {
  test('recovers from the mirror into the seeded draft cache (merge-defined)', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, value: 'unsaved' } as Doc)
    const client = createTestQueryClient()

    const result = reconcileStoredDraftIntoCache(
      client,
      SUB,
      { schemaVersion: 1, value: '' }, // server empty → the merge recovers local
      config,
    )

    expect(result.conflict.recovered).toBe(true)
    const seeded = client.getQueryData<Doc>(attemptKeys.draft(SUB))
    expect(seeded?.value).toBe('unsaved')
  })

  test('seeds the merged draft and flags a conflict on first load (empty slot)', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, value: 'localEdit' } as Doc)
    const client = createTestQueryClient()

    const result = reconcileStoredDraftIntoCache(
      client,
      SUB,
      { schemaVersion: 1, value: 'server' },
      config,
    )

    expect(result.conflict.changed).toBe(true)
    // server wins on conflict (this merge)
    expect(
      client.getQueryData<Doc>(attemptKeys.draft(SUB))?.value,
    ).toBe('server')
  })

  // Review Patch #4 — a remount (slot already seeded) must not re-report a
  // resolved conflict/recovery, else the page re-fires the toast every remount.
  test('on remount (already-seeded slot): no clobber AND returns noConflict', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, value: 'localEdit' } as Doc)
    const client = createTestQueryClient()
    // Pre-seed the slot (simulating a prior mount): reconcile must not overwrite.
    client.setQueryData<Doc>(attemptKeys.draft(SUB), {
      schemaVersion: 1,
      value: 'inProgress',
    })

    const result = reconcileStoredDraftIntoCache(
      client,
      SUB,
      { schemaVersion: 1, value: 'server' },
      config,
    )

    expect(result.conflict).toEqual(NO_CONFLICT)
    expect(
      client.getQueryData<Doc>(attemptKeys.draft(SUB))?.value,
    ).toBe('inProgress') // untouched
  })
})
