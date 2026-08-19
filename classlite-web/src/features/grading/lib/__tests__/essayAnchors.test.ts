import { describe, expect, test } from 'vitest'

import {
  anchorToneClass,
  buildEssayHtml,
  normalizeAnchor,
  utf16Len,
  utf16Slice,
  type EssayAnchor,
} from '../essayAnchors'

describe('buildEssayHtml — escapes then marks (XSS + AC13)', () => {
  test('escapes student HTML before any mark (no injection)', () => {
    const html = buildEssayHtml('<script>alert(1)</script>', [])
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  test('wraps a span in a toned <mark> with the innermost anchor index', () => {
    const anchors: EssayAnchor[] = [{ start: 0, end: 4, type: 'error', index: 0 }]
    const html = buildEssayHtml('word rest', anchors)
    expect(html).toContain('<mark class="cl-anchor-error" data-anchor-index="0">word</mark>')
    expect(html).toContain('rest')
  })

  test('overlapping anchors blend classes; innermost (shortest) wins the click index', () => {
    // "abcdef": anchor A [0,6) error (outer), anchor B [2,4) praise (inner).
    const anchors: EssayAnchor[] = [
      { start: 0, end: 6, type: 'error', index: 0 },
      { start: 2, end: 4, type: 'praise', index: 1 },
    ]
    const html = buildEssayHtml('abcdef', anchors)
    // The overlap segment [2,4) carries BOTH tone classes and the inner index (1).
    expect(html).toMatch(/cl-anchor-error cl-anchor-praise|cl-anchor-praise cl-anchor-error/)
    expect(html).toContain('data-anchor-index="1"')
  })

  test('escapes a & in the essay inside a mark', () => {
    const html = buildEssayHtml('a & b', [{ start: 0, end: 5, type: 'suggestion', index: 0 }])
    expect(html).toContain('a &amp; b')
    expect(html).toContain('cl-anchor-suggest')
  })
})

describe('normalizeAnchor — UTF-16 offset contract (D3)', () => {
  test('accepts an in-range ordered span', () => {
    expect(normalizeAnchor('hello world', 0, 5)).toEqual({ start: 0, end: 5 })
  })
  test('orders a reversed span', () => {
    expect(normalizeAnchor('hello', 4, 1)).toEqual({ start: 1, end: 4 })
  })
  test('rejects out-of-range (→ demote to whole-essay)', () => {
    expect(normalizeAnchor('short', 0, 100)).toBeNull()
  })
  test('rejects a collapsed span', () => {
    expect(normalizeAnchor('hello', 3, 3)).toBeNull()
  })
  test('trailing whitespace is excluded from the max offset', () => {
    // "abc   " → trimmed length 3; an anchor into the trailing spaces is demoted.
    expect(normalizeAnchor('abc   ', 0, 5)).toBeNull()
    expect(normalizeAnchor('abc   ', 0, 3)).toEqual({ start: 0, end: 3 })
  })
})

describe('utf16 helpers — multibyte (D3)', () => {
  test('emoji is 2 code units', () => {
    const essay = 'Café 🎉 test'
    expect(utf16Len('🎉')).toBe(2)
    expect(utf16Slice(essay, 5, 7)).toBe('🎉')
  })
})

describe('anchorToneClass', () => {
  test('maps wire types to CommentCard tones', () => {
    expect(anchorToneClass('error')).toBe('cl-anchor-error')
    expect(anchorToneClass('praise')).toBe('cl-anchor-praise')
    expect(anchorToneClass('suggestion')).toBe('cl-anchor-suggest')
  })
})
