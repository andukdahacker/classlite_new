/**
 * useArchive — Story 10.2 (AC1/AC8). The caller's role-scoped, paginated archive
 * over GET /api/archive. Uses `apiFetchWithMeta` so `meta.pagination` survives
 * the envelope unwrap (the pager reads it). The server role-scopes the rows
 * (teacher → own); the `scope` discriminator keeps teacher/owner cache slots
 * distinct. `keepPreviousData` avoids an empty flash on page/filter change.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { components } from '@/lib/api/client'
import { apiFetchWithMeta } from '@/lib/api-fetch'

import {
  archiveKeys,
  type ArchiveListParams,
  type ArchiveScope,
} from './archiveKeys'
import type { ArchiveItem } from '../lib/archiveMapping'

export type PaginationMeta = components['schemas']['PaginationMeta']
type ListMeta = components['schemas']['EnvelopeMetaPagination']

const STALE_TIME_MS = 30 * 1000

export interface ArchiveListResult {
  items: ArchiveItem[]
  pagination: PaginationMeta
}

/** Build the snake_case GET /api/archive query string (the frozen contract). */
function buildArchiveQuery(params: ArchiveListParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('page_size', String(params.pageSize))
  if (params.type) search.set('type', params.type)
  return search.toString()
}

/** Fetch one role-scoped archive page for the active type filter. */
export function useArchive(
  centerId: string | null | undefined,
  scope: ArchiveScope,
  params: ArchiveListParams,
) {
  return useQuery({
    queryKey: centerId
      ? archiveKeys.list(centerId, scope, params)
      : archiveKeys.listDisabled(),
    queryFn: async (): Promise<ArchiveListResult> => {
      const envelope = await apiFetchWithMeta<ArchiveItem[], ListMeta>(
        `/api/archive?${buildArchiveQuery(params)}`,
      )
      return {
        items: envelope.data,
        pagination: envelope.meta.pagination,
      }
    },
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
    placeholderData: keepPreviousData,
  })
}
