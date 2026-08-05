// Story 5.2b Task 4 (AC22) — localStorage mirror + reconcile, RED-first.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  clearStoredDraft,
  reconcileDrafts,
  readStoredDraft,
  writeStoredDraft,
} from '../attemptDraftStorage'
import { emptyAttemptContent, type AttemptContent } from '../attemptContent'

const SUB = 'sub-1'

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('read/write/clear round-trip', () => {
  test('write then read returns the normalized content', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:0': 'x' },
      flagged: ['0:0:0'],
    }
    writeStoredDraft(SUB, content)
    expect(readStoredDraft(SUB)).toEqual(content)
  })

  test('absent key → null', () => {
    expect(readStoredDraft('nope')).toBeNull()
  })

  test('corrupt JSON → null (never throws)', () => {
    window.localStorage.setItem('classlite:attempt-draft:sub-1', '{not json')
    expect(readStoredDraft(SUB)).toBeNull()
  })

  test('clear removes the mirror', () => {
    writeStoredDraft(SUB, emptyAttemptContent())
    clearStoredDraft(SUB)
    expect(readStoredDraft(SUB)).toBeNull()
  })

  test('drafts are keyed per submission (no cross-talk)', () => {
    writeStoredDraft('a', { schemaVersion: 1, answers: { '0:0:0': 'A' }, flagged: [] })
    writeStoredDraft('b', { schemaVersion: 1, answers: { '0:0:0': 'B' }, flagged: [] })
    expect(readStoredDraft('a')?.answers).toEqual({ '0:0:0': 'A' })
    expect(readStoredDraft('b')?.answers).toEqual({ '0:0:0': 'B' })
  })
})

describe('reconcileDrafts (AC22 — server wins on conflict)', () => {
  const server: AttemptContent = {
    schemaVersion: 1,
    answers: { '0:0:0': 'server', '0:0:1': 'shared' },
    flagged: ['0:0:0'],
  }

  test('no local mirror → server passes through untouched', () => {
    const r = reconcileDrafts(null, server)
    expect(r.merged).toEqual(server)
    expect(r.hadConflict).toBe(false)
    expect(r.recoveredLocalOnly).toBe(false)
  })

  test('recovers a local-only answer the server never saw (crash case)', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:2': 'unsaved' },
      flagged: [],
    }
    const r = reconcileDrafts(local, server)
    expect(r.merged.answers['0:0:2']).toBe('unsaved')
    expect(r.recoveredLocalOnly).toBe(true)
    expect(r.hadConflict).toBe(false)
  })

  test('server wins on a conflicting handle; conflict flagged for the toast', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:1': 'localEdit' }, // differs from server "shared"
      flagged: [],
    }
    const r = reconcileDrafts(local, server)
    expect(r.merged.answers['0:0:1']).toBe('shared') // server wins
    expect(r.hadConflict).toBe(true)
  })

  test('a local whitespace answer never overrides nor recovers', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:2': '   ' },
      flagged: [],
    }
    const r = reconcileDrafts(local, server)
    expect(r.merged.answers['0:0:2']).toBeUndefined()
    expect(r.recoveredLocalOnly).toBe(false)
  })

  test('flags are unioned (non-destructive)', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: {},
      flagged: ['0:0:1'],
    }
    const r = reconcileDrafts(local, server)
    expect(new Set(r.merged.flagged)).toEqual(new Set(['0:0:0', '0:0:1']))
  })
})
