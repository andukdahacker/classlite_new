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

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (params: InboxListParams) => [...inboxKeys.lists(), params] as const,
  count: () => [...inboxKeys.all, 'count'] as const,
}
