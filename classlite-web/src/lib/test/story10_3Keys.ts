// Story 10.3 (Empty States) i18n key ratchet — the COMPLETE enumeration of the
// NET-NEW keys this story ships. Plain (non-`.test`) module so the master ratchet
// (`i18n-parity-coverage.test.ts`) can import it without pulling in a `.test`
// file (mirrors STORY_10_2_KEYS / the inbox slice precedent). It lives under
// `lib/test/` rather than one feature because 10.3's net-new keys span features
// (classes + questions).
//
// SCOPE: ONLY keys 10.3 ADDS. Story 10.3 is a CONSOLIDATION — it re-platforms the
// shipped empties (inbox / archive / classes / roster / knowledge-hub / analytics /
// my-performance / student-welcome) onto the canonical `EmptyState`, so almost all
// empty-state keys ALREADY exist (owned by their origin stories). Do NOT re-list
// `inbox.empty.*` / `archive.empty.*` / `dashboard.welcome.*` / the existing
// `classes.empty.{headline,body,cta}` / `people.student.list.empty.*` /
// `knowledgeHub.empty.*` / `analytics.home.empty.*` here — only the three genuinely
// new keys below.
//
// This list must stay EXHAUSTIVE: every NEW key added to en.json / vi.json for
// this story belongs here so the parity + interpolation-token ratchet guards it
// (a vi-only omission fails the suite).

/** NEW keys Story 10.3 introduces (both locales, VN co-primary). */
export const STORY_10_3_KEYS: readonly string[] = [
  // s54 classes — the brand trailing-accent word hoisted out of the headline so
  // the §6.4 italic accent lives inside EmptyState (rendered copy unchanged).
  'classes.empty.headlineAccent',
  // s58 questions — the Q&A-vs-Inbox explainer (★ REVIEWER-MANDATORY VN prose)
  // + the single Open-Inbox CTA.
  'questions.empty.teacher.explainer',
  'questions.empty.teacher.openInbox',
] as const
