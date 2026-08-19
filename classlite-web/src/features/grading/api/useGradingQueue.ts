/**
 * useGradingQueue — Story 6.1 (AC17). Reads the teacher grading queue for one
 * assignment via `GET /api/classes/{classId}/grading-queue?assignmentId=…`. The
 * FE walks these rows with prev/next; disabled until both ids are present.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'

export type GradingQueueRow = components['schemas']['GradingQueueRow']

const STALE_TIME_MS = 30 * 1000

/**
 * Fetch the grading queue for `classId` + `assignmentId`.
 */
export function useGradingQueue(
  classId: string | null | undefined,
  assignmentId: string | null | undefined,
) {
  return useQuery<GradingQueueRow[], ApiError>({
    queryKey: gradingKeys.queue(classId ?? '', assignmentId ?? ''),
    queryFn: () =>
      apiFetch<GradingQueueRow[]>(
        `/api/classes/${encodeURIComponent(classId ?? '')}/grading-queue?assignmentId=${encodeURIComponent(
          assignmentId ?? '',
        )}`,
      ),
    enabled: Boolean(classId && assignmentId),
    staleTime: STALE_TIME_MS,
    retry: false,
  })
}
