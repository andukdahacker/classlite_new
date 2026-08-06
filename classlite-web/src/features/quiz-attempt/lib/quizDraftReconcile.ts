/**
 * quizDraftReconcile — Story 5.2d (AC4). The QUIZ-shaped reconcile merge that the
 * generic `attempts` draft-storage layer delegates to. This is the logic that
 * used to be baked into `attemptDraftStorage.reconcileDrafts` before the spine
 * extraction (Winston STRONG 2): server-state wins on conflict (AC22), a
 * local-only answer the server never saw (the crash case) is RECOVERED, and flags
 * are unioned (non-destructive). The quiz-flavored conflict signal
 * (`hadConflict`/`recoveredLocalOnly`) now lives HERE, in the quiz feature, not
 * in the generic layer.
 */
import type {
  DraftMerge,
  ReconcileResult,
  ReconcileConfig,
} from '@/features/attempts'
import {
  isAnswered,
  normalizeAttemptContent,
  type AttemptContent,
} from './attemptContent'

/** The quiz conflict signal surfaced to the page for its reconcile toasts. */
export interface QuizReconcileConflict {
  /** True when a local edit differed from the server value (server won). */
  hadConflict: boolean
  /** True when a local-only answer the server never saw was recovered. */
  recoveredLocalOnly: boolean
}

/** The conflict signal for "no reconcile ran" (an already-seeded remount). */
export const QUIZ_NO_CONFLICT: QuizReconcileConflict = {
  hadConflict: false,
  recoveredLocalOnly: false,
}

/**
 * Reconcile a local mirror against the server's content on load. Server-state
 * wins on conflict (AC22); a local-only answer (a brand-new answer the server
 * never received — the crash case) is RECOVERED; flags are unioned.
 */
export const reconcileQuizDrafts: DraftMerge<AttemptContent, QuizReconcileConflict> = (
  local,
  server,
): ReconcileResult<AttemptContent, QuizReconcileConflict> => {
  if (local === null) {
    return { merged: server, conflict: { ...QUIZ_NO_CONFLICT } }
  }

  const answers: Record<string, string> = { ...server.answers }
  let hadConflict = false
  let recoveredLocalOnly = false

  for (const [handle, value] of Object.entries(local.answers)) {
    if (!isAnswered(value)) continue
    const serverValue = server.answers[handle]
    if (isAnswered(serverValue)) {
      if (serverValue !== value) hadConflict = true // server wins — keep it
    } else {
      answers[handle] = value // recover an unsaved local-only answer
      recoveredLocalOnly = true
    }
  }

  const flagged = Array.from(new Set([...server.flagged, ...local.flagged]))
  return {
    merged: { schemaVersion: 1, answers, flagged },
    conflict: { hadConflict, recoveredLocalOnly },
  }
}

/**
 * The quiz reconcile config wired into `reconcileStoredDraftIntoCache`: normalize
 * the untrusted blob into `AttemptContent`, merge via `reconcileQuizDrafts`, and
 * report `QUIZ_NO_CONFLICT` when the slot was already seeded.
 */
export const quizReconcileConfig: ReconcileConfig<AttemptContent, QuizReconcileConflict> = {
  normalize: normalizeAttemptContent,
  merge: reconcileQuizDrafts,
  noConflict: QUIZ_NO_CONFLICT,
}
