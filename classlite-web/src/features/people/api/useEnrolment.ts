/**
 * Enrolment console reads — Story 7.3b (AC8/AC11). Component-level `useQuery`
 * over the STABLE 7-3a enrollment surface (D2 — the app has ZERO
 * loader-prefetch; this follows the shipped `useStudents`/`useStaff`
 * convention, the consuming component owns the UX-1 trilogy).
 *
 * History is server-paginated → `apiFetchWithMeta` keeps `meta.pagination`
 * (the D12 pager). Needs-attention paginates PER-ZONE, nested inside `data`
 * (D3/D11), so plain `apiFetch` unwraps the envelope to the inner object with
 * both zones' items + pagination (TS-4 — never `.data.data`). All shapes are
 * the generated 7-3a wire types verbatim (D3 / TS-2 / XL-1).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, apiFetchWithMeta } from '@/lib/api-fetch'
import {
  peopleKeys,
  type EnrolmentHistoryParams,
  type NeedsAttentionParams,
} from './peopleKeys'

export type EnrollmentHistoryEntry =
  components['schemas']['EnrollmentHistoryEntry']
export type NeedsAttention = components['schemas']['NeedsAttention']
export type EnrollmentAttentionStudent =
  components['schemas']['EnrollmentAttentionStudent']
export type EnrollmentOverCapacityClass =
  components['schemas']['EnrollmentOverCapacityClass']
export type EnvelopeMetaPagination =
  components['schemas']['EnvelopeMetaPagination']
export type PaginationMeta = components['schemas']['PaginationMeta']

const STALE_TIME_MS = 60 * 1000

/** Server-default history page size (D12). */
export const HISTORY_PAGE_SIZE = 20
/** Per-zone needs-attention page size (D11). */
export const ATTENTION_PAGE_SIZE = 20

function historyPath(params: EnrolmentHistoryParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('page_size', String(HISTORY_PAGE_SIZE))
  if (params.studentId) search.set('student_id', params.studentId)
  if (params.classId) search.set('class_id', params.classId)
  return `/api/enrollments/history?${search.toString()}`
}

function attentionPath(params: NeedsAttentionParams): string {
  const search = new URLSearchParams()
  search.set('unassigned_page', String(params.unassignedPage))
  search.set('unassigned_page_size', String(ATTENTION_PAGE_SIZE))
  search.set('over_capacity_page', String(params.overCapacityPage))
  search.set('over_capacity_page_size', String(ATTENTION_PAGE_SIZE))
  return `/api/enrollments/attention?${search.toString()}`
}

/** GET /api/enrollments/history — immutable, denormalized, newest-first. */
export function useEnrolmentHistory(params: EnrolmentHistoryParams) {
  return useQuery({
    queryKey: peopleKeys.enrolmentHistory(params),
    queryFn: () =>
      apiFetchWithMeta<EnrollmentHistoryEntry[], EnvelopeMetaPagination>(
        historyPath(params),
      ),
    staleTime: STALE_TIME_MS,
    // Keep the prior page/filter results on screen while the next query loads
    // (P1 code-review) — no full-section skeleton flash on paging/filtering.
    placeholderData: keepPreviousData,
  })
}

/** GET /api/enrollments/attention — two zones, each paginated in `data`. */
export function useNeedsAttention(params: NeedsAttentionParams) {
  return useQuery({
    queryKey: peopleKeys.needsAttention(params),
    queryFn: () => apiFetch<NeedsAttention>(attentionPath(params)),
    staleTime: STALE_TIME_MS,
  })
}
