/**
 * useStudentPerformance — the ONE aggregate fetch for the teacher/owner/admin
 * student-performance detail (Story 8-3b, Task 1, AC1/AC3). One
 * `GET /api/analytics/students/{id}` returns the whole view (submission stats +
 * per-skill band progression + skill breakdown + mistakes), so a 500 blanks the
 * view (single inline error + retry) — there is no partial-failure surface
 * (AC24). Mirrors `useClassPerformance`: `apiFetchWithMeta`, FW-3 default
 * staleTime, full envelope as query data.
 *
 * The endpoint is role/tenant/privacy-scoped server-side: a teacher out of scope
 * gets 404 STUDENT_NOT_FOUND (non-disclosure, D4/D5), a student gets 403 — the
 * view renders an inline not-found / permission state, never a raw error (AC3).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta, type EnvelopeWithMeta } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { analyticsKeys } from './analyticsKeys'

export type StudentPerformance = components['schemas']['StudentPerformance']
export type EnvelopeMeta = components['schemas']['EnvelopeMeta']
export type StudentPerformanceEnvelope = EnvelopeWithMeta<
  StudentPerformance,
  EnvelopeMeta
>

/** The single aggregate student-performance read for one student id (teacher view). */
export function useStudentPerformance(id: string) {
  return useQuery({
    queryKey: analyticsKeys.student(id),
    queryFn: () =>
      apiFetchWithMeta<StudentPerformance, EnvelopeMeta>(
        `/api/analytics/students/${id}`,
      ),
    staleTime: DEFAULT_STALE_TIME_MS,
  })
}
