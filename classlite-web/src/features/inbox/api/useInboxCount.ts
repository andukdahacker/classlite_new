/**
 * useInboxCount — Story 10-1b (AC4 / DD4). The unread-count poller that feeds the
 * sidebar + mobile Inbox badge. The count lives in the Query cache (FW-4) so the
 * badge reads from cache and the optimistic mutations (DD5) decrement it without
 * waiting for the next poll — NOT `usePolling` (that bypasses the cache).
 *
 * Consumed by exactly ONE mount (AppLayout) so there is a SINGLE poller instance
 * across the app (AC4); role views read the cached count, never re-fetch it.
 * `enabled` gates on a non-null role so a logged-out shell never 401-storms
 * `/count`. `refetchIntervalInBackground: false` → the poll pauses on a hidden tab.
 */
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-fetch'

import { inboxKeys } from './inboxKeys'

/**
 * INBOX_POLL_INTERVAL_MS — badge refetch cadence (CQ-3: named const, not inline;
 * architecture.md:247 mandates the 30–60s band + configurability).
 */
export const INBOX_POLL_INTERVAL_MS = 45_000

export interface UnreadCount {
  unread: number
}

/** Poll the caller's global unread count for the nav badge. */
export function useInboxCount(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  return useQuery({
    queryKey: inboxKeys.count(),
    queryFn: () => apiFetch<UnreadCount>('/api/inbox/count'),
    enabled,
    staleTime: 0,
    refetchInterval: INBOX_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}
