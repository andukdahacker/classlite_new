// Story 8-4b i18n key ratchet — the COMPLETE enumeration of the `search.*` keys
// this story ships. Extracted into a plain (non-`.test`) module so the master
// ratchet (`i18n-parity-coverage.test.ts`) can import the list WITHOUT importing
// a `.test` file (which would re-execute its describe/test registrations).
//
// This list must stay EXHAUSTIVE: every `search.*` key added to en.json / vi.json
// belongs here so the parity + interpolation-token ratchet guards it (a vi-only
// omission of any listed key fails CI). Keys carrying `{{tokens}}` are covered by
// `assertI18nInterpolationParity` (idle→min, empty/seeAll→query, count→count).

/** NEW search keys this story introduces (both locales, VN co-primary). */
export const STORY_8_4B_KEYS: readonly string[] = [
  // dialog chrome + input
  'search.dialog.title',
  'search.dialog.description',
  'search.input.placeholder',
  // state machine (idle / error / empty) + count
  'search.idle.prompt',
  'search.error.message',
  'search.error.retry',
  'search.empty',
  'search.results.count',
  // per-category "See all" doorway
  'search.seeAll',
  // category headings (server render order)
  'search.category.classes',
  'search.category.students',
  'search.category.exercises',
  'search.category.assignments',
  'search.category.files',
  // platform glyph (⌘K vs Ctrl K)
  'search.hint.mac',
  'search.hint.other',
]
