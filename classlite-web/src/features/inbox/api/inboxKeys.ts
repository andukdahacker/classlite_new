/**
 * inboxKeys — Story 10-1b (TS-3 hierarchical query-key factory).
 *
 * `list` carries the server filter + page so each filter/page combination is its
 * own cache entry; `count` is the single global unread-count entry the badge
 * reads. `lists()` is the partial key the optimistic mutations invalidate so
 * EVERY filter/page variation is reconciled after a mutation (DD5).
 */

/** Params for one `GET /api/inbox` page (snake_case on the wire — frozen contract). */
export interface InboxListParams {
  /** server `type` filter (a single NotificationType) — undefined = All. */
  type?: string
  /** server `unread_only` filter. */
  unreadOnly?: boolean
  page: number
  pageSize: number
}

/** The default inbox page size (CQ-3 — named, never an inline literal). */
export const INBOX_PAGE_SIZE = 20

/**
 * The bounded fetch size for the teacher merged feed (Story 10-1c DD3). Both the
 * teacher's active question notifications and ungraded backlog are bounded by class
 * size (the dashboard rail shows "~19"), so each source is fetched at this ceiling
 * and the MERGED array is paginated client-side by INBOX_PAGE_SIZE — a single
 * coherent pager (`total` = merged length), not two server totals summed. Mirrors
 * the backend MaxPageSize; when a source's server `total` exceeds it, InboxView
 * surfaces an honest seam (FU-10-1C-MERGE-PAGINATION) rather than silently truncating.
 */
export const INBOX_QUEUE_FETCH_SIZE = 100

/** Params for one `GET /api/inbox/teacher-queue` page (snake_case on the wire). */
export interface TeacherQueueParams {
  /** server `late_only` filter — the is_late snapshot (Ducdo Q3 / DD6). */
  lateOnly: boolean
  page: number
  pageSize: number
}

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (params: InboxListParams) => [...inboxKeys.lists(), params] as const,
  count: () => [...inboxKeys.all, 'count'] as const,
  teacherQueue: (params: TeacherQueueParams) => [...inboxKeys.all, 'teacher-queue', params] as const,
}
