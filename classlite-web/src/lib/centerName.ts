/**
 * centerName — shared regex + rune-length constants for center-name validation.
 *
 * Extracted from `src/features/auth/lib/sanitizeCenterName.ts` in Story 2-3a
 * (Amelia-B1 fold) so both `sanitizeCenterName` (auth feature — sender-controlled
 * invite ribbon) and the onboarding Zod schema (`useCenterSetupSchema`) can consume
 * the same rules without a cross-feature import that would violate TS-7.
 *
 * Character class `[\p{L}\p{N}\s\-'.]` — Unicode letters / digits / whitespace /
 * hyphen / apostrophe / period only. Excludes `&`, `<`, `>`, `/`, `\`, `(`, `)`,
 * `:`, `;`, `,`, `@`, `#`, `$`, `*`, emoji, null bytes, control chars, every other
 * non-alphanumeric. Length ceiling is 60 runes (measured with
 * `Array.from(v).length`, NOT `.length` — Vietnamese diacritics + emoji surrogate
 * pairs make `.length` a byte proxy that under-counts).
 */

export const CENTER_NAME_REGEX = /^[\p{L}\p{N}\s\-'.]{1,60}$/u

export const CENTER_NAME_MAX_RUNES = 60

/** Grapheme-safe rune count. `Array.from(v).length` is the JS analogue of Go's
 * `utf8.RuneCountInString` — mirrors Story 2.1's P3 backend fix so client + server
 * both count `Trung tâm` as 8 runes (not 12 UTF-16 code units). */
export function centerNameRuneLength(value: string): number {
  return Array.from(value).length
}
