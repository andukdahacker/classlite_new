/**
 * essayAnchorParity — Story 5.5b review patch (P1 / WF-8 cross-side guarantee).
 *
 * The teacher grading page and the student result reader both paint anchored comments
 * with `buildEssayHtml`, but prepare their anchors through different call sites. This
 * grading/* spec feeds the ONE shared `WRITING_ANCHOR_FIXTURE` through the TEACHER path
 * (`resolveStoredAnchors` — the shared single source WritingGradingPage now uses) and
 * asserts the SAME painted slices, tones, and demotions the student `submission-review`
 * spec asserts against the SAME fixture constants. Both specs are pinned to one source
 * of truth, so the two renderers cannot silently drift green on the identical multibyte
 * offsets (surrogate pair / combining mark / CRLF). This is the `grading/*` half of the
 * WF-8 mandate — before this, the fixture was consumed on the student side only.
 */
import { describe, expect, test } from 'vitest'
import { buildEssayHtml, resolveStoredAnchors } from '@/lib/essayAnchors'
import {
  WRITING_ANCHOR_COMMENTS,
  WRITING_ANCHOR_ESSAY,
  WRITING_ANCHOR_EXPECTED_SLICES,
  WRITING_ANCHOR_PAINTED_COUNT,
} from '@/lib/test/writingAnchorFixture'

/** Render the teacher's `buildEssayHtml` output into a container for structural queries. */
function paintTeacherEssay(): HTMLDivElement {
  const spans = resolveStoredAnchors(WRITING_ANCHOR_COMMENTS, WRITING_ANCHOR_ESSAY)
  const div = document.createElement('div')
  div.innerHTML = buildEssayHtml(WRITING_ANCHOR_ESSAY, spans)
  return div
}

describe('essayAnchor cross-side parity — teacher path vs the shared fixture (WF-8/P1)', () => {
  test('paints exactly the surviving anchors — surrogate-split + whole-essay demote (same as the student)', () => {
    const div = paintTeacherEssay()
    expect(div.querySelectorAll('mark[data-anchor-index]')).toHaveLength(WRITING_ANCHOR_PAINTED_COUNT)
    // [2] splits the surrogate pair → demoted; [3] is whole-essay (null/null) → never inline.
    expect(div.querySelector('mark[data-anchor-index="2"]')).toBeNull()
    expect(div.querySelector('mark[data-anchor-index="3"]')).toBeNull()
  })

  test('each surviving mark slices to the exact expected grapheme (UTF-16-safe both sides)', () => {
    const div = paintTeacherEssay()
    expect(div.querySelector('mark[data-anchor-index="0"]')?.textContent).toBe(
      WRITING_ANCHOR_EXPECTED_SLICES[0],
    )
    expect(div.querySelector('mark[data-anchor-index="1"]')?.textContent).toBe(
      WRITING_ANCHOR_EXPECTED_SLICES[1],
    )
  })

  test('tone class per anchor matches the wire type (no independent tone re-derivation)', () => {
    const div = paintTeacherEssay()
    // comment[0].type === 'error', comment[1].type === 'praise'.
    expect(div.querySelector('mark[data-anchor-index="0"]')?.className).toContain('cl-anchor-error')
    expect(div.querySelector('mark[data-anchor-index="1"]')?.className).toContain('cl-anchor-praise')
  })
})
