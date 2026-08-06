// Story 5.2b Task 4 (AC22) → Story 5.2d Task 3 (AC4). The GENERIC localStorage
// mirror: read/write/clear are content-agnostic (injected normalizer) and
// `reconcileDrafts` delegates to an injected merge, returning the merge-defined
// conflict signal. The QUIZ reconcile semantics (server-wins / recover / flag
// union) moved to `quiz-attempt/lib/__tests__/quizDraftReconcile.test.ts`.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  clearStoredDraft,
  reconcileDrafts,
  readStoredDraft,
  writeStoredDraft,
  type DraftMerge,
} from '../attemptDraftStorage'

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

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('read/write/clear round-trip (content-generic)', () => {
  test('write then read returns the normalized content', () => {
    const content: Doc = { schemaVersion: 1, value: 'hello' }
    writeStoredDraft(SUB, content)
    expect(readStoredDraft(SUB, normalize)).toEqual(content)
  })

  test('absent key → null', () => {
    expect(readStoredDraft('nope', normalize)).toBeNull()
  })

  test('corrupt JSON → null (never throws)', () => {
    window.localStorage.setItem('classlite:attempt-draft:sub-1', '{not json')
    expect(readStoredDraft(SUB, normalize)).toBeNull()
  })

  test('clear removes the mirror', () => {
    writeStoredDraft(SUB, { schemaVersion: 1, value: 'x' })
    clearStoredDraft(SUB)
    expect(readStoredDraft(SUB, normalize)).toBeNull()
  })

  test('keys are per-submission', () => {
    writeStoredDraft('a', { schemaVersion: 1, value: 'A' })
    writeStoredDraft('b', { schemaVersion: 1, value: 'B' })
    expect(readStoredDraft('a', normalize)?.value).toBe('A')
    expect(readStoredDraft('b', normalize)?.value).toBe('B')
  })
})

describe('reconcileDrafts delegates to the injected merge (AC4)', () => {
  // A whole-value replace merge (local-newer-wins); conflict = "did they differ".
  const replaceMerge: DraftMerge<Doc, { changed: boolean }> = (local, server) => {
    if (local === null) return { merged: server, conflict: { changed: false } }
    return { merged: local, conflict: { changed: local.value !== server.value } }
  }

  test('null local → server passes through; merge reports no conflict', () => {
    const server: Doc = { schemaVersion: 1, value: 'srv' }
    const r = reconcileDrafts(null, server, replaceMerge)
    expect(r.merged).toEqual(server)
    expect(r.conflict.changed).toBe(false)
  })

  test('non-null local → the merge output is returned verbatim (merge-defined signal)', () => {
    const local: Doc = { schemaVersion: 1, value: 'mine' }
    const server: Doc = { schemaVersion: 1, value: 'srv' }
    const r = reconcileDrafts(local, server, replaceMerge)
    expect(r.merged.value).toBe('mine') // this merge is local-newer-wins
    expect(r.conflict.changed).toBe(true)
  })
})
