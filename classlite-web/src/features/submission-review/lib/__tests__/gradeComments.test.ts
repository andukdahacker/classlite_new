// Story 5.5b Task 3 — gradeComments pure-reader unit tests. Uses the SHARED
// WRITING_ANCHOR_FIXTURE so the anchored/whole-essay split + tone map are pinned
// against the same multibyte hazards the render-side spec asserts (Murat).
import { describe, expect, test } from 'vitest'
import {
  WRITING_ANCHOR_COMMENTS,
  WRITING_ANCHOR_ESSAY,
  WRITING_ANCHOR_EXPECTED_SLICES,
} from '@/lib/test/writingAnchorFixture'
import { utf16Slice } from '@/lib/essayAnchors'
import {
  anchoredComments,
  criterionInsight,
  pinnedByCriterion,
  prepareComments,
  toCardType,
  toEssayAnchors,
  wholeEssayComments,
} from '../gradeComments'

describe('toCardType — exhaustive wire→card map', () => {
  test('maps the wire enum to the CommentCard taxonomy (suggestion→suggest)', () => {
    expect(toCardType('error')).toBe('error')
    expect(toCardType('praise')).toBe('praise')
    expect(toCardType('suggestion')).toBe('suggest')
  })
})

describe('prepareComments — anchored vs whole-essay split (AC6/AC7a)', () => {
  const prepared = prepareComments(WRITING_ANCHOR_COMMENTS, WRITING_ANCHOR_ESSAY)

  test('every input comment is prepared with a stable index (no drop, count parity)', () => {
    expect(prepared).toHaveLength(WRITING_ANCHOR_COMMENTS.length)
    expect(prepared.map((c) => c.index)).toEqual([0, 1, 2, 3])
  })

  test('surrogate-safe anchors survive; a pair-splitting anchor demotes to whole-essay', () => {
    // [0] "😀" and [1] "é" paint; [2] splits the surrogate pair → demoted; [3] null/null.
    const anchored = anchoredComments(prepared)
    expect(anchored.map((c) => c.index)).toEqual([0, 1])
    const whole = wholeEssayComments(prepared)
    expect(whole.map((c) => c.index)).toEqual([2, 3])
  })

  test('the normalized anchors slice back to the exact expected graphemes', () => {
    const anchored = anchoredComments(prepared)
    const slices = anchored.map((c) =>
      c.anchor ? utf16Slice(WRITING_ANCHOR_ESSAY, c.anchor.start, c.anchor.end) : null,
    )
    // Compare against the fixture's own expected slices (single source of truth —
    // avoids a precomposed-vs-decomposed literal mismatch on the combining grapheme).
    expect(slices).toEqual(WRITING_ANCHOR_EXPECTED_SLICES.filter((s) => s !== null))
  })

  test('toEssayAnchors emits one anchor per painted comment, keyed by stable index', () => {
    const anchors = toEssayAnchors(prepared)
    expect(anchors.map((a) => a.index)).toEqual([0, 1])
    expect(anchors.map((a) => a.type)).toEqual(['error', 'praise'])
  })
})

describe('pinnedByCriterion — per-criterion tally + error flag (AC4)', () => {
  test('counts ALL comments per criterion and flags criteria with an error pin', () => {
    const prepared = prepareComments(WRITING_ANCHOR_COMMENTS, WRITING_ANCHOR_ESSAY)
    const tally = pinnedByCriterion(prepared)
    expect(tally.lexicalResource).toEqual({ count: 1, hasError: true })
    expect(tally.taskResponse).toEqual({ count: 1, hasError: false })
    expect(tally.coherenceCohesion).toEqual({ count: 1, hasError: false })
    expect(tally.grammaticalRange).toEqual({ count: 1, hasError: true })
  })
})

describe('criterionInsight — strength-first + graceful uniform degrade (AC4)', () => {
  test('names the relative strongest and weakest criterion', () => {
    const insight = criterionInsight({
      taskResponse: 7,
      coherenceCohesion: 6,
      lexicalResource: 5,
      grammaticalRange: 6.5,
    })
    expect(insight.strongest).toBe('taskResponse')
    expect(insight.weakest).toBe('lexicalResource')
    expect(insight.uniform).toBe(false)
  })

  test('a straight-8.0 essay is uniform — no manufactured weakness', () => {
    const insight = criterionInsight({
      taskResponse: 8,
      coherenceCohesion: 8,
      lexicalResource: 8,
      grammaticalRange: 8,
    })
    expect(insight.uniform).toBe(true)
    expect(insight.strongest).toBe(insight.weakest)
  })
})
