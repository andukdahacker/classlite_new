/**
 * useAttemptDraft — Story 5.2b Task 3 (AC10, Winston-S1 / D9). The answers +
 * flagged draft lives in the TanStack Query cache (`attemptKeys.draft`), NOT in
 * `useState`, so it survives remount / Suspense / an error-boundary reset and is
 * readable outside React (the autosave `getContent`, the localStorage mirror).
 *
 * The slice is a client-managed value: its `queryFn` only supplies the empty
 * seed, and every edit is a `setQueryData` full-replace of the one handle
 * (`withAnswer` / `withFlagToggled`). `seedAttemptDraft` primes it from the
 * server's `submission.content` on load without clobbering in-progress edits on
 * a remount.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { attemptKeys } from './attemptKeys'
import {
  emptyAttemptContent,
  normalizeAttemptContent,
  withAnswer,
  withFlagToggled,
  type AttemptContent,
} from '../lib/attemptContent'

export interface UseAttemptDraftResult {
  content: AttemptContent
  setAnswer: (handle: string, value: string) => void
  toggleFlag: (handle: string) => void
}

/**
 * Seed the draft slice from the server's `submission.content` exactly once —
 * only when the cache slot is empty, so a remount / re-render never discards
 * edits already in the cache.
 */
export function seedAttemptDraft(
  queryClient: QueryClient,
  submissionId: string,
  serverContent: unknown,
): void {
  const key = attemptKeys.draft(submissionId)
  if (queryClient.getQueryData<AttemptContent>(key) === undefined) {
    queryClient.setQueryData<AttemptContent>(
      key,
      normalizeAttemptContent(serverContent),
    )
  }
}

/** Read the draft slice + its full-replace mutators for one submission. */
export function useAttemptDraft(submissionId: string): UseAttemptDraftResult {
  const queryClient = useQueryClient()
  const key = attemptKeys.draft(submissionId)

  // Cache-as-store (D9): the draft is a client-managed value written only via
  // `setQueryData`. We subscribe to the query cache with `useSyncExternalStore`
  // (the `useRole` pattern) rather than `useQuery` — there is no queryFn to run
  // (nothing to fetch), and a stable snapshot ref keeps unrelated cache events
  // from re-rendering. Every edit is a full-replace of the one handle.
  const snapshotRef = useRef<AttemptContent>(emptyAttemptContent())
  const subscribe = useCallback(
    (notify: () => void) => queryClient.getQueryCache().subscribe(() => notify()),
    [queryClient],
  )
  const getSnapshot = useCallback((): AttemptContent => {
    const cached = queryClient.getQueryData<AttemptContent>(key)
    // Adopt the cached reference only when it exists AND actually changed. An
    // empty slot keeps returning the STABLE initial ref (never a fresh empty
    // object) so useSyncExternalStore doesn't loop on unrelated cache events.
    if (cached !== undefined && cached !== snapshotRef.current) {
      snapshotRef.current = cached
    }
    return snapshotRef.current
  }, [queryClient, key])
  const content = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setAnswer = useCallback(
    (handle: string, value: string) => {
      queryClient.setQueryData<AttemptContent>(key, (prev) =>
        withAnswer(normalizeAttemptContent(prev ?? emptyAttemptContent()), handle, value),
      )
    },
    [queryClient, key],
  )

  const toggleFlag = useCallback(
    (handle: string) => {
      queryClient.setQueryData<AttemptContent>(key, (prev) =>
        withFlagToggled(normalizeAttemptContent(prev ?? emptyAttemptContent()), handle),
      )
    },
    [queryClient, key],
  )

  return { content, setAnswer, toggleFlag }
}
