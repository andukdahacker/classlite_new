// Story 5.2d Task 3 (AC4) — the QUIZ reconcile merge, extracted from the
// pre-extraction attemptDraftStorage suite. Server wins on conflict (AC22), a
// local-only answer the server never saw is recovered, flags are unioned. The
// quiz-flavored conflict signal now lives on the quiz side, not the generic layer.
import { describe, expect, test } from 'vitest'
import { reconcileQuizDrafts } from '../quizDraftReconcile'
import type { AttemptContent } from '../attemptContent'

const server: AttemptContent = {
  schemaVersion: 1,
  answers: { '0:0:0': 'server', '0:0:1': 'shared' },
  flagged: ['0:0:0'],
}

describe('reconcileQuizDrafts (AC22 — server wins on conflict)', () => {
  test('no local mirror → server passes through untouched', () => {
    const r = reconcileQuizDrafts(null, server)
    expect(r.merged).toEqual(server)
    expect(r.conflict.hadConflict).toBe(false)
    expect(r.conflict.recoveredLocalOnly).toBe(false)
  })

  test('recovers a local-only answer the server never saw (crash case)', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:2': 'unsaved' },
      flagged: [],
    }
    const r = reconcileQuizDrafts(local, server)
    expect(r.merged.answers['0:0:2']).toBe('unsaved')
    expect(r.conflict.recoveredLocalOnly).toBe(true)
    expect(r.conflict.hadConflict).toBe(false)
  })

  test('server wins on a conflicting handle; conflict flagged for the toast', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:1': 'localEdit' }, // differs from server "shared"
      flagged: [],
    }
    const r = reconcileQuizDrafts(local, server)
    expect(r.merged.answers['0:0:1']).toBe('shared') // server wins
    expect(r.conflict.hadConflict).toBe(true)
  })

  test('a local whitespace answer never overrides nor recovers', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:2': '   ' },
      flagged: [],
    }
    const r = reconcileQuizDrafts(local, server)
    expect(r.merged.answers['0:0:2']).toBeUndefined()
    expect(r.conflict.recoveredLocalOnly).toBe(false)
  })

  test('flags are unioned (non-destructive)', () => {
    const local: AttemptContent = {
      schemaVersion: 1,
      answers: {},
      flagged: ['0:0:1'],
    }
    const r = reconcileQuizDrafts(local, server)
    expect(new Set(r.merged.flagged)).toEqual(new Set(['0:0:0', '0:0:1']))
  })
})
