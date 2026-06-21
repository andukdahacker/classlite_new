/**
 * Source-scanning helpers shared between `src/test/storybook-rules/required-exports.ts`
 * and `scripts/i18n-parity.mjs`.
 *
 * Story 1d-3 party-mode review (Winston, 2026-06-21) flagged the prior
 * two-copy state as tech-debt: both scanners had a JSDoc-apostrophe bug
 * (`1-7c's` opened a fake string that ate everything to the next `'`).
 * The shared util is now the single source of truth.
 *
 * Two exports because the two consumers need different shapes:
 *
 *   - `stripComments(source)` — strips BLOCK + LINE comments only.
 *     Used by `i18n-parity.mjs` to safely scan for `STORY_*_KEYS =
 *     [...] as const` array literals where the STRING LITERALS INSIDE
 *     ARE THE KEY NAMES we care about and must be preserved.
 *
 *   - `stripCommentsAndStrings(source)` — strips comments AND every
 *     kind of string literal (single, double, template). Used by the
 *     `required-exports` extractor to find `export const Foo = ...`
 *     declarations where string literals are just noise.
 *
 * Each removed region is replaced with spaces of equal length so any
 * downstream regex anchor positions stay stable. Passes are applied
 * sequentially — block comments first, then line comments, then strings
 * — so a line comment inside a block comment can't false-match as a
 * separate line comment, and an apostrophe inside a (now-blank) comment
 * can't false-match as a string opener.
 *
 * A real tokenizer (acorn / @babel/parser) is deferred until a third
 * bug surfaces in this scanner. See follow-up tech-debt task.
 */

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /\/\/[^\n]*/g
const SINGLE_QUOTE = /'(?:\\.|[^'\\])*'/g
const DOUBLE_QUOTE = /"(?:\\.|[^"\\])*"/g
const TEMPLATE = /`(?:\\.|[^`\\])*`/g

function blankMatches(source, pattern) {
  const out = source.split('')
  let m
  while ((m = pattern.exec(source)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (out[i] !== '\n') out[i] = ' '
    }
  }
  return out.join('')
}

function applyPasses(source, passes) {
  let result = source
  for (const pattern of passes) {
    result = blankMatches(result, pattern)
  }
  return result
}

export function stripComments(source) {
  return applyPasses(source, [BLOCK_COMMENT, LINE_COMMENT])
}

export function stripCommentsAndStrings(source) {
  return applyPasses(source, [
    BLOCK_COMMENT,
    LINE_COMMENT,
    SINGLE_QUOTE,
    DOUBLE_QUOTE,
    TEMPLATE,
  ])
}
