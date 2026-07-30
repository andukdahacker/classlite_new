/**
 * useStorageUsage — the center's storage usage + ceiling (Story 4.4b, AC7).
 * Feeds the Settings → Storage read-only meter AND the upload-seam 100% block.
 * `staleTime: 0` so the upload dialog always opens against fresh headroom (a
 * just-completed upload elsewhere must not let a stale "not full" read through).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { knowledgeHubKeys } from './knowledgeHubKeys'

export type StorageUsageWire = components['schemas']['StorageUsage']

/** useStorageUsage fetches `{ usedBytes, limitBytes }` for the caller's center. */
export function useStorageUsage(centerId: string | null) {
  return useQuery<StorageUsageWire, ApiError>({
    queryKey: knowledgeHubKeys.storageUsage(centerId ?? '__none__'),
    queryFn: () => apiFetch<StorageUsageWire>('/api/storage/usage'),
    enabled: Boolean(centerId),
    staleTime: 0, // real-time: storage-full gating must reflect the latest upload
  })
}
