/**
 * useAttemptDraftPersistence — Story 5.2b Task 4 (AC22), generalized and moved to
 * the shared `attempts` module in Story 5.2d (AC4). Write-through mirror of the
 * draft to localStorage, so a reload/crash never loses work beyond the last
 * keystroke (the autosave alone leaves an up-to-30s window).
 *
 *  - WRITE-THROUGH: every draft change is mirrored to localStorage immediately.
 *  - RECOVER / RECONCILE: `reconcileStoredDraftIntoCache` runs once on load — it
 *    merges any mirror with the server's content (via the INJECTED merge) and
 *    seeds the draft cache; the page acts on the merge-defined conflict signal.
 *  - CLEAR: the mirror is removed on successful submit (the page calls
 *    `clearStoredDraft`).
 *
 * Content-generic (5.2d AC4): the hook is generic over `T`; the reconcile takes
 * an injected `normalize` + `merge` + a `noConflict` sentinel (the conflict
 * signal to report when no reconcile ran, i.e. an already-seeded remount). The
 * 5.2b CRITICAL #2 seed-before-write ordering guard and the once-guarded
 * reconcile-into-cache are preserved unchanged, content-agnostic.
 */
import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { attemptKeys } from '../api/attemptKeys'
import {
  reconcileDrafts,
  readStoredDraft,
  writeStoredDraft,
  type DraftMerge,
  type ReconcileResult,
} from '../lib/attemptDraftStorage'

export interface UseAttemptDraftPersistenceOptions<T> {
  submissionId: string
  /** The live draft content to mirror. */
  content: T
  /** Off for read-only attempts (no edits to mirror). */
  enabled?: boolean
  /**
   * Called ONCE if the localStorage mirror can't be written (quota / disabled /
   * privacy mode) — the AC22 local safety-net is off; the caller warns the
   * student they rely on the ≤30s server autosave.
   */
  onMirrorUnavailable?: () => void
}

/** Mirror the live draft to localStorage on every change (AC22 write-through). */
export function useAttemptDraftPersistence<T>({
  submissionId,
  content,
  enabled = true,
  onMirrorUnavailable,
}: UseAttemptDraftPersistenceOptions<T>): void {
  const queryClient = useQueryClient()
  const warnedRef = useRef(false)
  const onUnavailableRef = useRef(onMirrorUnavailable)
  useEffect(() => {
    onUnavailableRef.current = onMirrorUnavailable
  })

  useEffect(() => {
    if (!enabled) return
    // Do NOT write until the draft cache has been seeded by
    // `reconcileStoredDraftIntoCache`. This hook is a child-component effect and
    // runs BEFORE the page's reconcile effect (child effects fire first); before
    // the seed `content` is the empty draft, so writing it here would clobber the
    // crash-recovery mirror before recovery reads it (AC22). An unseeded slot is
    // `undefined`; a genuinely-empty seeded draft is a defined object, so
    // write-through resumes correctly once reconcile has run.
    if (
      queryClient.getQueryData(attemptKeys.draft(submissionId)) === undefined
    ) {
      return
    }
    const written = writeStoredDraft(submissionId, content)
    if (!written && !warnedRef.current) {
      warnedRef.current = true
      onUnavailableRef.current?.()
    }
  }, [submissionId, content, enabled, queryClient])
}

/**
 * Injected content policy for a load-time reconcile (5.2d AC4). The consumer
 * supplies how an untrusted blob normalizes into `T`, how a local mirror merges
 * with the server value, and the conflict signal `C` to report when no reconcile
 * ran (an already-seeded remount).
 */
export interface ReconcileConfig<T, C> {
  normalize: (raw: unknown) => T
  merge: DraftMerge<T, C>
  /** The conflict signal reported when the slot was already seeded (no reconcile). */
  noConflict: C
}

/**
 * Load-time recovery + reconcile. Merges any localStorage mirror with the
 * server's `submission.content` (via the injected merge) and seeds the draft
 * cache with the merged result. Returns the merge-defined result so the page can
 * act (toast) on conflict / recovery. Only seeds when the cache slot is empty
 * (never clobbers in-progress edits on a remount).
 */
export function reconcileStoredDraftIntoCache<T, C>(
  queryClient: QueryClient,
  submissionId: string,
  serverContent: unknown,
  config: ReconcileConfig<T, C>,
): ReconcileResult<T, C> {
  const key = attemptKeys.draft(submissionId)
  const existing = queryClient.getQueryData<T>(key)
  // Already seeded (a remount) — never recompute/re-report a resolved
  // conflict/recovery, else the page re-fires the toast every remount.
  if (existing !== undefined) {
    return { merged: existing, conflict: config.noConflict }
  }

  const server = config.normalize(serverContent)
  const local = readStoredDraft<T>(submissionId, config.normalize)
  const result = reconcileDrafts(local, server, config.merge)
  queryClient.setQueryData<T>(key, result.merged)
  // Keep the mirror consistent with what we just seeded.
  writeStoredDraft(submissionId, result.merged)
  return result
}
