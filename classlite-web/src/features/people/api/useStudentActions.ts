/**
 * Teacher-note mutations — Story 7.2b (AC16-18). Thin wrappers over the STABLE
 * 7-2a notes endpoints (D13 — the notes mutation contract is not co-finalized;
 * only the read shapes are). Each is `useMutation<TData, ApiError, TInput>`.
 *
 * Cache strategy (deliberate, not the plain invalidate the staff actions use):
 * the note LIST cache is updated DIRECTLY from each mutation's response
 * (`setQueryData`) rather than invalidated. Create appends the returned note,
 * flag replaces it, delete removes it optimistically with rollback. This keeps
 * a single authoritative log without a redundant refetch — and is the only
 * shape that reconciles with a static GET (an invalidate would refetch the
 * unchanged list and drop the just-applied mutation). The whole-student
 * `studentDetail` (which embeds `notes`) IS invalidated so its copy re-derives
 * on the next read. Note: `StudentDetailPage` DOES mount the panel alongside an
 * active `studentDetail` query, so this invalidation triggers one detail refetch
 * per note mutation while the page is open — an accepted redundancy that keeps
 * the embedded `notes` (and any other detail consumer) consistent; the panel's
 * own log stays authoritative via the `setQueryData` above, never racing it.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { peopleKeys } from './peopleKeys'
import type { StudentNote } from './useStudents'

export type CreateStudentNoteRequest =
  components['schemas']['CreateStudentNoteRequest']
export type SetStudentNoteFlagRequest =
  components['schemas']['SetStudentNoteFlagRequest']

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

function invalidateDetail(queryClient: QueryClient, studentId: string): void {
  // The whole-student detail embeds `notes`; re-read it on next mount.
  queryClient.invalidateQueries({
    queryKey: peopleKeys.studentDetail(studentId),
  })
}

/** POST /api/students/{id}/notes — create a note (content + flag), 201. */
export function useCreateStudentNote(studentId: string) {
  const queryClient = useQueryClient()
  return useMutation<StudentNote, ApiError, CreateStudentNoteRequest>({
    mutationKey: peopleKeys.createNoteMutation(),
    mutationFn: (body) =>
      apiFetch<StudentNote>(`/api/students/${studentId}/notes`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<StudentNote[]>(
        peopleKeys.studentNotes(studentId),
        (prev) => [...(prev ?? []), created],
      )
      invalidateDetail(queryClient, studentId)
    },
  })
}

/** PATCH /api/students/{id}/notes/{noteId} — toggle the flag; body always carries `flagged`. */
export function useSetStudentNoteFlag(studentId: string) {
  const queryClient = useQueryClient()
  return useMutation<StudentNote, ApiError, { noteId: string; flagged: boolean }>({
    mutationKey: peopleKeys.flagNoteMutation(),
    mutationFn: ({ noteId, flagged }) =>
      apiFetch<StudentNote>(
        `/api/students/${studentId}/notes/${noteId}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ flagged } satisfies SetStudentNoteFlagRequest),
        },
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<StudentNote[]>(
        peopleKeys.studentNotes(studentId),
        (prev) =>
          prev?.map((note) =>
            note.noteId === updated.noteId ? updated : note,
          ) ?? [],
      )
      invalidateDetail(queryClient, studentId)
    },
  })
}

/**
 * DELETE /api/students/{id}/notes/{noteId} — 204. Optimistically removes the
 * note (FW-2 triple: cancel → snapshot → remove → rollback onError). A
 * non-author teacher gets 403 FORBIDDEN (the control is hidden for them; this
 * rollback + the caller's toast are defense-in-depth, D11).
 */
export function useDeleteStudentNote(studentId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    void,
    ApiError,
    { noteId: string },
    { previous: StudentNote[] | undefined }
  >({
    mutationKey: peopleKeys.deleteNoteMutation(),
    mutationFn: ({ noteId }) =>
      apiFetch<void>(`/api/students/${studentId}/notes/${noteId}`, {
        method: 'DELETE',
      }),
    onMutate: async ({ noteId }) => {
      const key = peopleKeys.studentNotes(studentId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<StudentNote[]>(key)
      queryClient.setQueryData<StudentNote[]>(
        key,
        (prev) => prev?.filter((note) => note.noteId !== noteId) ?? [],
      )
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          peopleKeys.studentNotes(studentId),
          context.previous,
        )
      }
    },
    onSuccess: () => invalidateDetail(queryClient, studentId),
  })
}
