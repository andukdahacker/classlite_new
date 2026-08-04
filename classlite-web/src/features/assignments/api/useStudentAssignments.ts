/**
 * useStudentAssignments — Story 5.2c (AC2/AC3). The student's enrollment-scoped,
 * paginated assignment list. Uses `apiFetchWithMeta` (not `apiFetch`) so
 * `meta.pagination` (page/pageSize/total/totalPages) + `meta.serverTime` survive
 * the envelope unwrap — the pagination controls read the former, the overdue
 * marker (AC5, `isOverdue`) reads the latter as the reference clock so a stale
 * client wall-clock never flips an assignment overdue early. `keepPreviousData`
 * keeps the list from flickering to empty on a page change (mirrors
 * `useExercises`). Read-only over the already-shipped `GET /api/assignments`
 * (5.2a) — no mutation, no codegen.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta } from '@/lib/api-fetch'
import {
  assignmentKeys,
  type StudentAssignmentListParams,
} from './assignmentKeys'

export type StudentAssignmentListItem =
  components['schemas']['StudentAssignmentListItem']
export type PaginationMeta = components['schemas']['PaginationMeta']
type ListMeta = components['schemas']['EnvelopeMetaListPaginated']

const STALE_TIME_MS = 30 * 1000

export interface StudentAssignmentListResult {
  items: StudentAssignmentListItem[]
  pagination: PaginationMeta
  /** Server clock from the list envelope — the reference time for overdue (AC5). */
  serverTime: string
}

function buildQueryString(params: StudentAssignmentListParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('pageSize', String(params.pageSize))
  return search.toString()
}

/**
 * Fetch the caller's enrollment-scoped assignment list for one page.
 * @param params page + pageSize (page-based pagination per XL-2).
 * @returns TanStack Query result whose `data` is the unwrapped
 *   `{ items, pagination, serverTime }`.
 */
export function useStudentAssignments(params: StudentAssignmentListParams) {
  return useQuery({
    queryKey: assignmentKeys.list(params),
    queryFn: async (): Promise<StudentAssignmentListResult> => {
      const envelope = await apiFetchWithMeta<StudentAssignmentListItem[], ListMeta>(
        `/api/assignments?${buildQueryString(params)}`,
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
