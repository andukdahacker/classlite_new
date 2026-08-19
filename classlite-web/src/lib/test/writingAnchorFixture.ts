/**
 * WRITING_ANCHOR_FIXTURE — Story 5.5b (Murat). ONE shared cross-side essay + anchored
 * comment fixture imported by BOTH the teacher `grading/*` specs AND the student
 * `submission-review` spec, so the two renderers of `buildEssayHtml` cannot silently
 * drift green. The essay contains, in document order, a surrogate-pair emoji, a
 * combining-mark grapheme, and a CRLF — the exact UTF-16 hazards the offset contract
 * (D3) must survive. Offsets below are UTF-16 code-unit offsets into `WRITING_ANCHOR_ESSAY`.
 *
 *   index: 0 1 2 | 3 4 | 5 | 6 7 | 8 | 9  10 | 11 12 13
 *   char : A B _   😀    _   e ́    _   \r  \n   e  n  d
 *                 (D83D DE00)  (e + U+0301)
 */
import type { components } from '@/lib/api/client'

type AnchoredComment = components['schemas']['AnchoredComment']

const EMOJI = '\u{1F600}' // 😀 — one surrogate pair (UTF-16 units [3,4])
const COMBINING = 'é' // é — base e + combining acute (UTF-16 units [6,7])

/** Length-14 essay with a surrogate pair, a combining grapheme, and a CRLF. */
export const WRITING_ANCHOR_ESSAY = `AB ${EMOJI} ${COMBINING} \r\nend`

/**
 * Four comments exercising every anchor outcome:
 *  [0] in-range anchor ending on the post-surrogate boundary → paints "😀".
 *  [1] anchor over the combining grapheme → paints "é" (e + U+0301).
 *  [2] anchor SPLITTING the surrogate pair (end mid-emoji) → demotes to whole-essay.
 *  [3] whole-essay (null/null) → "General notes", never painted inline.
 */
export const WRITING_ANCHOR_COMMENTS: AnchoredComment[] = [
  { type: 'error', criterion: 'lexicalResource', anchorStart: 3, anchorEnd: 5, text: 'Nice emoji use.' },
  { type: 'praise', criterion: 'taskResponse', anchorStart: 6, anchorEnd: 8, text: 'Good accent mark.' },
  { type: 'suggestion', criterion: 'coherenceCohesion', anchorStart: 3, anchorEnd: 4, text: 'Splits the pair.' },
  { type: 'error', criterion: 'grammaticalRange', anchorStart: null, anchorEnd: null, text: 'Overall grammar note.' },
]

/**
 * Expected painted slice per comment index, or `null` when the comment demotes to a
 * whole-essay note (not painted inline). Aligned to `WRITING_ANCHOR_COMMENTS` by index.
 */
export const WRITING_ANCHOR_EXPECTED_SLICES: (string | null)[] = [
  EMOJI, // [0] → "😀"
  COMBINING, // [1] → "é"
  null, // [2] demoted (surrogate split)
  null, // [3] whole-essay
]

/** The two comments that survive to paint inline `<mark>`s (indices 0 and 1). */
export const WRITING_ANCHOR_PAINTED_COUNT = 2
