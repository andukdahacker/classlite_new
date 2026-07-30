/**
 * filesApi — Knowledge Hub per-folder file list + optimistic rename/move/delete
 * (Story 4.4b, AC1/AC2). Same FW-2 optimistic triple as `foldersApi`, scoped to
 * one folder's file list (root = `folderId: null`).
 *
 * File CREATION is NOT here — a file is born from the upload chain
 * (presign → PUT → confirm) in `uploadKnowledgeFile`, after which the page
 * invalidates the folder's list + storage usage. Delete is soft (the row + R2
 * object are retained server-side) but frees storage accounting, so a delete
 * invalidates the storage meter.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import i18n from '@/lib/i18n'
import { knowledgeHubKeys } from './knowledgeHubKeys'

export type FileWire = components['schemas']['File']
export type UpdateFileBody = components['schemas']['UpdateFileRequest']

const STALE_TIME_MS = 30 * 1000
const FILES_PATH = '/api/knowledge-hub/files'

function fileMutationErrorKey(err: ApiError): string {
  if (err.status === 422) return 'knowledgeHub.file.errors.nameInvalid'
  if (err.status === 404) return 'knowledgeHub.file.errors.notFound'
  return 'knowledgeHub.file.errors.saveFailed'
}

function notifyFileError(err: ApiError): void {
  toast.error(i18n.t(fileMutationErrorKey(err)))
}

function listPath(folderId: string | null): string {
  return folderId ? `${FILES_PATH}?folderId=${encodeURIComponent(folderId)}` : FILES_PATH
}

/** useFiles lists the (non-deleted) files in a folder (or root when null). */
export function useFiles(centerId: string | null, folderId: string | null) {
  return useQuery<FileWire[], ApiError>({
    queryKey: knowledgeHubKeys.fileList(centerId ?? '__none__', folderId),
    queryFn: () => apiFetch<FileWire[]>(listPath(folderId)),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}

export function useRenameFile(centerId: string, folderId: string | null) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.fileList(centerId, folderId)
  return useMutation<
    FileWire,
    ApiError,
    { id: string; name: string },
    { previous: FileWire[] | undefined }
  >({
    mutationFn: ({ id, name }) =>
      apiFetch<FileWire>(`${FILES_PATH}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name } satisfies UpdateFileBody),
      }),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FileWire[]>(key)
      if (previous) {
        queryClient.setQueryData<FileWire[]>(
          key,
          previous.map((file) =>
            file.id === id ? { ...file, name, updatedAt: new Date().toISOString() } : file,
          ),
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFileError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useMoveFile(centerId: string, folderId: string | null) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.fileList(centerId, folderId)
  return useMutation<
    FileWire,
    ApiError,
    { id: string; targetFolderId: string | null },
    { previous: FileWire[] | undefined }
  >({
    mutationFn: ({ id, targetFolderId }) =>
      apiFetch<FileWire>(`${FILES_PATH}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: targetFolderId } satisfies UpdateFileBody),
      }),
    onMutate: async ({ id, targetFolderId }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FileWire[]>(key)
      // A move out of the current folder removes the tile from this list.
      if (previous && targetFolderId !== folderId) {
        queryClient.setQueryData<FileWire[]>(
          key,
          previous.filter((file) => file.id !== id),
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFileError(err)
    },
    onSettled: (_data, _err, { targetFolderId }) => {
      queryClient.invalidateQueries({ queryKey: key })
      // Destination list also changed.
      queryClient.invalidateQueries({
        queryKey: knowledgeHubKeys.fileList(centerId, targetFolderId),
      })
    },
  })
}

export function useDeleteFile(centerId: string, folderId: string | null) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.fileList(centerId, folderId)
  return useMutation<void, ApiError, string, { previous: FileWire[] | undefined }>({
    mutationFn: (id) => apiFetch<void>(`${FILES_PATH}/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FileWire[]>(key)
      if (previous) {
        queryClient.setQueryData<FileWire[]>(
          key,
          previous.filter((file) => file.id !== id),
        )
      }
      return { previous }
    },
    onError: (err, _id, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFileError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
      // Soft-delete frees storage accounting.
      queryClient.invalidateQueries({ queryKey: knowledgeHubKeys.storageUsage(centerId) })
    },
  })
}
