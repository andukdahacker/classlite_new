// Story 4.3b T3 (AC3) — pure fragment-merge unit tests. No DOM, no MSW: these
// assert the immutable content merges the dialog's Accept relies on.
import { describe, expect, test } from 'vitest'
import type { EditorDocument, ExerciseContent } from '../editorTypes'
import { mergeGeneratedFragment } from '../fragmentMerge'

function baseDoc(content: ExerciseContent): EditorDocument {
  return {
    title: 'Doc',
    description: null,
    skill: 'reading',
    tags: [],
    targetBand: null,
    content,
  }
}

function emptyContent(): ExerciseContent {
  return { sections: [], settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false } }
}

describe('mergeGeneratedFragment — section mode', () => {
  test('appends the generated section(s) after existing sections', () => {
    const doc = baseDoc({
      ...emptyContent(),
      sections: [{ type: 'grammar', title: 'Existing', content: 'x', questionGroups: [] }],
    })
    const fragment: ExerciseContent = {
      ...emptyContent(),
      sections: [{ type: 'reading', title: 'Generated', content: 'Passage…', questionGroups: [] }],
    }
    const next = mergeGeneratedFragment(doc, { kind: 'section' }, fragment)
    expect(next.content.sections).toHaveLength(2)
    expect(next.content.sections[1].title).toBe('Generated')
    // immutability — the original doc is untouched.
    expect(doc.content.sections).toHaveLength(1)
  })
})

describe('mergeGeneratedFragment — questions mode', () => {
  test('appends the carrier section groups to the TARGET section only', () => {
    const doc = baseDoc({
      ...emptyContent(),
      sections: [
        { type: 'reading', title: 'S0', content: 'p', questionGroups: [] },
        { type: 'reading', title: 'S1', content: 'p', questionGroups: [] },
      ],
    })
    const fragment: ExerciseContent = {
      ...emptyContent(),
      sections: [
        {
          type: 'reading',
          title: 'carrier',
          content: '',
          questionGroups: [
            { type: 'multiple_choice', instructions: 'i', questions: [] },
            { type: 'short_answer', instructions: 'i', questions: [] },
          ],
        },
      ],
    }
    const next = mergeGeneratedFragment(doc, { kind: 'questions', sectionIndex: 1 }, fragment)
    expect(next.content.sections[0].questionGroups).toHaveLength(0) // untouched
    expect(next.content.sections[1].questionGroups).toHaveLength(2) // appended here
  })

  test('is a no-op when the target section index is gone', () => {
    const doc = baseDoc(emptyContent())
    const fragment: ExerciseContent = {
      ...emptyContent(),
      sections: [{ type: 'reading', title: 'c', content: '', questionGroups: [{ type: 'multiple_choice', instructions: '', questions: [] }] }],
    }
    const next = mergeGeneratedFragment(doc, { kind: 'questions', sectionIndex: 5 }, fragment)
    expect(next).toBe(doc)
  })
})

describe('mergeGeneratedFragment — distractors mode', () => {
  test('lifts the generated options + key onto the target question only', () => {
    const doc = baseDoc({
      ...emptyContent(),
      sections: [
        {
          type: 'reading',
          title: 'S0',
          content: 'p',
          questionGroups: [
            {
              type: 'multiple_choice',
              instructions: 'i',
              questions: [
                { text: 'Q0', type: 'multiple_choice', options: ['old'], correctAnswer: 'old', acceptedVariants: [] },
                { text: 'Q1', type: 'multiple_choice', options: [''], correctAnswer: '', acceptedVariants: [] },
              ],
            },
          ],
        },
      ],
    })
    const fragment: ExerciseContent = {
      ...emptyContent(),
      sections: [
        {
          type: 'reading',
          title: 'Generated distractors',
          content: '',
          questionGroups: [
            {
              type: 'multiple_choice',
              instructions: '',
              questions: [
                { text: '', type: 'multiple_choice', options: ['Paris', 'London', 'Rome'], correctAnswer: 'Paris', acceptedVariants: [] },
              ],
            },
          ],
        },
      ],
    }
    const next = mergeGeneratedFragment(
      doc,
      { kind: 'distractors', sectionIndex: 0, groupIndex: 0, questionIndex: 1 },
      fragment,
    )
    const questions = next.content.sections[0].questionGroups[0].questions
    expect(questions[0].options).toEqual(['old']) // untouched
    expect(questions[1].options).toEqual(['Paris', 'London', 'Rome']) // replaced
    expect(questions[1].correctAnswer).toBe('Paris')
    expect(questions[1].text).toBe('Q1') // stem preserved
  })
})

describe('mergeGeneratedFragment — distractors correctAnswer never orphaned', () => {
  const target = { kind: 'distractors', sectionIndex: 0, groupIndex: 0, questionIndex: 0 } as const

  function docWith(options: string[], correctAnswer: string): EditorDocument {
    return baseDoc({
      ...emptyContent(),
      sections: [
        {
          type: 'reading',
          title: 'S0',
          content: 'p',
          questionGroups: [
            {
              type: 'multiple_choice',
              instructions: 'i',
              questions: [
                { text: 'Q0', type: 'multiple_choice', options, correctAnswer, acceptedVariants: [] },
              ],
            },
          ],
        },
      ],
    })
  }

  function distractors(options: string[], correctAnswer: string): ExerciseContent {
    return {
      ...emptyContent(),
      sections: [
        {
          type: 'reading',
          title: 'g',
          content: '',
          questionGroups: [
            {
              type: 'multiple_choice',
              instructions: '',
              questions: [
                { text: '', type: 'multiple_choice', options, correctAnswer, acceptedVariants: [] },
              ],
            },
          ],
        },
      ],
    }
  }

  test('keeps the existing key when it survives in the new option set', () => {
    // generated key 'nope' is absent, but the old 'old' survives → keep 'old'.
    const next = mergeGeneratedFragment(docWith(['old'], 'old'), target, distractors(['A', 'old', 'B'], 'nope'))
    const q = next.content.sections[0].questionGroups[0].questions[0]
    expect(q.options).toEqual(['A', 'old', 'B'])
    expect(q.correctAnswer).toBe('old')
  })

  test('clamps to the first option when neither key exists in the new options', () => {
    const next = mergeGeneratedFragment(docWith(['old'], 'old'), target, distractors(['A', 'B', 'C'], 'Z'))
    const q = next.content.sections[0].questionGroups[0].questions[0]
    expect(q.correctAnswer).toBe('A')
    expect(q.options).toContain(q.correctAnswer) // never orphaned
  })
})

describe('mergeGeneratedFragment — empty fragments are no-ops', () => {
  test('section mode with no generated sections returns the same doc reference', () => {
    const doc = baseDoc({
      ...emptyContent(),
      sections: [{ type: 'grammar', title: 'Existing', content: 'x', questionGroups: [] }],
    })
    const next = mergeGeneratedFragment(doc, { kind: 'section' }, emptyContent())
    expect(next).toBe(doc)
  })
})
