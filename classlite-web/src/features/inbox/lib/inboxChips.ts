/**
 * inboxChips — Story 10-1b DD8 (AC8b).
 *
 * Derives a role's filter chips from the `NotificationType`s that role actually
 * receives in v1 (no permanently-empty chips). The FE-owned cross-role guard:
 * the admin set must NOT contain a Billing or Alerts chip, the owner set MUST —
 * so a later copy-paste widening of the admin config fails a unit test, not
 * production (Murat). Role-scope authz itself is a 10-1a WRITE invariant; this is
 * purely which chips the UI offers.
 *
 * `chip.key` doubles as the i18n label key (InboxListShell renders `t(key)`).
 * Server-side single-type filtering keeps pagination honest (never client-filter
 * a page — it corrupts `total`); `chipFilter` maps an active chip.key to the
 * `GET /api/inbox` query params.
 */
import type { Role } from '@/features/auth/api/authKeys'
import type { InboxFilterChip } from '@/components/domain/InboxListShell'
import type { components } from '@/lib/api/client'

type NotificationType = components['schemas']['NotificationType']

/** Query params a chip applies to `GET /api/inbox`. */
export interface InboxChipFilter {
  type?: NotificationType
  unreadOnly?: boolean
}

type ChipId =
  | 'all'
  | 'unread'
  | 'grades'
  | 'assignments'
  | 'schedule'
  | 'questions'
  | 'submissions'
  | 'late'
  | 'enrolments'
  | 'billing'
  | 'alerts'

/**
 * A chip draws from one of two sources (Story 10-1c): the `GET /api/inbox`
 * notification feed (`filter`) OR the teacher `GET /api/inbox/teacher-queue` derived
 * read (`queue`). The 10-1b chips are all notification-sourced; the net-new teacher
 * `submissions`/`late` chips are queue-sourced (`queue.lateOnly` is the SERVER-side
 * is_late filter — Ducdo Q3 / DD6).
 */
interface ChipDef {
  /** i18n label key — also the chip's stable identity. */
  key: string
  filter?: InboxChipFilter
  queue?: { lateOnly: boolean }
}

// The canonical chip definitions. `all`/grades/assignments/questions/enrolments/
// billing/submissions reuse the 1d-4 `inboxList.filter.*` labels; the net-new
// unread/schedule/alerts labels live under `inboxList.filters.*` (STORY_10_1B_KEYS),
// as does the net-new `late` label (STORY_10_1C_KEYS).
const CHIPS: Record<ChipId, ChipDef> = {
  all: { key: 'inboxList.filter.all', filter: {} },
  unread: { key: 'inboxList.filters.unread', filter: { unreadOnly: true } },
  grades: { key: 'inboxList.filter.grades', filter: { type: 'grade_released' } },
  assignments: { key: 'inboxList.filter.assignments', filter: { type: 'assignment_created' } },
  schedule: { key: 'inboxList.filters.schedule', filter: { type: 'schedule_changed' } },
  questions: { key: 'inboxList.filter.questions', filter: { type: 'question_asked' } },
  submissions: { key: 'inboxList.filter.submissions', queue: { lateOnly: false } },
  late: { key: 'inboxList.filters.late', queue: { lateOnly: true } },
  enrolments: { key: 'inboxList.filter.enrolments', filter: { type: 'enrollment_changed' } },
  billing: { key: 'inboxList.filter.billing', filter: { type: 'payment_failed' } },
  alerts: { key: 'inboxList.filters.alerts', filter: { type: 'storage_threshold' } },
}

// Per-role chip order — leads with All + Unread, then one chip per v1 source the
// role sees (DD8/DD4). teacher gains the grading-queue chips (submissions + late) in
// 10-1c; admin gets People only; owner adds Billing + Alerts. The cross-role guard:
// only teacher carries submissions/late (a later copy-paste widening fails a unit test).
const ROLE_CHIPS: Record<Role, ChipId[]> = {
  student: ['all', 'unread', 'grades', 'assignments', 'schedule'],
  teacher: ['all', 'unread', 'questions', 'submissions', 'late'],
  admin: ['all', 'unread', 'enrolments'],
  owner: ['all', 'unread', 'enrolments', 'billing', 'alerts'],
}

/** deriveInboxChips returns the role's filter chips (key = i18n label key). */
export function deriveInboxChips(role: Role): InboxFilterChip[] {
  return ROLE_CHIPS[role].map((id) => ({ key: CHIPS[id].key }))
}

/** chipFilter resolves an active chip.key to its `GET /api/inbox` query params.
 *  Returns `{}` for queue-sourced chips (they fetch the teacher-queue, not the feed). */
export function chipFilter(chipKey: string): InboxChipFilter {
  for (const def of Object.values(CHIPS)) {
    if (def.key === chipKey) return def.filter ?? {}
  }
  return {}
}

/**
 * teacherQueueChip resolves a chip.key to its teacher-queue source descriptor, or
 * null when the chip is notification-sourced. `{ lateOnly: false }` = the full
 * ungraded backlog (Submissions); `{ lateOnly: true }` = the is_late slice (Late,
 * SERVER-side filter — Ducdo Q3).
 */
export function teacherQueueChip(chipKey: string): { lateOnly: boolean } | null {
  for (const def of Object.values(CHIPS)) {
    if (def.key === chipKey) return def.queue ?? null
  }
  return null
}
