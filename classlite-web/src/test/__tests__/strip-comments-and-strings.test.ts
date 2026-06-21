/**
 * Shared source-scanning util tests — Story 1d-3 follow-up #16.
 *
 * Regression coverage for the JSDoc-apostrophe bug that took out the
 * required-exports parser AND i18n-parity's array extractor when the
 * two scanners drifted independently. The shared util landed during
 * 1d-3 party-mode review follow-up; these tests keep both consumers
 * honest if a future "small refactor" reintroduces the bug.
 */
import { describe, expect, test } from 'vitest'
import {
  stripComments,
  stripCommentsAndStrings,
} from '../../../scripts/lib/strip-comments-and-strings.mjs'

describe('stripComments — preserves string literals (used by i18n-parity)', () => {
  test('apostrophe inside JSDoc does NOT eat the following string literal', () => {
    // The bug: a single-pass stripper treated `1-7c's` as a string opener
    // and ate everything until the next `'` (typically the array
    // delimiter), wiping out the key names.
    const input = `
      /**
       * Comment with 1-7c's apostrophe — used to be the bug trigger.
       */
      const STORY_KEYS = [
        'sidebar.owner.dashboard',
        'sidebar.owner.inbox',
      ]
    `
    const out = stripComments(input)
    expect(out).toContain("'sidebar.owner.dashboard'")
    expect(out).toContain("'sidebar.owner.inbox'")
    expect(out).toContain('[')
    expect(out).toContain(']')
  })

  test('line comments are blanked but strings stay', () => {
    const input = `// comment\nconst x = 'hello'`
    const out = stripComments(input)
    expect(out).toContain("'hello'")
    expect(out).not.toContain('comment')
  })

  test('block comments are blanked', () => {
    const input = `/* block */\nconst x = 'hello'`
    const out = stripComments(input)
    expect(out).toContain("'hello'")
    expect(out).not.toContain('block')
  })

  test('preserves line/column positions via space-replacement', () => {
    const input = `/* ten char */const x = 1`
    const out = stripComments(input)
    expect(out.length).toBe(input.length)
    expect(out.indexOf('const')).toBe(input.indexOf('const'))
  })
})

describe('stripCommentsAndStrings — strips both (used by required-exports)', () => {
  test('strings ARE blanked alongside comments', () => {
    const input = `const x = 'export const Empty = {}'`
    const out = stripCommentsAndStrings(input)
    // The string literal's contents become spaces so the export-extractor
    // does not false-positive on `export const` inside a string.
    expect(out).not.toContain('export const Empty')
    expect(out).toContain('const x =')
  })

  test('apostrophe inside JSDoc does not break export parsing', () => {
    // Regression for the bug: previously, `1d-2's` opened a fake string
    // and ate the `export const Default = {}` declaration below.
    const input = `
      /**
       * 1d-2's component story.
       */
      export const Default = {}
      export const Loading = {}
    `
    const out = stripCommentsAndStrings(input)
    expect(out).toContain('export const Default')
    expect(out).toContain('export const Loading')
  })
})
