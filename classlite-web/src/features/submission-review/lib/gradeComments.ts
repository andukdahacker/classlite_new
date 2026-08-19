/**
 * gradeComments — Story 5.5b Task 3. Pure readers over `StudentGradeView.comments`
 * (`AnchoredComment[]`) for the student graded block. All anchor geometry defers to
 * the SHARED `@/lib/essayAnchors` primitive (D-LIFT) — this module NEVER re-derives
 * tone colors, mark boundaries, or offset slicing (Winston: local re-derivation IS the
 * teacher/student drift vector). It only groups, counts, and maps the wire enum.
 */
import type { components } from '@/lib/api/client'
import { normalizeAnchor, type EssayAnchor } from '@/lib/essayAnchors'

type AnchoredComment = components['schemas']['AnchoredComment']
type CriterionScores = components['schemas']['CriterionScores']

/** The four IELTS criterion keys, in canonical (spec) order. */
export type CriterionKey = keyof CriterionScores
export const CRITERION_KEYS: readonly CriterionKey[] = [
  'taskResponse',
  'coherenceCohesion',
  'lexicalResource',
  'grammaticalRange',
]

/** The wire comment enum (`suggestion`) vs the CommentCard taxonomy (`suggest`). */
export type WireCommentType = AnchoredComment['type']
export type CardCommentType = 'error' | 'praise' | 'suggest'

/**
 * Map a wire comment type to the CommentCard taxonomy. EXHAUSTIVE: a future 4th wire
 * enum makes `type` in the default arm a non-`never`, failing `tsc` here rather than
 * silently dropping a comment (Winston).
 */
export function toCardType(type: WireCommentType): CardCommentType {
  switch (type) {
    case 'error':
      return 'error'
    case 'praise':
      return 'praise'
    case 'suggestion':
      return 'suggest'
    default: {
      const exhaustive: never = type
      return exhaustive
    }
  }
}

/** A grade comment prepared for rendering (stable index + resolved anchor/tone). */
export interface PreparedComment {
  /** Stable index into `grade.comments` — the pin↔card wiring key (`data-anchor-index`). */
  index: number
  wireType: WireCommentType
  cardType: CardCommentType
  criterion: CriterionKey
  /** i18n key for the criterion label (reuses the existing `criterion.*` keys). */
  criterionKey: string
  text: string
  /**
   * The NORMALIZED inline anchor, or `null` when this is a whole-essay comment. A
   * comment demotes to `null` when its offsets are null OR fail `normalizeAnchor`
   * (out-of-range / surrogate-splitting) — the SAME demotion `buildEssayHtml` applies,
   * so a demoted comment surfaces in "General notes" and is never dropped (AC7a).
   */
  anchor: { start: number; end: number } | null
}

/**
 * Prepare grade comments for rendering against `essayText`: assign a stable index,
 * map the tone, and resolve each anchor through the shared `normalizeAnchor`.
 * @param comments the released grade's anchored comments.
 * @param essayText the SAME `readWritingText(submission)` the read-back renders.
 * @returns one `PreparedComment` per input, in order.
 */
export function prepareComments(
  comments: AnchoredComment[],
  essayText: string,
): PreparedComment[] {
  return comments.map((comment, index) => {
    const anchor =
      comment.anchorStart !== null && comment.anchorEnd !== null
        ? normalizeAnchor(essayText, comment.anchorStart, comment.anchorEnd)
        : null
    return {
      index,
      wireType: comment.type,
      cardType: toCardType(comment.type),
      criterion: comment.criterion,
      criterionKey: `criterion.${comment.criterion}`,
      text: comment.text,
      anchor,
    }
  })
}

/** The comments that paint an inline highlight (anchor survived normalization). */
export function anchoredComments(prepared: PreparedComment[]): PreparedComment[] {
  return prepared.filter((comment) => comment.anchor !== null)
}

/** The whole-essay comments (null/null OR demoted) — the "General notes" group. */
export function wholeEssayComments(prepared: PreparedComment[]): PreparedComment[] {
  return prepared.filter((comment) => comment.anchor === null)
}

/**
 * The `EssayAnchor[]` to feed `buildEssayHtml`, one per anchored comment, keyed by the
 * stable `index` so a painted `<mark>`'s `data-anchor-index` addresses its card.
 */
export function toEssayAnchors(prepared: PreparedComment[]): EssayAnchor[] {
  const anchors: EssayAnchor[] = []
  for (const comment of prepared) {
    if (comment.anchor === null) continue
    anchors.push({
      start: comment.anchor.start,
      end: comment.anchor.end,
      type: comment.wireType,
      index: comment.index,
    })
  }
  return anchors
}

/** Per-criterion pinned-comment tally (count + whether any pin is an error). */
export interface CriterionPins {
  count: number
  hasError: boolean
}

/**
 * Group ALL comments by criterion into a pinned tally. A criterion whose pins include
 * an `error` is flagged (`hasError`) so the bar can carry the ONLY sanctioned red
 * border (§6.4) — a low band is never red.
 */
export function pinnedByCriterion(
  prepared: PreparedComment[],
): Record<CriterionKey, CriterionPins> {
  const tally: Record<CriterionKey, CriterionPins> = {
    taskResponse: { count: 0, hasError: false },
    coherenceCohesion: { count: 0, hasError: false },
    lexicalResource: { count: 0, hasError: false },
    grammaticalRange: { count: 0, hasError: false },
  }
  for (const comment of prepared) {
    // Defensive skip — a criterion outside the 4 keys (server drift) must not crash
    // the whole released-grade render (mirrors the exhaustive guard in `toCardType`).
    const entry = tally[comment.criterion]
    if (!entry) continue
    entry.count += 1
    if (comment.wireType === 'error') entry.hasError = true
  }
  return tally
}

/** The relative strongest + weakest criterion (strength-first framing, AC4). */
export interface CriterionInsight {
  strongest: CriterionKey
  weakest: CriterionKey
  /** True when every criterion is tied — degrade the focus area, never manufacture one. */
  uniform: boolean
}

/**
 * Derive the relative strongest + weakest criterion from the server-authoritative
 * scores. When all four are tied (`uniform`), `strongest === weakest` and the caller
 * degrades the focus area to a neutral "keep it up" rather than flag a non-flaw (AC4).
 */
export function criterionInsight(scores: CriterionScores): CriterionInsight {
  let strongest: CriterionKey = CRITERION_KEYS[0]
  let weakest: CriterionKey = CRITERION_KEYS[0]
  for (const key of CRITERION_KEYS) {
    if (scores[key] > scores[strongest]) strongest = key
    if (scores[key] < scores[weakest]) weakest = key
  }
  const values = CRITERION_KEYS.map((key) => scores[key])
  const uniform = Math.max(...values) === Math.min(...values)
  return { strongest, weakest, uniform }
}
