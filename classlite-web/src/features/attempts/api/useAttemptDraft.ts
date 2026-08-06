/**
 * useAttemptDraft — Story 5.2b Task 3 (AC10, Winston-S1 / D9), generalized and
 * moved to the shared `attempts` module in Story 5.2d (AC2). The draft lives in
 * the TanStack Query cache (`attemptKeys.draft`), NOT in `useState`, so it
 * survives remount / Suspense / an error-boundary reset and is readable outside
 * React (the autosave `getContent`, the localStorage mirror).
 *
 * Content-generic: the slice is a client-managed value of shape `T`; every edit
 * is a `setQueryData` full-replace via `setContent(updater)`. The consumer builds
 * its shape-specific mutators on top (quiz: `setAnswer`/`toggleFlag` in
 * `useQuizDraft`; writing: `setText`). `seedAttemptDraft` primes it from the
 * server content on load without clobbering in-progress edits on a remount.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { attemptKeys } from './attemptKeys'

export interface UseAttemptDraftResult<T> {
  content: T
  /** Full-replace the draft slice: `updater` receives the current (or empty) value. */
  setContent: (updater: (prev: T) => T) => void
}

/**
 * Seed the draft slice exactly once — only when the cache slot is empty, so a
 * remount / re-render never discards edits already in the cache. The caller
 * passes an already-shaped value (it owns the normalization).
 */
export function seedAttemptDraft<T>(
  queryClient: QueryClient,
  submissionId: string,
  value: T,
): void {
  const key = attemptKeys.draft(submissionId)
  if (queryClient.getQueryData<T>(key) === undefined) {
    queryClient.setQueryData<T>(key, value)
  }
}

/**
 * Read the draft slice + its full-replace mutator for one submission. Generic
 * over the content shape `T`; `emptyContent` supplies the stable empty value used
 * for an unseeded slot.
 */
export function useAttemptDraft<T>(
  submissionId: string,
  emptyContent: () => T,
): UseAttemptDraftResult<T> {
  const queryClient = useQueryClient()
  const key = attemptKeys.draft(submissionId)

  // Cache-as-store (D9): the draft is a client-managed value written only via
  // `setQueryData`. We subscribe to the query cache with `useSyncExternalStore`
  // (the `useRole` pattern) rather than `useQuery` — there is no queryFn to run
  // (nothing to fetch), and a stable snapshot ref keeps unrelated cache events
  // from re-rendering. Every edit is a full-replace.
  // A stable empty value for an unseeded slot. Calling the factory in the
  // `useRef` initializer matches the codebase convention (it runs each render but
  // only the first result is retained) and avoids reading a ref during render.
  const snapshotRef = useRef<T>(emptyContent())
  const emptyContentRef = useRef(emptyContent)
  useEffect(() => {
    emptyContentRef.current = emptyContent
  })
  const subscribe = useCallback(
    (notify: () => void) => queryClient.getQueryCache().subscribe(() => notify()),
    [queryClient],
  )
  const getSnapshot = useCallback((): T => {
    const cached = queryClient.getQueryData<T>(key)
    // Adopt the cached reference only when it exists AND actually changed. An
    // empty slot keeps returning the STABLE initial ref (never a fresh empty
    // object) so useSyncExternalStore doesn't loop on unrelated cache events.
    if (cached !== undefined && cached !== snapshotRef.current) {
      snapshotRef.current = cached
    }
    return snapshotRef.current
  }, [queryClient, key])
  const content = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setContent = useCallback(
    (updater: (prev: T) => T) => {
      queryClient.setQueryData<T>(key, (prev) =>
        updater(prev ?? emptyContentRef.current()),
      )
    },
    [queryClient, key],
  )

  return { content, setContent }
}
