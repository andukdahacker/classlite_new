// Story 5.2b Task 1 (AC10) — the answer-content model, RED-first.
// Pure functions only: Handle addressing, the answered predicate (per Murat-e
// oracle), the count derivations over the flattened question set, and the
// content normalizer/transforms the draft slice + localStorage mirror lean on.
import { describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import {
  ATTEMPT_CONTENT_SCHEMA_VERSION,
  answeredCount,
  buildHandle,
  emptyAttemptContent,
  flaggedCount,
  flattenQuestions,
  isAnswered,
  normalizeAttemptContent,
  parseHandle,
  unansweredCount,
  withAnswer,
  withFlagToggled,
  type AttemptContent,
} from '../attemptContent'

type AttemptExercise = components['schemas']['AttemptExercise']
type AttemptSection = components['schemas']['AttemptSection']
type AttemptQuestionGroup = components['schemas']['AttemptQuestionGroup']
type AttemptQuestion = components['schemas']['AttemptQuestion']

function q(text: string, type = 'multiple_choice', options: string[] = []): AttemptQuestion {
  return { text, type, options }
}
function group(
  type: AttemptQuestionGroup['type'],
  questions: AttemptQuestion[],
): AttemptQuestionGroup {
  return { type, instructions: '', questions }
}
function section(
  type: AttemptSection['type'],
  questionGroups: AttemptQuestionGroup[],
  content = 'Passage',
): AttemptSection {
  return { type, title: 'S', content, questionGroups }
}
function exercise(sections: AttemptSection[], skill: AttemptExercise['skill'] = 'reading'): AttemptExercise {
  return {
    id: 'ex-1',
    title: 'Quiz',
    skill,
    sections,
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
  }
}

// A representative exercise: 1 section, two groups.
//  group 0 (MCQ): q0, q1
//  group 1 (matching): q0, q1, q2
// → 5 questions, handles 0:0:0, 0:0:1, 0:1:0, 0:1:1, 0:1:2
function sampleExercise(): AttemptExercise {
  return exercise([
    section('reading', [
      group('multiple_choice', [q('a', 'multiple_choice', ['x', 'y']), q('b', 'multiple_choice', ['x', 'y'])]),
      group('matching', [q('m0'), q('m1'), q('m2')]),
    ]),
  ])
}

describe('Handle addressing', () => {
  test('buildHandle joins the three indices', () => {
    expect(buildHandle(0, 1, 2)).toBe('0:1:2')
    expect(buildHandle(3, 0, 11)).toBe('3:0:11')
  })

  test('parseHandle round-trips a valid handle', () => {
    expect(parseHandle('0:1:2')).toEqual({ sectionIndex: 0, groupIndex: 1, questionIndex: 2 })
  })

  test('parseHandle rejects malformed handles', () => {
    expect(parseHandle('nope')).toBeNull()
    expect(parseHandle('0:1')).toBeNull()
    expect(parseHandle('0:1:x')).toBeNull()
    expect(parseHandle('0:-1:2')).toBeNull()
  })
})

describe('isAnswered — the answered predicate (Murat-e oracle)', () => {
  test('present, non-empty, non-whitespace → answered', () => {
    expect(isAnswered('true')).toBe(true)
    expect(isAnswered('a')).toBe(true)
    expect(isAnswered('0')).toBe(true)
  })

  test('absent / empty / whitespace-only → NOT answered', () => {
    expect(isAnswered(undefined)).toBe(false)
    expect(isAnswered('')).toBe(false)
    expect(isAnswered('   ')).toBe(false)
    expect(isAnswered('\t\n')).toBe(false)
  })
})

describe('flattenQuestions', () => {
  test('yields one entry per question with stable handles in document order', () => {
    const flat = flattenQuestions(sampleExercise())
    expect(flat.map((f) => f.handle)).toEqual(['0:0:0', '0:0:1', '0:1:0', '0:1:1', '0:1:2'])
    expect(flat[2]).toMatchObject({ sectionIndex: 0, groupIndex: 1, questionIndex: 0 })
    expect(flat[2].question.text).toBe('m0')
  })
})

describe('count derivations (AC10)', () => {
  test('answeredCount counts per-question, whitespace does not count', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: {
        '0:0:0': 'x', // answered
        '0:0:1': '  ', // whitespace → not answered
        '0:1:0': 'Heading A', // answered
        // 0:1:1 absent → not answered
        '0:1:2': '', // empty → not answered
      },
      flagged: [],
    }
    const ex = sampleExercise()
    expect(answeredCount(content, ex)).toBe(2)
    expect(unansweredCount(content, ex)).toBe(3) // 5 total - 2
  })

  test('a stray answer for a non-existent handle does not inflate the count', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:0': 'x', '9:9:9': 'ghost' },
      flagged: [],
    }
    expect(answeredCount(content, sampleExercise())).toBe(1)
  })

  test('flaggedCount counts flagged questions; flagged-and-answered counts in both', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: { '0:0:0': 'x' },
      flagged: ['0:0:0', '0:1:2'], // one is also answered
    }
    const ex = sampleExercise()
    expect(flaggedCount(content, ex)).toBe(2)
    expect(answeredCount(content, ex)).toBe(1)
  })

  test('a flag on a non-existent handle is ignored', () => {
    const content: AttemptContent = {
      schemaVersion: 1,
      answers: {},
      flagged: ['0:0:0', '7:7:7'],
    }
    expect(flaggedCount(content, sampleExercise())).toBe(1)
  })
})

