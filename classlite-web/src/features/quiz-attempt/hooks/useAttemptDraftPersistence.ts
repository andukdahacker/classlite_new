/**
 * useAttemptDraftPersistence — Story 5.2b Task 4 (AC22). Write-through mirror of
 * the answer draft to localStorage, so a reload/crash never loses work beyond
 * the last keystroke (the autosave alone leaves an up-to-30s window).
 *
 *  - WRITE-THROUGH: every draft change is mirrored to localStorage immediately.
 *  - RECOVER / RECONCILE: `reconcileStoredDraftIntoCache` runs once on load —
 *    it merges any mirror with the server's content (server wins on conflict,
 *    local-only answers recovered) and seeds the draft cache; the page shows a
 *    non-blocking toast when the server overrode a local edit.
 *  - CLEAR: the mirror is removed on successful submit (the page calls
 *    `clearStoredDraft`).
 */
import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { attemptKeys } from '../api/attemptKeys'
import {
  normalizeAttemptContent,
  type AttemptContent,
} from '../lib/attemptContent'
import {
  reconcileDrafts,
  readStoredDraft,
  writeStoredDraft,
  type ReconcileResult,
} from '../lib/attemptDraftStorage'

export interface UseAttemptDraftPersistenceOptions {
  submissionId: string
  /** The live draft content to mirror. */
  content: AttemptContent
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
export function useAttemptDraftPersistence({
  submissionId,
  content,
  enabled = true,
  onMirrorUnavailable,
}: UseAttemptDraftPersistenceOptions): void {
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
      queryClient.getQueryData<AttemptContent>(
        attemptKeys.draft(submissionId),
      ) === undefined
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
 * Load-time recovery + reconcile. Merges any localStorage mirror with the
 * server's `submission.content` (server wins on conflict, local-only answers
 * recovered) and seeds the draft cache with the merged result. Returns the
 * reconcile flags so the page can toast on conflict / recovery. Only seeds when
 * the cache slot is empty (never clobbers in-progress edits on a remount).
 */
export function reconcileStoredDraftIntoCache(
  queryClient: QueryClient,
  submissionId: string,
  serverContent: unknown,
): ReconcileResult {
  const key = attemptKeys.draft(submissionId)
  const existing = queryClient.getQueryData<AttemptContent>(key)
  // Already seeded (a remount) — never recompute/re-report a resolved
  // conflict/recovery, else the page re-fires the toast every remount.
  if (existing !== undefined) {
    return { merged: existing, hadConflict: false, recoveredLocalOnly: false }
  }

  const server = normalizeAttemptContent(serverContent)
  const local = readStoredDraft(submissionId)
  const result = reconcileDrafts(local, server)
  queryClient.setQueryData<AttemptContent>(key, result.merged)
  // Keep the mirror consistent with what we just seeded.
  writeStoredDraft(submissionId, result.merged)
  return result
}
