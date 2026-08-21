import { afterEach, describe, expect, test } from 'vitest'

import {
  clearGradingDraft,
  emptyGradingDraft,
  readGradingDraft,
  writeGradingDraft,
  type GradingDraft,
} from '../gradingDraft'

afterEach(() => {
  window.localStorage.clear()
})

const draft: GradingDraft = {
  scores: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 7, grammaticalRange: 6 },
  comments: [
    { id: 'c1', type: 'error', criterion: 'taskResponse', anchorStart: 0, anchorEnd: 4, text: 'fix this', source: 'teacher' },
    { id: 'c2', type: 'praise', criterion: 'coherenceCohesion', anchorStart: null, anchorEnd: null, text: 'nice', source: 'ai' },
  ],
  composer: null,
}

describe('gradingDraft — durable per-submission localStorage (D4)', () => {
  test('write → read round-trips (survives a simulated refresh)', () => {
    writeGradingDraft('sub-1', draft)
    // A fresh read (new page load) recovers the same draft.
    expect(readGradingDraft('sub-1')).toEqual(draft)
  })

  test('drafts are isolated per submission (lossless prev/next)', () => {
    writeGradingDraft('sub-1', draft)
    const other: GradingDraft = { scores: { taskResponse: 8 }, comments: [], composer: null }
    writeGradingDraft('sub-2', other)
    expect(readGradingDraft('sub-1')).toEqual(draft)
    expect(readGradingDraft('sub-2')).toEqual(other)
  })

  test('an open composer round-trips (a half-written comment survives refresh, AC15)', () => {
    const withComposer: GradingDraft = {
      ...draft,
      composer: {
        anchorStart: 2,
        anchorEnd: 8,
        rectTop: 120,
        rectLeft: 40,
        type: 'suggestion',
        criterion: 'lexicalResource',
        text: 'half-written…',
      },
    }
    writeGradingDraft('sub-9', withComposer)
    expect(readGradingDraft('sub-9')).toEqual(withComposer)
  })

  test('clear drops the draft (post-release)', () => {
    writeGradingDraft('sub-1', draft)
    clearGradingDraft('sub-1')
    expect(readGradingDraft('sub-1')).toBeNull()
  })

  test('missing draft reads null; corrupt blob degrades to null (never throws)', () => {
    expect(readGradingDraft('never-written')).toBeNull()
    window.localStorage.setItem('classlite:grading-draft:bad', '{not json')
    expect(readGradingDraft('bad')).toBeNull()
  })

  test('emptyGradingDraft is a blank slate', () => {
    expect(emptyGradingDraft()).toEqual({ scores: {}, comments: [], composer: null })
  })
})
