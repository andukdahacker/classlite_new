/**
 * Hand-written types for the .mjs shared util. Keeps `tsc -b` happy when
 * `src/test/storybook-rules/required-exports.ts` imports the functions.
 * See `strip-comments-and-strings.mjs` for implementation + history.
 */

/** Strip block + line comments only. Use when downstream needs to see string literals. */
export function stripComments(source: string): string

/** Strip block + line comments AND every string-literal kind. Use when string literals are noise. */
export function stripCommentsAndStrings(source: string): string
