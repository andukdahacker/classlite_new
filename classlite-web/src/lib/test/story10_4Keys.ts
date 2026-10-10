// Story 10.4 (Error States) i18n key ratchet — the COMPLETE enumeration of the
// NET-NEW keys this story ships. Plain (non-`.test`) module so the master ratchet
// (`i18n-parity-coverage.test.ts`) can import it without pulling in a `.test`
// file (mirrors STORY_10_3_KEYS / STORY_10_2_KEYS). It lives under `lib/test/`
// rather than one feature because 10.4's net-new keys span features (attempts +
// classes + exercises + app-shell + knowledge-hub).
//
// SCOPE: ONLY keys 10.4 ADDS. Story 10.4 is largely a CONSOLIDATION — it
// re-platforms the shipped `ErrorAlert`s onto the canonical `ErrorState` (whose
// copy already exists, owned by its origin stories) — so almost no error-state
// keys are new. The genuinely NEW keys are the s64 deadline copy + extension
// hint, the s65 validation banner + name-conflict + owner capacity cap + upgrade
// CTA, the s66 locked-exercise strip, the s67 current-role line, and the storage
// "View storage" CTA. Do NOT re-list any pre-existing key here.
//
// This list must stay EXHAUSTIVE: every NEW key added to en.json / vi.json for
// this story belongs here so the parity + interpolation-token ratchet guards it
// (a vi-only omission fails the suite). The sentence-length prose entries are
// ★ REVIEWER-MANDATORY (VN-fluent) — the ratchet checks existence + token-shape,
// never translation correctness.

/** NEW keys Story 10.4 introduces (both locales, VN co-primary). */
export const STORY_10_4_KEYS: readonly string[] = [
  // s64 hard-deadline lock — deadline-framed copy + a text-level extension next-step (★ VN).
  'attempt.readonly.deadlinePassed',
  'attempt.readonly.extensionHint',
  // s65 class-form validation — banner summary ({{count}}) + the two client-side checks (★ VN).
  'classes.form.validationBanner.title',
  'classes.form.errors.nameConflict',
  'classes.form.errors.capacityOverPlan', // {{cap}} / {{planName}}
  'classes.form.errors.capacityUpgradeCta',
  // s66 locked finalized exercise — the clone-only read-only strip (★ VN on the body).
  'exercises.locked.indicator',
  'exercises.locked.strip.title',
  'exercises.locked.strip.body',
  'exercises.locked.clone.cta',
  'exercises.locked.clone.error', // review patch — Clone-failure toast (sole unlock path).
  // s67 permission denied — the current-role line that completes the triad ({{role}}, ★ VN).
  'app.permissionDenied.currentRole',
  // storage-100% upload — the "View storage" escape CTA.
  'knowledgeHub.storage.full.viewStorageCta',
] as const
