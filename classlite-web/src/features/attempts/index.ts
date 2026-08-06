/**
 * attempts feature barrel — Story 5.2d (TS-7). The shared, content-generic
 * attempt spine consumed by every attempt surface: quiz (5.2b), writing (5.3),
 * speaking (5.4). Each consumer imports the primitives from here and supplies its
 * own content shape `T` + content-shaped pieces (draft mutators, reconcile merge,
 * question rendering). Nothing here references a quiz field.
 */

// --- bootstrap + server state ---
export { useAttemptBootstrap, type AttemptBootstrapResult } from './api/useAttemptBootstrap'
export { attemptKeys } from './api/attemptKeys'

// --- draft slice (cache-as-store, D9) ---
export {
  useAttemptDraft,
  seedAttemptDraft,
  type UseAttemptDraftResult,
} from './api/useAttemptDraft'

// --- autosave + finalize ---
export {
  useAttemptAutosave,
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  type UseAttemptAutosaveOptions,
  type UseAttemptAutosaveResult,
} from './api/useAttemptAutosave'
export { useSubmitAttempt } from './api/useSubmitAttempt'
export {
  finalizeAttempt,
  type FinalizeLatch,
  type FinalizeResult,
  type FinalizeAttemptDeps,
} from './api/finalizeAttempt'

// --- localStorage draft mirror + reconcile (content-generic seams) ---
export {
  readStoredDraft,
  writeStoredDraft,
  clearStoredDraft,
  reconcileDrafts,
  type ReconcileResult,
  type DraftMerge,
} from './lib/attemptDraftStorage'
export {
  useAttemptDraftPersistence,
  reconcileStoredDraftIntoCache,
  type ReconcileConfig,
  type UseAttemptDraftPersistenceOptions,
} from './hooks/useAttemptDraftPersistence'

// --- server-anchored timer ---
export { useAttemptTimer, type UseAttemptTimerResult } from './hooks/useAttemptTimer'
export {
  createServerClock,
  computeRemainingSeconds,
  isExpired,
  timerWarningLevel,
  formatRemaining,
  AMBER_THRESHOLD_SECONDS,
  RED_THRESHOLD_SECONDS,
  type TimerWarningLevel,
} from './lib/attemptTimer'

// --- read-only derivation ---
export {
  deriveReadOnly,
  mapWriteError,
  readOnlyReasonKey,
  type ReadOnlyReason,
  type ReadOnlyState,
  type WriteErrorOutcome,
} from './lib/attemptReadOnly'

// --- shared UI ---
export { SaveStatusIndicator } from './components/SaveStatusIndicator'
export { SubmissionConfirmation } from './components/SubmissionConfirmation'
export { TimerChip } from './components/TimerChip'
export { AttemptExpiredOverlay } from './components/AttemptExpiredOverlay'
