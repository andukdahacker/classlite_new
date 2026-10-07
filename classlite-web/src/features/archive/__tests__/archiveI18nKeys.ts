// Story 10-2 i18n key ratchet — the COMPLETE enumeration of the NET-NEW keys this
// story ships. Plain (non-`.test`) module so the master ratchet
// (`i18n-parity-coverage.test.ts`) can import it without importing a `.test` file
// (mirrors STORY_10_1B_KEYS / STORY_10_1C_KEYS in the inbox slice).
//
// SCOPE: only keys 10-2 ADDS. The sidebar labels (`sidebar.{owner,admin,teacher}.archive`)
// already ship (1d-4 chrome) — do NOT re-list them (the ratchet's orphan/duplicate
// guard would trip). Net-new in 10-2: the archive page title/subtitle, the type
// filter chips, the per-type row meta (DD7), the two reuse-verb actions + toasts
// (Ducdo D3/DD4), the role-toned empty (s60), and the inline error.
//
// This list must stay EXHAUSTIVE: every NEW key added to en.json / vi.json belongs
// here so the parity + interpolation-token ratchet guards it (a vi-only omission
// fails CI). Keys carrying `{{tokens}}` are covered by assertI18nInterpolationParity.

/** NEW keys this story introduces (both locales, VN co-primary). */
export const STORY_10_2_KEYS: readonly string[] = [
  // page chrome
  'archive.title',
  'archive.subtitle',
  // type filter chips (Classes / Exercises / All)
  'archive.filter.all',
  'archive.filter.classes',
  'archive.filter.exercises',
  // read-only treatment (DD6) + per-type row meta (DD7)
  'archive.row.readOnlyBadge',
  'archive.row.exercise.meta', // {{skill}} · band {{targetBand}}
  'archive.row.class.meta', // ended {{endedAt}}
  // the two reuse verbs (exercises only — Ducdo D3/DD4)
  'archive.actions.duplicate',
  'archive.actions.editCopy',
  'archive.toast.duplicated',
  'archive.toast.error',
  // empty state (s60) — role-toned, Fraunces italic-accent word
  'archive.empty.title',
  'archive.empty.titleAccent',
  'archive.empty.body',
  // inline error (UX-1 trilogy; not a full-page error)
  'archive.error.message',
  'archive.error.retry',
] as const
