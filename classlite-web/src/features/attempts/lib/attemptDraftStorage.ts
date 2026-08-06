/**
 * attemptDraftStorage — Story 5.2b Task 4 (AC22, Sally-B1 / Winston-S2),
 * generalized and moved to the shared `attempts` module in Story 5.2d (AC4). The
 * localStorage single-tab draft mirror: the real no-data-loss guarantee (not the
 * up-to-30s window of autosave alone). Content writes through on change, recovers
 * on reload/crash, clears on successful submit, and reconciles on load.
 *
 * Content-generic (5.2d AC4, Winston STRONG 2 — this layer is NOT verbatim-
 * movable): read/write/clear/key are generic over the content shape `T`; the
 * NORMALIZER (untrusted-blob → `T`) and the reconcile MERGE (how a local mirror
 * combines with the server value + what "conflict" means) are INJECTED by the
 * consumer. Quiz supplies its per-answer/flag union + `isAnswered` merge
 * (`quiz-attempt/lib/quizDraftReconcile.ts`); the synthetic harness supplies a
 * whole-value replace. Nothing quiz-flavored (`answers`/`flagged`/`isAnswered`,
 * `hadConflict`/`recoveredLocalOnly`) is baked into this layer anymore.
 *
 * All functions are pure / storage-only so they unit-test without a React
 * harness. JSON is fully guarded — a corrupt or foreign blob degrades to "no
 * stored draft", never a throw. Multi-tab `BroadcastChannel` stays deferred to
 * 5.3 (D8).
 */

const KEY_PREFIX = 'classlite:attempt-draft:'

function storageKey(submissionId: string): string {
  return `${KEY_PREFIX}${submissionId}`
}

/**
 * Read + normalize the mirrored draft, or null if absent / unparseable. The
 * caller injects `normalize` — the shape-specific coercion of the untrusted blob
 * into `T`.
 */
export function readStoredDraft<T>(
  submissionId: string,
  normalize: (raw: unknown) => T,
): T | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(storageKey(submissionId))
  } catch {
    return null // storage disabled / quota / privacy mode
  }
  if (raw === null) return null
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return null // corrupt JSON → treat as no draft
  }
}

/**
 * Write-through the current draft. Best-effort; never throws.
 * @returns `true` when the mirror was written; `false` on quota/disabled/privacy
 * mode so the caller can surface that the local safety-net is off (AC22).
 */
export function writeStoredDraft<T>(
  submissionId: string,
  content: T,
): boolean {
  try {
    window.localStorage.setItem(storageKey(submissionId), JSON.stringify(content))
    return true
  } catch {
    // quota / disabled — the server autosave is still the durable path.
    return false
  }
}

/** Clear the mirror (post-submit, AC22). Best-effort. */
export function clearStoredDraft(submissionId: string): void {
  try {
    window.localStorage.removeItem(storageKey(submissionId))
  } catch {
    // ignore
  }
}

/**
 * The outcome of a reconcile: the merged content plus a MERGE-DEFINED conflict
 * signal `C` (5.2d AC4). The generic layer does not know what `C` means — quiz
 * uses `{ hadConflict, recoveredLocalOnly }`; another content type may use a
 * different shape or `void`.
 */
export interface ReconcileResult<T, C> {
  merged: T
  conflict: C
}

/**
 * How a local mirror reconciles with the server value on load/reconnect. The
 * consumer owns the merge policy (server-wins, local-newer-wins, whole-value
 * replace) AND the meaning of the returned conflict signal.
 */
export type DraftMerge<T, C> = (
  local: T | null,
  server: T,
) => ReconcileResult<T, C>

/**
 * Reconcile a local mirror against the server's content by delegating to the
 * injected merge. This is intentionally a thin seam: the generic layer no longer
 * hard-references answers/flagged/isAnswered — it returns exactly the
 * merge-defined conflict signal.
 */
export function reconcileDrafts<T, C>(
  local: T | null,
  server: T,
  merge: DraftMerge<T, C>,
): ReconcileResult<T, C> {
  return merge(local, server)
}
