/**
 * useFileDetail — file detail by slug (Story 4.4b, AC5). Returns type-tagged
 * metadata + linked locations (sessions/exercises referencing the file). No
 * view-rate (deferred to the analytics epic). The slug is the `/knowledge-hub/
 * files/{slug}` route param.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { knowledgeHubKeys } from './knowledgeHubKeys'

export type FileDetailWire = components['schemas']['FileDetail']
export type LinkedLocation = components['schemas']['LinkedLocation']

const STALE_TIME_MS = 30 * 1000

/** useFileDetail fetches one file's detail record by its slug. */
export function useFileDetail(slug: string | null) {
  return useQuery<FileDetailWire, ApiError>({
    queryKey: knowledgeHubKeys.fileDetail(slug ?? '__none__'),
    queryFn: () =>
      apiFetch<FileDetailWire>(`/api/knowledge-hub/files/${encodeURIComponent(slug ?? '')}`),
    enabled: Boolean(slug),
    staleTime: STALE_TIME_MS,
  })
}
