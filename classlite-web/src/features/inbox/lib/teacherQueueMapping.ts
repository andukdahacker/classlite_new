/**
 * teacherQueueMapping — Story 10-1c DD6 / AC8.
 *
 * The anti-corruption seam between a `TeacherQueueItem` (a DERIVED read over
 * submissions — NOT a `Notification`) and the shared 1d-4 `InboxRowData` display
 * shape. A SIBLING of `toInboxRow` on purpose: queue items are a separate shape with
 * a separate lifecycle, so `NotificationType` stays a 7-member enum and `toInboxRow`'s
 * `never`-exhaustive switch stays intact (10-1b DD2). Widening either would couple the
 * notification contract to the grading backlog.
 *
 * The row renders through the shipped `submission` lane (BookOpen glyph +
 * `inboxRow.action.grade`). The meta line shows the STRONGER signal (DD6): overdue
 * (live clock) outranks late (is_late snapshot) outranks the neutral submitted-time
 * variant — three DISTINCT net-new keys (STORY_10_1C_KEYS, both locales). Queue rows
 * carry no read/unread state (`unread` unset) and no archive affordance
 * (`suppressArchive`) — they leave the feed only when graded + released.
 */
import i18n from '@/lib/i18n'
import { relativeTime } from '@/lib/relativeTime'

import type { components } from '@/lib/api/client'
import type { InboxRowData } from '@/components/domain/InboxRow'

type TeacherQueueItem = components['schemas']['TeacherQueueItem']

/** The meta key for the stronger-of-overdue/late/neutral signal (DD6). */
function metaKeyFor(item: TeacherQueueItem): string {
  if (item.overdue) return 'inboxRow.teacher.submission.metaOverdue'
  if (item.isLate) return 'inboxRow.teacher.submission.metaLate'
  return 'inboxRow.teacher.submission.metaSubmitted'
}

/**
 * toInboxRowFromQueueItem maps one teacher-queue item to the shared InboxRow shape.
 * Pure + null-safe: a missing submittedAt degrades to an empty occurredAt (sorted
 * last) rather than throwing — submitted/ai_processing rows always carry it in
 * practice, but the generated type is nullable.
 */
export function toInboxRowFromQueueItem(item: TeacherQueueItem): InboxRowData {
  const submittedAt = item.submittedAt ?? ''
  return {
    id: item.submissionId,
    type: 'submission',
    mainTextKey: 'inboxRow.teacher.submission.main',
    mainTextVars: { student: item.studentName, exercise: item.assignmentTitle },
    metaKey: metaKeyFor(item),
    metaVars: { class: item.className },
    occurredAt: submittedAt,
    occurredAtLabel: submittedAt ? relativeTime(submittedAt, i18n.t, i18n.language) : undefined,
    // No `unread` (queue rows have no read state); suppressArchive (DD3 — a submission
    // is not a notification and leaves the feed only when graded + released).
    suppressArchive: true,
  }
}
