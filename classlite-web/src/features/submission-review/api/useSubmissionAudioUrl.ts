/**
 * useSubmissionAudioUrl — Story 5.5a Task 3 (AC10). The on-demand fresh presigned
 * GET for the caller's own speaking recording, keyed off the assignment. Mirrors
 * `useFileDownloadUrl`'s shape: `staleTime` below the 5-min server expiry (4 min)
 * so a cached URL is considered fresh only inside its live window, and an `enabled`
 * gate so a non-speaking review never asks.
 *
 * The player drives this imperatively (via `refetch()` on play-intent / `<audio>`
 * error), so it is normally mounted disabled — the query exists for the cache key
 * + the 4-min freshness contract. 401 stays in the fetch layer (TS-5/8).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { reviewKeys } from './reviewKeys'

export type AudioUrlWire = components['schemas']['AudioUrl']

/** Below the 5-min server presign expiry — a cached URL is fresh only inside its window. */
export const AUDIO_URL_STALE_MS = 4 * 60 * 1000

/**
 * Fetch a fresh presigned GET URL for `assignmentId`'s own recording.
 * @param assignmentId the assignment whose own recording to re-sign.
 * @param enabled gate the automatic fetch (the player usually refetches manually).
 * @returns TanStack Query result whose `data` is `{ url }`.
 */
export function useSubmissionAudioUrl(assignmentId: string, enabled: boolean) {
  return useQuery<AudioUrlWire, ApiError>({
    queryKey: reviewKeys.audio(assignmentId),
    queryFn: () =>
      apiFetch<AudioUrlWire>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/submission/audio`,
      ),
    enabled,
    staleTime: AUDIO_URL_STALE_MS,
    retry: false,
  })
}
