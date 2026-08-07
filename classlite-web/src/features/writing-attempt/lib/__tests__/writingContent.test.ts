// Story 5.3 Task 1 (AC4/AC6/AC12) — the writing content model, RED-first.
// Pure functions: the `{schemaVersion:1,text}` shape + normalize, the IME-safe
// `countWords` full edge table, the `WRITING_MIN_WORDS` task-type map, and the
// whole-value reconcile merge (D4 — LOCAL-newer-wins on no-foreign-change,
// server-wins ONLY on a detected foreign signal, the party-mode BLOCKER oracle).
import { describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import {
  WRITING_CONTENT_SCHEMA_VERSION,
  WRITING_MIN_WORDS,
  DEFAULT_MIN_WORDS,
  emptyWritingContent,
  normalizeWritingContent,
  countWords,
  minWordsFor,
  makeWritingMerge,
  reconcileWritingDrafts,
  WRITING_NO_CONFLICT,
  type WritingContent,
} from '../writingContent'

type AttemptExercise = components['schemas']['AttemptExercise']

function exercise(overrides: Partial<AttemptExercise> = {}): AttemptExercise {
  return {
    id: 'ex-1',
    title: 'IELTS Writing',
    skill: 'writing',
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
    sections: [],
    ...overrides,
  }
}

describe('writingContent — shape + normalize (AC4)', () => {
  test('emptyWritingContent is a versioned blank draft', () => {
    expect(emptyWritingContent()).toEqual({
      schemaVersion: WRITING_CONTENT_SCHEMA_VERSION,
      text: '',
    })
  })

  test('normalize a well-formed bag round-trips the text and re-stamps version', () => {
    expect(normalizeWritingContent({ schemaVersion: 1, text: 'hello' })).toEqual({
      schemaVersion: 1,
      text: 'hello',
    })
  })

  test('normalize is safe on a missing/old schemaVersion — re-stamps, never throws', () => {
    expect(normalizeWritingContent({ text: 'legacy' })).toEqual({
      schemaVersion: 1,
      text: 'legacy',
    })
    expect(normalizeWritingContent({ schemaVersion: 0, text: 'old' })).toEqual({
      schemaVersion: 1,
      text: 'old',
    })
  })

  test('normalize degrades a non-string / null / non-object to empty text', () => {
    expect(normalizeWritingContent(null)).toEqual(emptyWritingContent())
    expect(normalizeWritingContent(42)).toEqual(emptyWritingContent())
    expect(normalizeWritingContent({ text: 123 })).toEqual(emptyWritingContent())
    expect(normalizeWritingContent({})).toEqual(emptyWritingContent())
    expect(normalizeWritingContent([])).toEqual(emptyWritingContent())
  })
})

describe('countWords — full edge table (AC6)', () => {
  test.each<[string, string, number]>([
    ['empty', '', 0],
    ['only spaces', '     ', 0],
    ['only tabs + newlines', '\t\n\r\n  \t', 0],
    ['single token', 'hello', 1],
    ['two words', 'hello world', 2],
    ['multi-space between', 'hello     world', 2],
    ['tabs between', 'hello\tworld', 2],
    ['CRLF newline between', 'hello\r\nworld', 2],
    ['LF newline between', 'hello\nworld', 2],
    ['leading + trailing whitespace', '   hello world   ', 2],
    ['blank paragraphs', 'a\n\n\n\nb', 2],
    ['very long single token', 'a'.repeat(500), 1],
    ['VN diacritic words', 'Xin chào các bạn', 4],
    ['VN sentence with punctuation', 'Tôi thích học tiếng Anh.', 5],
  ])('%s → %i', (_label, input, expected) => {
    expect(countWords(input)).toBe(expected)
  })
})

describe('minWordsFor — client task-type default map (AC6, D3)', () => {
  test('the map documents the IELTS Task-1 / Task-2 defaults', () => {
    expect(WRITING_MIN_WORDS.task1).toBe(150)
    expect(WRITING_MIN_WORDS.task2).toBe(250)
    expect(DEFAULT_MIN_WORDS).toBe(250)
  })

  test('a Task 1 exercise title resolves to 150', () => {
    expect(minWordsFor(exercise({ title: 'IELTS Writing Task 1 — Chart' }))).toBe(150)
    expect(minWordsFor(exercise({ title: 'writing task1 practice' }))).toBe(150)
  })

  test('a Task 2 exercise title resolves to 250', () => {
    expect(minWordsFor(exercise({ title: 'IELTS Writing Task 2 — Essay' }))).toBe(250)
  })

  test('an untagged title falls back to the documented default (250)', () => {
    expect(minWordsFor(exercise({ title: 'Free Writing' }))).toBe(DEFAULT_MIN_WORDS)
    expect(minWordsFor(exercise({ title: '' }))).toBe(DEFAULT_MIN_WORDS)
  })
})

describe('reconcileWritingDrafts — whole-value merge (AC12, D4 BLOCKER oracle)', () => {
  const server: WritingContent = { schemaVersion: 1, text: 'server pre-offline text' }

  test('no local mirror → server wins, no conflict', () => {
    const result = reconcileWritingDrafts(null, server)
    expect(result.merged).toEqual(server)
    expect(result.conflict).toEqual(WRITING_NO_CONFLICT)
  })

  test('identical local + server → server (no-op), no conflict', () => {
    const local: WritingContent = { schemaVersion: 1, text: server.text }
    const result = reconcileWritingDrafts(local, server)
    expect(result.merged.text).toBe(server.text)
    expect(result.conflict.recoveredLocalNewer).toBe(false)
    expect(result.conflict.serverWonForeign).toBe(false)
  })

  test('NO foreign change: a divergent LOCAL draft is NEWER and WINS (never clobbered)', () => {
    // The student typed offline; the mirror is strictly newer than the stale
    // server autosave. Server-wins here would DELETE the offline paragraphs.
    const local: WritingContent = {
      schemaVersion: 1,
      text: 'server pre-offline text PLUS three offline paragraphs',
    }
    const result = reconcileWritingDrafts(local, server)
    expect(result.merged.text).toBe(local.text)
    expect(result.conflict.recoveredLocalNewer).toBe(true)
    expect(result.conflict.serverWonForeign).toBe(false)
  })

  test('foreign signal set → SERVER wins (the AC13 detected-concurrent-writer path)', () => {
    const foreignMerge = makeWritingMerge(true)
    const local: WritingContent = { schemaVersion: 1, text: 'my local edits' }
    const result = foreignMerge(local, server)
    expect(result.merged.text).toBe(server.text)
    expect(result.conflict.serverWonForeign).toBe(true)
    expect(result.conflict.recoveredLocalNewer).toBe(false)
  })

  test('local cleared to empty offline is still the newer intent and wins (no foreign)', () => {
    const local: WritingContent = { schemaVersion: 1, text: '' }
    const result = reconcileWritingDrafts(local, server)
    expect(result.merged.text).toBe('')
    expect(result.conflict.recoveredLocalNewer).toBe(true)
  })
})
