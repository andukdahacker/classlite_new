// Story 10-1b i18n key ratchet — the COMPLETE enumeration of the NET-NEW keys
// this story ships. Extracted into a plain (non-`.test`) module so the master
// ratchet (`i18n-parity-coverage.test.ts`) can import the list WITHOUT importing a
// `.test` file (mirrors `search/__tests__/searchI18nKeys.ts`, STORY_8_4B_KEYS).
//
// SCOPE: only keys 10-1b ADDS. The inbox ROW/LIST chrome keys (`inboxRow.*`,
// `inboxList.filters.{all,questions,submissions,mentions,replies,grades,
// assignments,enrolments,staff,billing,integrations}`, `inboxList.empty`, …) were
// shipped by Story 1d-4 and live in STORY_1D_4_KEYS — do NOT re-list them here (the
// ratchet's orphan/duplicate guard would trip). Net-new filter chips introduced by
// 10-1b: `unread`, `schedule`, `alerts`.
//
// This list must stay EXHAUSTIVE: every NEW key added to en.json / vi.json belongs
// here so the parity + interpolation-token ratchet guards it (a vi-only omission
// fails CI). Keys carrying `{{tokens}}` are covered by assertI18nInterpolationParity
// (header unread·total, relativeTime count, reply student).

/** NEW keys this story introduces (both locales, VN co-primary). */
export const STORY_10_1B_KEYS: readonly string[] = [
  // page chrome
  'inbox.page.title',
  'inbox.header.unreadTotal', // {{unread}} · {{total}}
  'inbox.header.total', // {{total}} — filtered view (code-review 10-1b D2b)
  'inbox.action.markAllRead',
  // pager (code-review 10-1b D2a)
  'inbox.pager.label',
  'inbox.pager.prev',
  'inbox.pager.next',
  'inbox.pager.status', // {{page}} / {{totalPages}}
  // filtered-empty, distinct from the day-one role-toned empty (code-review 10-1b D2c)
  'inbox.filtered.empty',
  // loading/empty/error trilogy error branch (DD9 / AC2)
  'inbox.error.message',
  'inbox.error.retry',
  // archive undo toast (DD5 / Sally)
  'inbox.toast.archived',
  'inbox.toast.undo',
  // net-new filter chips (DD8 — the ones 1d-4 did not ship)
  'inboxList.filters.unread',
  'inboxList.filters.schedule',
  'inboxList.filters.alerts',
  // relative time formatter buckets (DD4) — {{count}} on the plural ones
  'inbox.time.justNow',
  'inbox.time.minutes',
  'inbox.time.hours',
  'inbox.time.days',
  // role-toned empty states (s56 / DD9) — headline lead + ONE italic-accent word
  // (the §6.4 brand signature, rendered in a `<span className="italic">` per the
  // StudentWelcome precedent) + a muted body per lens.
  'inbox.empty.student.title',
  'inbox.empty.student.titleAccent',
  'inbox.empty.student.body',
  'inbox.empty.teacher.title',
  'inbox.empty.teacher.titleAccent',
  'inbox.empty.teacher.body',
  'inbox.empty.ownerAdmin.title',
  'inbox.empty.ownerAdmin.titleAccent',
  'inbox.empty.ownerAdmin.body',
  // teacher reply composer (AC7) — visibility toggle is load-bearing (Sally)
  'inbox.reply.placeholder',
  'inbox.reply.send',
  'inbox.reply.visibility.shared',
  'inbox.reply.visibility.private',
  'inbox.reply.visibility.label', // neutral group label (code-review 10-1b P8)
  'inbox.reply.error.required',
  'inbox.reply.error.failed', // silent-failure fix (code-review 10-1b P2)
  // mapper render catalog (DD2/DD3) — null-safe title variants per lane, tuned to
  // the fields the REAL 10-1a metadata carries (the 1d-4 inboxRow.*.main keys bake
  // in band/plan/status the payload never has). `.title` uses a var; `.titleGeneric`
  // is the degraded no-var variant. Namespaced under inboxRow.* beside the 1d-4 keys.
  'inboxRow.grade.title',
  'inboxRow.grade.titleGeneric',
  'inboxRow.assignment.title',
  'inboxRow.assignment.titleGeneric',
  'inboxRow.schedule.title',
  'inboxRow.schedule.titleGeneric',
  'inboxRow.question.title',
  'inboxRow.question.titleGeneric',
  'inboxRow.enrolment.title',
  'inboxRow.enrolment.titleGeneric',
  'inboxRow.billing.title',
  'inboxRow.storage.title',
  'inboxRow.storage.titleGeneric',
  // mapper meta line (class + absolute date, or date alone) — vnDate formatter token
  'inboxRow.meta.classDate',
  'inboxRow.meta.date',
  // the flagged all-thin / unknown-type escape hatch (INBOX_FALLBACK_KEY, P0)
  'inboxRow.fallback',
]
