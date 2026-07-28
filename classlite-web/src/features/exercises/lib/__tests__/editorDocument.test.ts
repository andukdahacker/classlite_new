// Story 4.2 — pure document-edit + factory units (no render). The immutable
// section ops, the array-move reorder primitive, and the Matching heading-bank
// replication.
import { describe, expect, test } from 'vitest'
import {
  addSection,
  deleteSection,
  moveItem,
  moveSection,
  replaceSection,
  updateSettings,
} from '../editorDocument'
import { isPromptOnlySection, newSection } from '../sectionTypes'
import { matchingBank, newQuestion, newQuestionGroup, withMatchingBank } from '../questionTypes'
import type { EditorDocument } from '../editorTypes'

function baseDoc(): EditorDocument {
  return {
    title: 'T',
    description: null,
    skill: 'reading',
    tags: [],
    targetBand: null,
    content: { sections: [], settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false } },
  }
}

describe('moveItem', () => {
  test('moves an item and returns a new array', () => {
    const src = ['a', 'b', 'c']
    const out = moveItem(src, 0, 2)
    expect(out).toEqual(['b', 'c', 'a'])
    expect(out).not.toBe(src)
  })
  test('out-of-range or no-op returns the SAME reference (no dirty)', () => {
    const src = ['a', 'b']
    expect(moveItem(src, 0, 0)).toBe(src)
    expect(moveItem(src, 0, 5)).toBe(src)
    expect(moveItem(src, -1, 1)).toBe(src)
  })
})

describe('section ops', () => {
  test('addSection appends an empty section of the type', () => {
    const doc = addSection(baseDoc(), 'writing')
    expect(doc.content.sections).toHaveLength(1)
    expect(doc.content.sections[0].type).toBe('writing')
  })
  test('replaceSection swaps only the target index', () => {
    let doc = addSection(addSection(baseDoc(), 'reading'), 'grammar')
    doc = replaceSection(doc, 1, { ...doc.content.sections[1], title: 'Renamed' })
    expect(doc.content.sections[1].title).toBe('Renamed')
    expect(doc.content.sections[0].title).toBe('')
  })
  test('deleteSection removes the target index', () => {
    let doc = addSection(addSection(baseDoc(), 'reading'), 'grammar')
    doc = deleteSection(doc, 0)
    expect(doc.content.sections).toHaveLength(1)
    expect(doc.content.sections[0].type).toBe('grammar')
  })
  test('moveSection reorders by array index', () => {
    let doc = addSection(addSection(baseDoc(), 'reading'), 'grammar')
    doc = moveSection(doc, 0, 1)
    expect(doc.content.sections.map((s) => s.type)).toEqual(['grammar', 'reading'])
  })
  test('updateSettings merges a partial patch', () => {
    const doc = updateSettings(baseDoc(), { timeLimitEnabled: true, timeLimitMinutes: 30 })
    expect(doc.content.settings).toEqual({ timeLimitEnabled: true, timeLimitMinutes: 30, caseSensitive: false })
  })
})

describe('section type helpers', () => {
  test('writing/speaking are prompt-only; others host groups', () => {
    expect(isPromptOnlySection('writing')).toBe(true)
    expect(isPromptOnlySection('speaking')).toBe(true)
    expect(isPromptOnlySection('reading')).toBe(false)
    expect(newSection('reading').questionGroups).toEqual([])
  })
})

describe('question factories', () => {
  test('MCQ seeds two blank options; T/F/NG defaults to true', () => {
    expect(newQuestion('multiple_choice').options).toHaveLength(2)
    expect(newQuestion('true_false_not_given').correctAnswer).toBe('true')
  })
  test('a new group is never empty (≥1 question)', () => {
    expect(newQuestionGroup('short_answer').questions).toHaveLength(1)
  })
})

describe('matching heading bank', () => {
  test('withMatchingBank replicates the bank into every item and drops stale keys', () => {
    const group = {
      type: 'matching' as const,
      instructions: '',
      questions: [
        { text: 'A', type: 'matching', options: ['i', 'ii'], correctAnswer: 'ii', acceptedVariants: [] },
        { text: 'B', type: 'matching', options: ['i', 'ii'], correctAnswer: 'i', acceptedVariants: [] },
      ],
    }
    const next = withMatchingBank(group, ['i']) // 'ii' removed
    expect(matchingBank(next)).toEqual(['i'])
    expect(next.questions[0].correctAnswer).toBe('') // stale 'ii' dropped
    expect(next.questions[1].correctAnswer).toBe('i') // still valid
    expect(next.questions.every((q) => q.options.length === 1)).toBe(true)
  })
})
