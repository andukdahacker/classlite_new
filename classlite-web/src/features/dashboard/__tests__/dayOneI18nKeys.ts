// Story 10.5 (Teacher Day-One Guided Start) i18n key ratchet — the COMPLETE
// enumeration of the NET-NEW keys this story ships. Plain (non-`.test`) module
// so the master ratchet (`i18n-parity-coverage.test.ts`) can import it without
// pulling in a `.test` file (mirrors STORY_10_2_KEYS / STORY_10_3_KEYS).
//
// SCOPE: ONLY keys 10.5 ADDS. All strings live under the `dashboard.teacher.
// dayOne.*` namespace. The prose is ★ REVIEWER-MANDATORY (VN-fluent) — the
// parity ratchet checks existence + interpolation-token shape only, never
// translation correctness.

/** NEW keys Story 10.5 introduces (both locales, VN co-primary). */
export const STORY_10_5_KEYS: readonly string[] = [
  // Page-head greeting (the name is rendered as a trailing §6.4 accent span at
  // the call site, so the key carries no {{name}} token).
  'dashboard.teacher.dayOne.title',
  // Per-step mono eyebrow — the ONLY interpolated key ({{n}}).
  'dashboard.teacher.dayOne.eyebrow',
  // Non-colour-only text status badges (AC4 a11y — done/active/locked states
  // are announced by text, not colour alone).
  'dashboard.teacher.dayOne.status.done',
  'dashboard.teacher.dayOne.status.todo',
  'dashboard.teacher.dayOne.status.active',
  'dashboard.teacher.dayOne.status.locked',
  // Step 1 — Profile set (endowed-progress done-state).
  'dashboard.teacher.dayOne.step1.title',
  'dashboard.teacher.dayOne.step1.description',
  // Step 2 — Create your first class (the active card + the single live CTA).
  'dashboard.teacher.dayOne.step2.title',
  'dashboard.teacher.dayOne.step2.description',
  'dashboard.teacher.dayOne.step2.cta',
  // Step 3 — Invite your students (locked until a class exists; disabled CTA).
  'dashboard.teacher.dayOne.step3.title',
  'dashboard.teacher.dayOne.step3.description',
  'dashboard.teacher.dayOne.step3.cta',
] as const
