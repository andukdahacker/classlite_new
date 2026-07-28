// Story 4.2 code-review (P-FE3) — the Matching heading-bank helpers. A rename
// must carry an item's selected answer over (mirroring McqQuestionEditor); only
// a REMOVE drops the selection. Before the fix, renaming a heading routed
// through `withMatchingBank` and blanked every item's key on the first keystroke.
import { describe, expect, test } from 'vitest'
import { renameMatchingHeading, withMatchingBank } from '../questionTypes'
import type { QuestionGroup } from '../editorTypes'

function matchingGroup(): QuestionGroup {
  return {
    type: 'matching',
    instructions: '',
    questions: [
      { text: 'Para A', type: 'matching', options: ['Growth', 'Risk'], correctAnswer: 'Growth', acceptedVariants: [] },
      { text: 'Para B', type: 'matching', options: ['Growth', 'Risk'], correctAnswer: 'Risk', acceptedVariants: [] },
    ],
  }
}

describe('renameMatchingHeading', () => {
  test("carries an item's selected answer across a heading rename (no data loss)", () => {
    const next = renameMatchingHeading(matchingGroup(), 0, 'Growth strategy')
    // The bank is rewritten in EVERY item...
    expect(next.questions[0].options).toEqual(['Growth strategy', 'Risk'])
    expect(next.questions[1].options).toEqual(['Growth strategy', 'Risk'])
    // ...and the item that pointed at the OLD text now points at the new text.
    expect(next.questions[0].correctAnswer).toBe('Growth strategy')
    // An item pointing at an untouched heading is unaffected.
    expect(next.questions[1].correctAnswer).toBe('Risk')
  })

  test('a partial keystroke does not blank the key (the bug this fixes)', () => {
    // Typing "Growth" -> "Growt" (one backspace): the selection must FOLLOW,
    // never reset to '' the way withMatchingBank would mid-edit.
    const next = renameMatchingHeading(matchingGroup(), 0, 'Growt')
    expect(next.questions[0].correctAnswer).toBe('Growt')
  })

  test('withMatchingBank still drops a REMOVED heading’s selection', () => {
    const next = withMatchingBank(matchingGroup(), ['Risk'])
    expect(next.questions[0].correctAnswer).toBe('') // Growth removed → cleared
    expect(next.questions[1].correctAnswer).toBe('Risk')
  })
})
