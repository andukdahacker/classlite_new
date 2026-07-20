/**
 * useClass — Story 3.2 (AC2/AC4/AC6) single-class detail read.
 *
 * Reads GET /api/classes/{id} into `classesKeys.detail(id)` — the SAME cache
 * slot the Overview tab reuses (byte-identical key ⇒ one fetch, no refetch on
 * tab switch). The 3.1 backend returns 404 `CLASS_NOT_FOUND` both for an absent
 * class AND for a teacher targeting a class not assigned to them (teacher-scope,
 * 3.1 AC6) — the two are indistinguishable on the wire, which is exactly the
 * non-leak invariant the detail shell relies on (AC6).
 *
 * The `ApiError` is surfaced UNCHANGED (no ad-hoc flag) so `ClassDetailLayout`
 * can branch on `err instanceof ApiError && err.status === 404`. Read-only —
 * no optimistic anything.
 */
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { classesKeys } from './classesKeys'
import type { ClassWire } from './useClasses'

const STALE_TIME_MS = 60 * 1000

export function useClass(id: string | null | undefined) {
  return useQuery({
    queryKey: classesKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<ClassWire>(`/api/classes/${id}`),
    enabled: Boolean(id),
    staleTime: STALE_TIME_MS,
  })
}
