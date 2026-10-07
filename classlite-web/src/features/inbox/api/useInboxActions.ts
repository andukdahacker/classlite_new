/**
 * useInboxActions — Story 10-1b (AC5 / AC6 / DD5). The three inbox mutations, each
 * an optimistic triple over BOTH the list page(s) AND the count key:
 *
 *   - markRead(id)    — flip the row's readAt, decrement the count (guarded).
 *   - archive(id)     — DEFERRED-commit with undo (see below).
 *   - markAllRead()   — flip every active row's readAt, count → 0.
 *
 * Pins harder than the single-key useRooms exemplar (Winston/Murat):
 *   (1) the optimistic count is floored at max(0, …) — it must NEVER render negative.
 *   (2) the decrement is guarded on the row's CURRENT readAt so a rapid double
 *       mark-read nets ONE decrement, not two.
 *   (3) rollback is SURGICAL — a failed/undone mutation reverts ONLY the row(s) it
 *       touched + exactly its own count delta (code-review 10-1b, RULED 1a). The
 *       earlier whole-cache snapshot/restore clobbered concurrent in-flight
 *       mutations: archive(n1) → archive(n2) → n1's commit fails → a blind
 *       restore(S1) resurrected the already-archived n2 until onSettled. A per-row
 *       delta restore can never touch a row another mutation owns.
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-fetch'

import { inboxKeys } from './inboxKeys'
import type { InboxListResult, Notification } from './useInbox'
import type { UnreadCount } from './useInboxCount'

/** The undo window before an archive is actually committed to the server. */
export const ARCHIVE_UNDO_WINDOW_MS = 6_000

/** A row removed from a specific list page, with its index for in-place re-insert. */
interface RemovedRow {
  key: QueryKey
  index: number
  row: Notification
}

/** The surgical rollback context for archive: the exact rows dropped + count delta. */
interface ArchiveContext {
  removed: RemovedRow[]
  /** True if the archived row was unread (so rollback re-increments the count by 1). */
  wasUnread: boolean
}

/** Apply `fn` to every cached inbox list page (all filter/page variations). */
function patchEveryList(
  queryClient: QueryClient,
  fn: (data: InboxListResult) => InboxListResult,
): void {
  for (const [key] of queryClient.getQueriesData<InboxListResult>({ queryKey: inboxKeys.lists() })) {
    queryClient.setQueryData<InboxListResult>(key, (data) => (data ? fn(data) : data))
  }
}

/** Adjust the cached count by `delta`, floored at 0 (DD5 point 1). */
function adjustCount(queryClient: QueryClient, delta: number): void {
  queryClient.setQueryData<UnreadCount>(inboxKeys.count(), (current) =>
    current ? { unread: Math.max(0, current.unread + delta) } : current,
  )
}

function zeroCount(queryClient: QueryClient): void {
  queryClient.setQueryData<UnreadCount>(inboxKeys.count(), (current) =>
    current ? { unread: 0 } : current,
  )
}

/** True if `id` is an unread row in any cached list page (the decrement guard). */
function isUnreadInCache(queryClient: QueryClient, id: string): boolean {
  return queryClient
    .getQueriesData<InboxListResult>({ queryKey: inboxKeys.lists() })
    .some(([, data]) => data?.items.some((n) => n.id === id && n.readAt == null))
}

/** A client-stamped optimistic readAt (replaced by onSettled refetch truth). */
function optimisticReadAt(): string {
  return new Date().toISOString()
}

/** Surgically set ONE row's readAt across every cached page (markRead optimism). */
function setRowRead(queryClient: QueryClient, id: string): void {
  patchEveryList(queryClient, (data) => ({
    ...data,
    items: data.items.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? optimisticReadAt() } : n)),
  }))
}

/** Surgically revert ONE row to unread across every cached page (markRead rollback). */
function setRowUnread(queryClient: QueryClient, id: string): void {
  patchEveryList(queryClient, (data) => ({
    ...data,
    items: data.items.map((n) => (n.id === id ? { ...n, readAt: null } : n)),
  }))
}

/** Capture + drop ONE row from every cached page, recording its index for re-insert. */
function removeRow(queryClient: QueryClient, id: string): RemovedRow[] {
  const removed: RemovedRow[] = []
  for (const [key, data] of queryClient.getQueriesData<InboxListResult>({ queryKey: inboxKeys.lists() })) {
    if (!data) continue
    const index = data.items.findIndex((n) => n.id === id)
    if (index === -1) continue
    removed.push({ key, index, row: data.items[index] })
    queryClient.setQueryData<InboxListResult>(key, {
      ...data,
      items: data.items.filter((n) => n.id !== id),
    })
  }
  return removed
}

/** Re-insert surgically-removed rows at their original index (archive rollback). */
function reinsertRows(queryClient: QueryClient, removed: RemovedRow[]): void {
  for (const { key, index, row } of removed) {
    queryClient.setQueryData<InboxListResult>(key, (data) => {
      if (!data || data.items.some((n) => n.id === row.id)) return data
      const items = [...data.items]
      items.splice(Math.min(index, items.length), 0, row)
      return { ...data, items }
    })
  }
}

function invalidateBoth(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
  void queryClient.invalidateQueries({ queryKey: inboxKeys.count() })
}

export interface InboxActions {
  /** Mark one row read (idempotent server-side; safe to double-fire). */
  markRead: (id: string, options?: { onError?: () => void; onSuccess?: () => void }) => void
  /** Archive one row with a deferred commit; returns an `undo` handle. */
  archive: (id: string) => { undo: () => void }
  /** Mark every active row read in one atomic server call. */
  markAllRead: () => void
  /** True while a mark-all-read request is in flight. */
  isMarkingAllRead: boolean
}

