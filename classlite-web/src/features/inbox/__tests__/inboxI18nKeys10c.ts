// Story 10-1c i18n key ratchet — the COMPLETE enumeration of the NET-NEW keys this
// story ships. Plain (non-`.test`) module so the master ratchet
// (`i18n-parity-coverage.test.ts`) can import it without importing a `.test` file
// (mirrors STORY_10_1B_KEYS in inboxI18nKeys.ts).
//
// SCOPE: only keys 10-1c ADDS. The submission ROW main text + Grade action
// (`inboxRow.teacher.submission.main`, `inboxRow.action.grade`) and the Submissions
// chip (`inboxList.filter.submissions`) are 1d-4 chrome — do NOT re-list them (the
// ratchet's orphan/duplicate guard would trip). Net-new in 10-1c: the three
// submission meta variants (DD6), the Late chip label, the in-feed "N to grade"
// count, and the merge-ceiling seam copy (DD3).
//
// This list must stay EXHAUSTIVE: every NEW key added to en.json / vi.json belongs
// here so the parity + interpolation-token ratchet guards it (a vi-only omission
// fails CI). Keys carrying `{{tokens}}` are covered by assertI18nInterpolationParity.

/** NEW keys this story introduces (both locales, VN co-primary). */
export const STORY_10_1C_KEYS: readonly string[] = [
  // submission row meta — the stronger-signal variant (DD6/AC8).
  'inboxRow.teacher.submission.metaOverdue', // {{class}}
  'inboxRow.teacher.submission.metaLate', // {{class}}
  'inboxRow.teacher.submission.metaSubmitted', // {{class}}
  // teacher grading-queue chip (submissions reuses the 1d-4 inboxList.filter.submissions).
  'inboxList.filters.late',
  // in-feed grading-backlog count (NOT the nav badge — Ducdo Q2).
  'inbox.teacher.toGrade', // {{count}}
  // the DD3 merge-ceiling honest seam (shown when a source total exceeds the page fetch).
  'inbox.teacher.queueCeiling',
] as const
