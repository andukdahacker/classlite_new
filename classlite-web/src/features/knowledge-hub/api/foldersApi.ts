/**
 * foldersApi — Knowledge Hub folder list + optimistic CRUD (Story 4.4b, AC1/AC2).
 *
 * The list query returns the center's flat folder set; the browser composes the
 * tree from `parentFolderId`. Every mutation follows the FW-2 optimistic triple
 * on that flat list (cancel + snapshot + patch → rollback on error → invalidate
 * on settle), matching the `makeContentHooks` shape from session-detail — but
 * written bespoke here because the Knowledge Hub URLs (`/folders`, `/folders/{id}`)
 * and the tri-state `parentFolderId` reparent don't fit that session-scoped
 * factory.
 *
 * A folder-move the server rejects as a cycle (422 FOLDER_CYCLE) or over-depth
 * (422 FOLDER_MAX_DEPTH) rolls back and surfaces a human message (AC2). A delete
 * cascades server-side (subtree soft-delete + freed quota), so the optimistic
 * paint removes the whole subtree and settle invalidates files + storage usage.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import i18n from '@/lib/i18n'
import { knowledgeHubKeys } from './knowledgeHubKeys'

export type FolderWire = components['schemas']['Folder']
export type CreateFolderBody = components['schemas']['CreateFolderRequest']
export type UpdateFolderBody = components['schemas']['UpdateFolderRequest']

const STALE_TIME_MS = 30 * 1000
const FOLDERS_PATH = '/api/knowledge-hub/folders'

/** Prefix marking a still-optimistic folder id the server has never seen. */
const OPTIMISTIC_ID_PREFIX = 'optimistic-'

/**
 * isOptimisticFolderId reports whether a folder id is a client-only placeholder
 * from an in-flight create. The browser disables open/rename/move/delete on such
 * rows until the create settles — acting on the fake id would 404 (AC2).
 */
export function isOptimisticFolderId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX)
}

/**
 * folderMutationErrorKey maps a folder mutation failure to its i18n copy. The
 * 422 cycle/depth rejection gets a specific human message (never the raw code);
 * everything else the generic save error.
 */
function folderMutationErrorKey(err: ApiError): string {
  if (err.status === 422) {
    if (err.code === 'FOLDER_CYCLE') return 'knowledgeHub.folder.errors.cycle'
    if (err.code === 'FOLDER_MAX_DEPTH') return 'knowledgeHub.folder.errors.maxDepth'
    return 'knowledgeHub.folder.errors.nameInvalid'
  }
  return 'knowledgeHub.folder.errors.saveFailed'
}

function notifyFolderError(err: ApiError): void {
  toast.error(i18n.t(folderMutationErrorKey(err)))
}

/** descendantIds returns `folderId` plus every folder nested beneath it. */
function descendantIds(folders: FolderWire[], folderId: string): Set<string> {
  const childrenByParent = new Map<string | null, FolderWire[]>()
  for (const folder of folders) {
    const list = childrenByParent.get(folder.parentFolderId) ?? []
    list.push(folder)
    childrenByParent.set(folder.parentFolderId, list)
  }
  const collected = new Set<string>([folderId])
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const child of childrenByParent.get(current) ?? []) {
      if (!collected.has(child.id)) {
        collected.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return collected
}

/** useFolders lists the center's folders (flat) for the browser tree. */
export function useFolders(centerId: string | null) {
  return useQuery<FolderWire[], ApiError>({
    queryKey: knowledgeHubKeys.folders(centerId ?? '__none__'),
    queryFn: () => apiFetch<FolderWire[]>(FOLDERS_PATH),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}

export function useCreateFolder(centerId: string) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.folders(centerId)
  return useMutation<FolderWire, ApiError, CreateFolderBody, { previous: FolderWire[] | undefined }>({
    mutationFn: (body) =>
      apiFetch<FolderWire>(FOLDERS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FolderWire[]>(key)
      const now = new Date().toISOString()
      const optimistic: FolderWire = {
        id: `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`,
        centerId,
        parentFolderId: body.parentFolderId ?? null,
        name: body.name,
        createdAt: now,
        updatedAt: now,
      }
      queryClient.setQueryData<FolderWire[]>(key, [...(previous ?? []), optimistic])
      return { previous }
    },
    onError: (err, _body, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFolderError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useUpdateFolder(centerId: string) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.folders(centerId)
  return useMutation<
    FolderWire,
    ApiError,
    { id: string; body: UpdateFolderBody },
    { previous: FolderWire[] | undefined }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<FolderWire>(`${FOLDERS_PATH}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FolderWire[]>(key)
      if (previous) {
        queryClient.setQueryData<FolderWire[]>(
          key,
          previous.map((folder) =>
            folder.id === id
              ? {
                  ...folder,
                  name: body.name ?? folder.name,
                  // Tri-state: key absent = unchanged; explicit null = root.
                  parentFolderId:
                    'parentFolderId' in body
                      ? (body.parentFolderId ?? null)
                      : folder.parentFolderId,
                  updatedAt: new Date().toISOString(),
                }
              : folder,
          ),
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFolderError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDeleteFolder(centerId: string) {
  const queryClient = useQueryClient()
  const key = knowledgeHubKeys.folders(centerId)
  return useMutation<void, ApiError, string, { previous: FolderWire[] | undefined }>({
    mutationFn: (id) =>
      apiFetch<void>(`${FOLDERS_PATH}/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FolderWire[]>(key)
      if (previous) {
        // Server cascade soft-deletes the whole subtree; mirror that optimistically.
        const removed = descendantIds(previous, id)
        queryClient.setQueryData<FolderWire[]>(
          key,
          previous.filter((folder) => !removed.has(folder.id)),
        )
      }
      return { previous }
    },
    onError: (err, _id, ctx) => {
      queryClient.setQueryData(key, ctx?.previous)
      notifyFolderError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
      // Cascade frees files + quota — refresh both surfaces.
      queryClient.invalidateQueries({ queryKey: knowledgeHubKeys.files() })
      queryClient.invalidateQueries({ queryKey: knowledgeHubKeys.storageUsage(centerId) })
    },
  })
}