export function useInboxActions(): InboxActions {
  const queryClient = useQueryClient()

  const markReadMutation = useMutation<null, Error, string, { wasUnread: boolean }>({
    mutationFn: async (id) => {
      await apiFetch<unknown>(`/api/inbox/${id}/read`, { method: 'POST' })
      return null
    },
    // onMutate is SYNCHRONOUS (guard + patch before any await) so two concurrent
    // mark-read calls can't both read the stale unread state and double-decrement:
    // the second sees the first's optimistic readAt (DD5 pt 2). Rollback is surgical
    // — only this row's readAt + a +1 count, never a whole-cache snapshot (DD5 pt 3).
    onMutate: (id) => {
      void queryClient.cancelQueries({ queryKey: inboxKeys.all })
      const wasUnread = isUnreadInCache(queryClient, id)
      setRowRead(queryClient, id)
      if (wasUnread) adjustCount(queryClient, -1)
      return { wasUnread }
    },
    onError: (_err, id, ctx) => {
      if (!ctx?.wasUnread) return
      setRowUnread(queryClient, id)
      adjustCount(queryClient, +1)
    },
    onSettled: () => invalidateBoth(queryClient),
  })

  const markAllReadMutation = useMutation<null, Error, void, { readIds: string[]; prevUnread: number | undefined }>({
    mutationFn: async () => {
      await apiFetch<unknown>('/api/inbox/read-all', { method: 'POST' })
      return null
    },
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: inboxKeys.all })
      // Record exactly the rows this flips (unread → read) so a rollback reverts
      // ONLY those — never a row a concurrent archive removed meanwhile.
      const readIds: string[] = []
      for (const [, data] of queryClient.getQueriesData<InboxListResult>({ queryKey: inboxKeys.lists() })) {
        for (const n of data?.items ?? []) if (n.readAt == null) readIds.push(n.id)
      }
      const prevUnread = queryClient.getQueryData<UnreadCount>(inboxKeys.count())?.unread
      patchEveryList(queryClient, (data) => ({
        ...data,
        items: data.items.map((n) => ({ ...n, readAt: n.readAt ?? optimisticReadAt() })),
      }))
      zeroCount(queryClient)
      return { readIds, prevUnread }
    },
    onError: (_err, _void, ctx) => {
      if (!ctx) return
      for (const id of ctx.readIds) setRowUnread(queryClient, id)
      if (ctx.prevUnread !== undefined) {
        queryClient.setQueryData<UnreadCount>(inboxKeys.count(), { unread: ctx.prevUnread })
      }
    },
    onSettled: () => invalidateBoth(queryClient),
  })

  // The deferred-commit archive: the optimistic drop happens at `archive()` call
  // time (carrying its surgical ArchiveContext); the commit fires after the undo
  // window. onError re-inserts ONLY the dropped row(s) + a +1 count.
  const archiveCommit = useMutation<null, Error, { id: string; ctx: ArchiveContext }>({
    mutationFn: async ({ id }) => {
      await apiFetch<unknown>(`/api/inbox/${id}/archive`, { method: 'POST' })
      return null
    },
    onError: (_err, { ctx }) => {
      reinsertRows(queryClient, ctx.removed)
      if (ctx.wasUnread) adjustCount(queryClient, +1)
    },
    onSettled: () => invalidateBoth(queryClient),
  })

  // Pending archive commits keyed by row id. On unmount they are FLUSHED (committed
  // immediately), not dropped — clearing the timer would silently lose an
  // intentional archive when the user navigates away inside the window
  // (code-review 10-1b P5). `undo` still cancels before the flush.
  const pendingArchives = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>>(
    new Map(),
  )
  // Keep the latest mutation handle reachable from the deferred commit / unmount
  // flush WITHOUT reading a ref during render (react-hooks/refs) — sync it in an effect.
  const archiveCommitRef = useRef(archiveCommit)
  useEffect(() => {
    archiveCommitRef.current = archiveCommit
  })
  useEffect(() => {
    const pending = pendingArchives.current
    return () => {
      for (const { timer, commit } of pending.values()) {
        clearTimeout(timer)
        commit()
      }
      pending.clear()
    }
  }, [])

  const archive = useCallback(
    (id: string): { undo: () => void } => {
      void queryClient.cancelQueries({ queryKey: inboxKeys.all })
      const wasUnread = isUnreadInCache(queryClient, id)
      const removed = removeRow(queryClient, id)
      if (wasUnread) adjustCount(queryClient, -1)
      const ctx: ArchiveContext = { removed, wasUnread }

      const commit = (): void => {
        if (!pendingArchives.current.has(id)) return
        pendingArchives.current.delete(id)
        archiveCommitRef.current.mutate({ id, ctx })
      }
      const timer = setTimeout(commit, ARCHIVE_UNDO_WINDOW_MS)
      pendingArchives.current.set(id, { timer, commit })

      return {
        undo: () => {
          const pending = pendingArchives.current.get(id)
          if (!pending) return
          clearTimeout(pending.timer)
          pendingArchives.current.delete(id)
          reinsertRows(queryClient, removed)
          if (wasUnread) adjustCount(queryClient, +1)
        },
      }
    },
    [queryClient],
  )

  return {
    markRead: markReadMutation.mutate,
    archive,
    markAllRead: markAllReadMutation.mutate,
    isMarkingAllRead: markAllReadMutation.isPending,
  }
}
