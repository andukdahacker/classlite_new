/**
 * attendanceApi — Story 3.5b (AC12–AC14). The per-session attendance roster
 * read + the single-set and bulk-mark mutations.
 *
 * - `useSessionAttendance(sessionId)` — the roster query (unwraps `{roster}` to
 *   an entry array; apiFetch already unwrapped the `{data,meta}` envelope, TS-4).
 * - `useSetAttendance(sessionId)` — one student's status via PUT, optimistic on
 *   the roster cache: cancel → snapshot → patch → rollback on error, then a
 *   WRITE-THROUGH onSuccess (the PUT returns the authoritative entry, so we patch
 *   it in rather than invalidate — a refetch would only re-read the same state).
 *   Write-once-editable: the caller only ever moves a student between
 *   present/late/absent (D11).
 * - `useBulkAttendance(sessionId)` — "Mark all" via POST; same optimistic-then-
 *   write-through shape (onSuccess sets the full refreshed roster the POST
 *   returns). The UNDO toast (D12) + the single failure banner (D13) are
 *   orchestrated by AttendanceSection, which snapshots the roster before calling
 *   this.
 *
 * Keys hang off sessionsKeys.attendance(id) (TS-3); dates stay ISO on the wire
 * (TS-6). No new-Date() in render paths — the optimistic markedAt stamp is a
 * cache write, not a render.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionsKeys } from '@/features/schedule'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'

export type AttendanceEntryWire = components['schemas']['AttendanceRosterEntry']
export type AttendanceStatusWire = components['schemas']['AttendanceStatus']
type AttendanceRosterWire = components['schemas']['AttendanceRoster']

const STALE_TIME_MS = 30 * 1000

function basePath(sessionId: string): string {
  return `/api/sessions/${sessionId}/attendance`
}

/** The per-session roster: one entry per active enrollment, status null when unmarked. */
export function useSessionAttendance(sessionId: string) {
  return useQuery<AttendanceEntryWire[], ApiError>({
    queryKey: sessionsKeys.attendance(sessionId),
    queryFn: () => apiFetch<AttendanceRosterWire>(basePath(sessionId)).then((r) => r.roster),
    enabled: Boolean(sessionId),
    staleTime: STALE_TIME_MS,
    // No auto-retry: the section surfaces a manual retry button, so a transient
    // failure should show the error state immediately rather than stall behind a
    // silent retry.
    retry: false,
  })
}

interface SetVars {
  studentId: string
  status: AttendanceStatusWire
}

/** Record one student's attendance with the FW-2 optimistic triple. */
export function useSetAttendance(sessionId: string) {
  const queryClient = useQueryClient()
  const key = sessionsKeys.attendance(sessionId)
  return useMutation<AttendanceEntryWire, ApiError, SetVars, { previous: AttendanceEntryWire[] | undefined }>({
    mutationFn: ({ studentId, status }) =>
      apiFetch<AttendanceEntryWire>(`${basePath(sessionId)}/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onMutate: async ({ studentId, status }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<AttendanceEntryWire[]>(key)
      if (previous) {
        queryClient.setQueryData<AttendanceEntryWire[]>(
          key,
          previous.map((row) =>
            row.studentId === studentId
              ? { ...row, status, markedAt: new Date().toISOString() }
              : row,
          ),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
    },
    // Write-through: the PUT returns the authoritative updated entry, so we patch
    // it straight into the roster cache instead of invalidating (a refetch would
    // just re-read the same server state — the response IS the fresh state).
    onSuccess: (updated) => {
      queryClient.setQueryData<AttendanceEntryWire[]>(key, (rows) =>
        rows?.map((row) => (row.studentId === updated.studentId ? updated : row)),
      )
    },
  })
}

interface BulkVars {
  status: AttendanceStatusWire
  /** Forward-compat only (D12) — the FE never sends this in v1. */
  studentIds?: string[]
}

/** Mark all (or a targeted set of) students to one status, optimistically. */
export function useBulkAttendance(sessionId: string) {
  const queryClient = useQueryClient()
  const key = sessionsKeys.attendance(sessionId)
  return useMutation<AttendanceEntryWire[], ApiError, BulkVars, { previous: AttendanceEntryWire[] | undefined }>({
    mutationFn: ({ status, studentIds }) =>
      apiFetch<AttendanceRosterWire>(`${basePath(sessionId)}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, studentIds: studentIds ?? null }),
      }).then((r) => r.roster),
    onMutate: async ({ status, studentIds }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<AttendanceEntryWire[]>(key)
      if (previous) {
        const targeted = studentIds && studentIds.length > 0 ? new Set(studentIds) : null
        const stampedAt = new Date().toISOString()
        queryClient.setQueryData<AttendanceEntryWire[]>(
          key,
          previous.map((row) =>
            !targeted || targeted.has(row.studentId)
              ? { ...row, status, markedAt: stampedAt }
              : row,
          ),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
    },
    // Write-through: the bulk POST returns the full refreshed roster (server
    // truth), so we set it directly rather than invalidate.
    onSuccess: (roster) => {
      queryClient.setQueryData<AttendanceEntryWire[]>(key, roster)
    },
  })
}
