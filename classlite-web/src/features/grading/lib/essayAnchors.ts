/**
 * essayAnchors — Story 6.1 (AC5/AC13/D3). Pure helpers for the highlight-and-pin
 * interaction over the PLAIN-TEXT essay (submission.content.text).
 *
 * Offsets are UTF-16 CODE-UNIT offsets into the essay text (D3). DOM text-node
 * offsets are already UTF-16 code units, so a selection endpoint's offset within a
 * text node IS a UTF-16 offset — captureSelectionOffsets walks the container's text
 * nodes to convert a selection into essay-text offsets, independent of the <mark>
 * structure the highlight builder injects.
 *
 * The highlight is rendered as inline <mark> spans in the essay HTML (the
 * WritingGradingSurface.essayHtml contract): inline elements wrap across lines
 * natively, so multi-line spans paint correctly with no absolute-positioned overlay
 * and no full-width gutter bleed. The essay text is HTML-ESCAPED before any <mark>
 * is inserted — student text is NEVER injected as HTML (XSS).
 */
import { asSafeHtml, type SafeHtml } from '@/lib/safe-html'

/** A span anchor to paint (both offsets non-null; whole-essay comments aren't painted). */
export interface EssayAnchor {
  start: number
  end: number
  /** Comment type — drives the mark tone class. */
  type: 'error' | 'praise' | 'suggestion'
  /** Stable index into the comment list (for pin↔card focus wiring). */
  index: number
}

/** UTF-16 code-unit length of s. */
export function utf16Len(s: string): number {
  return s.length
}

/** UTF-16 code-unit slice [start, end) of s. Non-negative bounds only (callers
 * clamp) so a negative index can never be reinterpreted as a from-end slice. */
export function utf16Slice(s: string, start: number, end: number): string {
  return s.slice(Math.max(0, start), Math.max(0, end))
}

/** Trailing whitespace/newline trim (the normalization reference for max offset). */
function trimTrailing(s: string): string {
  return s.replace(/\s+$/u, '')
}

/**
 * splitsSurrogatePair reports whether the boundary at UTF-16 offset p falls between
 * the high and low half of a surrogate pair (e.g. mid-emoji). Slicing on such a
 * boundary yields a lone surrogate (�), so the anchor is demoted — matches the
 * server-side `splitsSurrogatePair` guard in grading/validation.go (D3 parity).
 */
function splitsSurrogatePair(text: string, p: number): boolean {
  if (p <= 0 || p >= text.length) return false
  const prev = text.charCodeAt(p - 1)
  const next = text.charCodeAt(p)
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
}

/**
 * Normalize a captured span to the offset contract: integer, ordered, within the
 * trailing-trimmed essay length, and neither boundary splitting a surrogate pair.
 * Returns null (→ demote to whole-essay) when the span is degenerate, out of range,
 * or would split an astral character (D3 parity with the server).
 */
export function normalizeAnchor(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const max = utf16Len(trimTrailing(text))
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
  if (lo < 0 || lo >= hi || hi > max) return null
  if (splitsSurrogatePair(text, lo) || splitsSurrogatePair(text, hi)) return null
  return { start: lo, end: hi }
}

/**
 * The UTF-16 offset of (node, offset) measured from the start of root's text
 * content. Walks text nodes in document order. Returns null when node is outside root.
 */
function offsetWithin(root: Node, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += (current.textContent ?? '').length
    current = walker.nextNode()
  }
  // The endpoint may be an element node (e.g. a <mark>) — resolve via its text length.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    if (root.contains(el)) {
      let running = 0
      const w2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n = w2.nextNode()
      while (n) {
        if (el.contains(n)) {
          // offset counts child nodes before the endpoint; approximate to text start.
          return running
        }
        running += (n.textContent ?? '').length
        n = w2.nextNode()
      }
    }
  }
  return null
}

/**
 * Snapshot the current selection as UTF-16 essay offsets (Sally #1 — snapshot on
 * selection-end, never read live getSelection in the composer). Returns null when
 * there is no non-collapsed selection inside container.
 */
export function captureSelectionOffsets(
  container: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null
  }
  const start = offsetWithin(container, range.startContainer, range.startOffset)
  const end = offsetWithin(container, range.endContainer, range.endOffset)
  if (start === null || end === null) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  if (lo === hi) return null
  return { start: lo, end: hi }
}

/** Map a wire comment type to the mark tone class suffix (CommentCard taxonomy). */
export function anchorToneClass(type: EssayAnchor['type']): string {
  switch (type) {
    case 'error':
      return 'cl-anchor-error'
    case 'praise':
      return 'cl-anchor-praise'
    case 'suggestion':
      return 'cl-anchor-suggest'
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build the essay HTML: HTML-escape the plain text, then wrap the anchored spans in
 * <mark> at sorted offset boundaries. Overlapping anchors share a segment whose
 * classes are BLENDED (layered tones); the segment carries data-anchor-index of the
 * INNERMOST (shortest) anchor so a click focuses it (Sally #3/#4). Returns branded
 * SafeHtml (escaped-then-marked — never raw student HTML).
 */
export function buildEssayHtml(text: string, anchors: EssayAnchor[]): SafeHtml {
  const spans = anchors.filter((a) => a.start >= 0 && a.start < a.end && a.end <= utf16Len(text))
  if (spans.length === 0) return asSafeHtml(escapeHtml(text))

  const boundaries = new Set<number>([0, utf16Len(text)])
  for (const a of spans) {
    boundaries.add(a.start)
    boundaries.add(a.end)
  }
  const points = [...boundaries].sort((a, b) => a - b)

  let html = ''
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i]
    const segEnd = points[i + 1]
    if (segStart >= segEnd) continue
    const escaped = escapeHtml(utf16Slice(text, segStart, segEnd))
    const active = spans.filter((a) => a.start <= segStart && a.end >= segEnd)
    if (active.length === 0) {
      html += escaped
      continue
    }
    const innermost = active.reduce((m, a) =>
      a.end - a.start < m.end - m.start ? a : m,
    )
    const classes = Array.from(new Set(active.map((a) => anchorToneClass(a.type)))).join(' ')
    html += `<mark class="${classes}" data-anchor-index="${innermost.index}">${escaped}</mark>`
  }
  return asSafeHtml(html)
}
