/**
 * sessionContentApi — Story 3.5 (AC3–AC5). List + optimistic CRUD hooks for a
 * session's notes, materials, and exercises. All three follow the same shape,
 * so a single generic factory produces them: a list query plus create/update/
 * delete mutations, each carrying the FW-2 optimistic triple on the LIST cache
 * (cancel + snapshot + patch → rollback on error → invalidate on settle).
 *
 * Envelope is unwrapped by apiFetch (TS-4); dates stay ISO on the wire (TS-6);
 * query keys hang off sessionsKeys.{notes,materials,exercises}(id) (TS-3).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sessionsKeys } from '@/features/schedule'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import i18n from '@/lib/i18n'

/**
 * notifyMutationError surfaces a failed create/update to the user. Without it a
 * failed optimistic write silently rolls back and the row just vanishes (UX-1 /
 * AC8). 422 gets a validation-specific message; everything else the generic
 * save error. Delete has its own copy (see the row components). Mirrors the
 * SessionModal err.code/status mapping convention.
 */
function notifyMutationError(err: ApiError): void {
  const key = err.status === 422 ? 'session.detail.content.saveErrorValidation' : 'session.detail.content.saveError'
  toast.error(i18n.t(key))
}

export type SessionNoteWire = components['schemas']['SessionNote']
export type SessionMaterialWire = components['schemas']['SessionMaterial']
export type SessionExerciseWire = components['schemas']['SessionExercise']

export type CreateNoteBody = components['schemas']['CreateSessionNoteRequest']
export type UpdateNoteBody = components['schemas']['UpdateSessionNoteRequest']
export type CreateMaterialBody = components['schemas']['CreateSessionMaterialRequest']
export type UpdateMaterialBody = components['schemas']['UpdateSessionMaterialRequest']
export type CreateExerciseBody = components['schemas']['CreateSessionExerciseRequest']
export type UpdateExerciseBody = components['schemas']['UpdateSessionExerciseRequest']

const STALE_TIME_MS = 30 * 1000

interface Identified {
  id: string
}

interface ResourceConfig<TWire extends Identified, TCreate, TUpdate> {
  /** URL segment: 'notes' | 'materials' | 'exercises'. */
  segment: string
  /** The TS-3 list key for this resource under a session. */
  listKey: (sessionId: string) => readonly unknown[]
  /** Build the optimistic row appended on create. */
  optimisticCreate: (sessionId: string, tempId: string, body: TCreate) => TWire
  /** Merge an update payload into an existing row for the optimistic paint. */
  applyUpdate: (row: TWire, body: TUpdate) => TWire
}

