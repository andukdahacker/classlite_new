/**
 * useInbox — Story 10-1b (AC2). The caller's paginated active-queue over the
 * frozen `GET /api/inbox` contract. Uses `apiFetchWithMeta` so `meta.pagination`
 * survives the envelope unwrap (the header "N unread · M total" + pager read it).
 * Server-side single-type filtering (DD8) keeps `total` honest — never
 * client-filter a page. `keepPreviousData` avoids an empty flash on page change.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { components } from '@/lib/api/client'
import { apiFetchWithMeta } from '@/lib/api-fetch'

import { inboxKeys, type InboxListParams } from './inboxKeys'

export type Notification = components['schemas']['Notification']
export type PaginationMeta = components['schemas']['PaginationMeta']
type ListMeta = components['schemas']['EnvelopeMetaListPaginated']

const STALE_TIME_MS = 30 * 1000

export interface InboxListResult {
  items: Notification[]
  pagination: PaginationMeta
  /** Server clock from the list envelope (skew-immune relative-time reference). */
  serverTime: string
}

/** Build the snake_case `GET /api/inbox` query string (frozen contract). */
function buildInboxQuery(params: InboxListParams): string {
  const search = new URLSearchParams()
  if (params.type) search.set('type', params.type)
  if (params.unreadOnly) search.set('unread_only', 'true')
  search.set('page', String(params.page))
  search.set('page_size', String(params.pageSize))
  return search.toString()
}

/** Fetch one inbox page for the active filter. */
export function useInbox(params: InboxListParams) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: async (): Promise<InboxListResult> => {
      const envelope = await apiFetchWithMeta<Notification[], ListMeta>(
        `/api/inbox?${buildInboxQuery(params)}`,
      )
      return {
        items: envelope.data,
        pagination: envelope.meta.pagination,
        serverTime: envelope.meta.serverTime,
      }
    },
    staleTime: STALE_TIME_MS,
    placeholderData: keepPreviousData,
  })
}
