/**
 * Story 6.3a (AC6/AC7 · D8) — RED PHASE. The DISCRIMINATED speaking draft variant.
 * D8: DraftComment.criterion is typed `keyof CriterionScores` (writing keys) and a
 * speaking criterion isn't assignable; adding timestampMs alone doesn't fix it — so
 * the speaking draft is its OWN discriminated variant (speaking criterion union +
 * timestampMs instead of anchorStart/anchorEnd), persisted per-submission in
 * localStorage, surviving refresh AND queue navigation (mirrors gradingDraft.ts).
 *
 * FAILS at import today: `@/features/grading/lib/speakingGradingDraft` does not exist.
 *
 * SEAM (dev, green phase):
 *   - type SpeakingDraftCommentType = 'error' | 'praise' | 'suggestion'
 *   - type SpeakingCriterionKey = 'fluencyCoherence'|'lexicalResource'|'grammaticalRange'|'pronunciation'
 *   - interface SpeakingDraftComment {
 *       id: string; type: SpeakingDraftCommentType; criterion: SpeakingCriterionKey;
 *       timestampMs: number | null;   // null ⇒ general (unpinned)
 *       text: string; source: 'teacher' | 'ai';   // client-only; buildSpeakingGradeInput strips id+source
 *     }
 *   - interface SpeakingGradingDraft { scores: Partial<SpeakingCriterionScores>; comments: SpeakingDraftComment[]; composer: ... | null }
 *   - readSpeakingGradingDraft(id) / writeSpeakingGradingDraft(id, draft) / clearSpeakingGradingDraft(id)
 *     under a DISTINCT localStorage prefix from the writing draft (no cross-skill clobber).
 */
import { afterEach, describe, expect, test } from 'vitest'

import {
  clearSpeakingGradingDraft,
  emptySpeakingGradingDraft,
  readSpeakingGradingDraft,
  writeSpeakingGradingDraft,
  type SpeakingGradingDraft,
} from '@/features/grading/lib/speakingGradingDraft'

const SUB = 'sub-speaking-1'

afterEach(() => {
  window.localStorage.clear()
})

describe('speakingGradingDraft — discriminated speaking variant (AC6/AC7/D8)', () => {
  test('round-trips a draft with a PINNED and a GENERAL (null timestamp) comment', () => {
    const draft: SpeakingGradingDraft = {
      scores: { fluencyCoherence: 6.5, pronunciation: 6 },
      comments: [
        { id: 'c1', type: 'error', criterion: 'pronunciation', timestampMs: 12_000, text: 'th→f', source: 'teacher' },
        { id: 'c2', type: 'praise', criterion: 'fluencyCoherence', timestampMs: null, text: 'fluent overall', source: 'teacher' },
      ],
      composer: null,
    }
    writeSpeakingGradingDraft(SUB, draft)
    const back = readSpeakingGradingDraft(SUB)
    expect(back).toEqual(draft)
    // The general comment keeps its null timestamp (not coerced to 0).
    expect(back?.comments[1].timestampMs).toBeNull()
  })

  test('a fresh draft is empty; clear removes it', () => {
    expect(readSpeakingGradingDraft('absent')).toBeNull()
    expect(emptySpeakingGradingDraft()).toEqual({ scores: {}, comments: [], composer: null })
    writeSpeakingGradingDraft(SUB, emptySpeakingGradingDraft())
    clearSpeakingGradingDraft(SUB)
    expect(readSpeakingGradingDraft(SUB)).toBeNull()
  })

  test('does NOT collide with the writing draft key for the same submission id', () => {
    // Writing draft uses `classlite:grading-draft:` — the speaking draft must use a
    // distinct prefix so a mixed-skill queue never clobbers across skills.
    window.localStorage.setItem(
      'classlite:grading-draft:' + SUB,
      JSON.stringify({ scores: { taskResponse: 7 }, comments: [], composer: null }),
    )
    writeSpeakingGradingDraft(SUB, emptySpeakingGradingDraft())
    const writingRaw = window.localStorage.getItem('classlite:grading-draft:' + SUB)
    expect(writingRaw).toContain('taskResponse')
  })
})