describe('emptyAttemptContent + transforms', () => {
  test('emptyAttemptContent is the versioned empty shape', () => {
    expect(emptyAttemptContent()).toEqual({
      schemaVersion: ATTEMPT_CONTENT_SCHEMA_VERSION,
      answers: {},
      flagged: [],
    })
  })

  test('withAnswer is immutable and full-replaces the one handle', () => {
    const a = emptyAttemptContent()
    const b = withAnswer(a, '0:0:0', 'x')
    expect(a.answers).toEqual({}) // original untouched
    expect(b.answers).toEqual({ '0:0:0': 'x' })
    const c = withAnswer(b, '0:0:0', 'y')
    expect(c.answers['0:0:0']).toBe('y')
  })

  test('withFlagToggled adds then removes a handle immutably', () => {
    const a = emptyAttemptContent()
    const b = withFlagToggled(a, '0:1:2')
    expect(b.flagged).toEqual(['0:1:2'])
    expect(a.flagged).toEqual([]) // original untouched
    const c = withFlagToggled(b, '0:1:2')
    expect(c.flagged).toEqual([])
  })
})

describe('normalizeAttemptContent — server/localStorage guard', () => {
  test('coerces a well-formed bag through unchanged', () => {
    const raw = { schemaVersion: 1, answers: { '0:0:0': 'x' }, flagged: ['0:0:0'] }
    expect(normalizeAttemptContent(raw)).toEqual(raw)
  })

  test('null / undefined / non-object → empty content', () => {
    expect(normalizeAttemptContent(null)).toEqual(emptyAttemptContent())
    expect(normalizeAttemptContent(undefined)).toEqual(emptyAttemptContent())
    expect(normalizeAttemptContent(42)).toEqual(emptyAttemptContent())
  })

  test('drops non-string answer values and non-string flags', () => {
    const raw = {
      schemaVersion: 1,
      answers: { good: 'x', bad: 5, alsoBad: null },
      flagged: ['ok', 3, null],
    }
    const out = normalizeAttemptContent(raw)
    expect(out.answers).toEqual({ good: 'x' })
    expect(out.flagged).toEqual(['ok'])
  })

  test('missing answers/flagged default to empty containers', () => {
    expect(normalizeAttemptContent({ schemaVersion: 1 })).toEqual(emptyAttemptContent())
  })
})