// Return types are inferred (not annotated) so consumers get the precise
// UseQueryResult<TWire[], ApiError> / UseMutationResult shapes — an explicit
// ReturnType<typeof useQuery<…>> annotation would widen `data` back to any.
function makeContentHooks<TWire extends Identified, TCreate, TUpdate>(
  config: ResourceConfig<TWire, TCreate, TUpdate>,
) {
  const basePath = (sessionId: string) => `/api/sessions/${sessionId}/${config.segment}`

  function useList(sessionId: string) {
    return useQuery<TWire[], ApiError>({
      queryKey: config.listKey(sessionId),
      queryFn: () => apiFetch<TWire[]>(basePath(sessionId)),
      enabled: Boolean(sessionId),
      staleTime: STALE_TIME_MS,
    })
  }

  function useCreate(sessionId: string) {
    const queryClient = useQueryClient()
    const key = config.listKey(sessionId)
    return useMutation<TWire, ApiError, TCreate, { previous: TWire[] | undefined }>({
      mutationFn: (body) =>
        apiFetch<TWire>(basePath(sessionId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      onMutate: async (body) => {
        await queryClient.cancelQueries({ queryKey: key })
        const previous = queryClient.getQueryData<TWire[]>(key)
        const optimistic = config.optimisticCreate(sessionId, `optimistic-${crypto.randomUUID()}`, body)
        queryClient.setQueryData<TWire[]>(key, [...(previous ?? []), optimistic])
        return { previous }
      },
      onError: (err, _body, ctx) => {
        queryClient.setQueryData(key, ctx?.previous)
        notifyMutationError(err)
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: key })
      },
    })
  }

  function useUpdate(sessionId: string) {
    const queryClient = useQueryClient()
    const key = config.listKey(sessionId)
    return useMutation<
      TWire,
      ApiError,
      { id: string; body: TUpdate },
      { previous: TWire[] | undefined }
    >({
      mutationFn: ({ id, body }) =>
        apiFetch<TWire>(`${basePath(sessionId)}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      onMutate: async ({ id, body }) => {
        await queryClient.cancelQueries({ queryKey: key })
        const previous = queryClient.getQueryData<TWire[]>(key)
        if (previous) {
          queryClient.setQueryData<TWire[]>(
            key,
            previous.map((row) => (row.id === id ? config.applyUpdate(row, body) : row)),
          )
        }
        return { previous }
      },
      onError: (err, _vars, ctx) => {
        queryClient.setQueryData(key, ctx?.previous)
        notifyMutationError(err)
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: key })
      },
    })
  }

  function useRemove(sessionId: string) {
    const queryClient = useQueryClient()
    const key = config.listKey(sessionId)
    return useMutation<void, ApiError, string, { previous: TWire[] | undefined }>({
      mutationFn: (id) =>
        apiFetch<void>(`${basePath(sessionId)}/${id}`, { method: 'DELETE' }),
      onMutate: async (id) => {
        await queryClient.cancelQueries({ queryKey: key })
        const previous = queryClient.getQueryData<TWire[]>(key)
        if (previous) {
          queryClient.setQueryData<TWire[]>(
            key,
            previous.filter((row) => row.id !== id),
          )
        }
        return { previous }
      },
      onError: (_err, _id, ctx) => {
        queryClient.setQueryData(key, ctx?.previous)
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: key })
      },
    })
  }

  return { useList, useCreate, useUpdate, useRemove }
}

const notesHooks = makeContentHooks<SessionNoteWire, CreateNoteBody, UpdateNoteBody>({
  segment: 'notes',
  listKey: sessionsKeys.notes,
  optimisticCreate: (sessionId, tempId, body) => ({
    id: tempId,
    centerId: '',
    sessionId,
    body: body.body,
    authorId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  applyUpdate: (row, body) => ({ ...row, body: body.body }),
})

const materialsHooks = makeContentHooks<
  SessionMaterialWire,
  CreateMaterialBody,
  UpdateMaterialBody
>({
  segment: 'materials',
  listKey: sessionsKeys.materials,
  optimisticCreate: (sessionId, tempId, body) => ({
    id: tempId,
    centerId: '',
    sessionId,
    title: body.title,
    url: body.url,
    kind: 'link',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  applyUpdate: (row, body) => ({ ...row, title: body.title, url: body.url }),
})

const exercisesHooks = makeContentHooks<
  SessionExerciseWire,
  CreateExerciseBody,
  UpdateExerciseBody
>({
  segment: 'exercises',
  listKey: sessionsKeys.exercises,
  optimisticCreate: (sessionId, tempId, body) => ({
    id: tempId,
    centerId: '',
    sessionId,
    title: body.title,
    instructions: body.instructions ?? null,
    link: body.link ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  applyUpdate: (row, body) => ({
    ...row,
    title: body.title,
    instructions: body.instructions ?? null,
    link: body.link ?? null,
  }),
})

export const useSessionNotes = notesHooks.useList
export const useCreateNote = notesHooks.useCreate
export const useUpdateNote = notesHooks.useUpdate
export const useDeleteNote = notesHooks.useRemove

export const useSessionMaterials = materialsHooks.useList
export const useCreateMaterial = materialsHooks.useCreate
export const useUpdateMaterial = materialsHooks.useUpdate
export const useDeleteMaterial = materialsHooks.useRemove

export const useSessionExercises = exercisesHooks.useList
export const useCreateExercise = exercisesHooks.useCreate
export const useUpdateExercise = exercisesHooks.useUpdate
export const useDeleteExercise = exercisesHooks.useRemove
