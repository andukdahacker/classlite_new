/**
 * Student reads — Story 7.2b (AC4/AC11/AC15). Component-level `useQuery` over
 * the 7-2a student surface (D2 — the app has ZERO loader-prefetch; this follows
 * the shipped `useStaff` convention, the consuming page owns the UX-1 trilogy).
 *
 * The roster is server-paginated, so it uses `apiFetchWithMeta` to keep
 * `meta.pagination` (the D6 pager + total superscript); detail and notes use
 * plain `apiFetch`, which unwraps to the INNER type (TS-4 — never `.data.data`).
 * All shapes are the generated wire types verbatim (D3 / TS-2 / XL-1).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, apiFetchWithMeta } from '@/lib/api-fetch'
import { peopleKeys, type StudentListParams } from './peopleKeys'

export type StudentListItem = components['schemas']['StudentListItem']
export type StudentDetail = components['schemas']['StudentDetail']
export type StudentProfile = components['schemas']['StudentProfile']
export type StudentDetailClass = components['schemas']['StudentDetailClass']
export type StudentPerSkill = components['schemas']['StudentPerSkill']
export type StudentPerformanceSummary =
  components['schemas']['StudentPerformanceSummary']
export type StudentAtRisk = components['schemas']['StudentAtRisk']
export type StudentEnrolledClassLite =
  components['schemas']['StudentEnrolledClassLite']
export type StudentNote = components['schemas']['StudentNote']
export type AtRiskStatus = components['schemas']['AtRiskStatus']
export type EnvelopeMetaPagination =
  components['schemas']['EnvelopeMetaPagination']
export type PaginationMeta = components['schemas']['PaginationMeta']

const STALE_TIME_MS = 60 * 1000

/**
 * The client requests the server max page size for the tab window (D6): the
 * roster is server-paginated but the All/At-risk/New/… tabs + counts are
 * client-derived, so they can only classify the loaded page. `total > 100`
 * surfaces the pager + a "counts reflect this page" note (AC10); accurate
 * cross-page tab counts are the deferred FU-7-2-C server work.
 */
export const ROSTER_PAGE_SIZE = 100

function rosterPath(params: StudentListParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('page_size', String(ROSTER_PAGE_SIZE))
  if (params.classId) search.set('class_id', params.classId)
  if (params.teacherId) search.set('teacher_id', params.teacherId)
  return `/api/students?${search.toString()}`
}

/** GET /api/students — role-scoped, paginated roster (members + meta). */
export function useStudentRoster(params: StudentListParams) {
  return useQuery({
    queryKey: peopleKeys.studentList(params),
    queryFn: () =>
      apiFetchWithMeta<StudentListItem[], EnvelopeMetaPagination>(
        rosterPath(params),
      ),
    staleTime: STALE_TIME_MS,
  })
}

/** GET /api/students/{id} — whole-student detail; disabled without an id. */
export function useStudentDetail(studentId: string | undefined) {
  return useQuery({
    queryKey: peopleKeys.studentDetail(studentId ?? '__none__'),
    queryFn: () => apiFetch<StudentDetail>(`/api/students/${studentId}`),
    enabled: Boolean(studentId),
    staleTime: STALE_TIME_MS,
  })
}

/**
 * GET /api/students/{id}/notes — chronological (ASC) teacher-note log.
 *
 * `initialNotes` seeds the cache when the panel is composed inside
 * `StudentDetailPage`: the whole-student detail already embeds `notes`, so
 * passing them as `initialData` (with `staleTime > 0`) means the panel renders
 * the log WITHOUT a redundant second round-trip. Mounted standalone (no
 * `initialNotes`), the panel fetches its own list.
 */
export function useStudentNotes(
  studentId: string | undefined,
  initialNotes?: StudentNote[],
) {
  return useQuery({
    queryKey: peopleKeys.studentNotes(studentId ?? '__none__'),
    queryFn: () =>
      apiFetch<StudentNote[]>(`/api/students/${studentId}/notes`),
    enabled: Boolean(studentId),
    staleTime: STALE_TIME_MS,
    initialData: initialNotes,
  })
}
