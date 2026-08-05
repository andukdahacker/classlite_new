/**
 * attemptDraftStorage — Story 5.2b Task 4 (AC22, Sally-B1 / Winston-S2). The
 * localStorage single-tab draft mirror: the real no-data-loss guarantee (not the
 * up-to-30s window of autosave alone). Answers write through on change, recover
 * on reload/crash, clear on successful submit, and reconcile on reconnect —
 * server-state wins on conflict, the student warned via a non-blocking toast.
 *
 * All functions are pure / storage-only so they unit-test without a React
 * harness. JSON is fully guarded — a corrupt or foreign blob degrades to "no
 * stored draft", never a throw. Multi-tab `BroadcastChannel` stays deferred to
 * 5.3 (D8).
 */
import {
  isAnswered,
  normalizeAttemptContent,
  type AttemptContent,
} from './attemptContent'

const KEY_PREFIX = 'classlite:attempt-draft:'

function storageKey(submissionId: string): string {
  return `${KEY_PREFIX}${submissionId}`
}

/** Read + normalize the mirrored draft, or null if absent / unparseable. */
export function readStoredDraft(submissionId: string): AttemptContent | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(storageKey(submissionId))
  } catch {
    return null // storage disabled / quota / privacy mode
  }
  if (raw === null) return null
  try {
    return normalizeAttemptContent(JSON.parse(raw))
  } catch {
    return null // corrupt JSON → treat as no draft
  }
}

/**
 * Write-through the current draft. Best-effort; never throws.
 * @returns `true` when the mirror was written; `false` on quota/disabled/privacy
 * mode so the caller can surface that the local safety-net is off (AC22).
 */
export function writeStoredDraft(
  submissionId: string,
  content: AttemptContent,
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

export interface ReconcileResult {
  merged: AttemptContent
  /** True when a local edit differed from the server value (server won). */
  hadConflict: boolean
  /** True when a local-only answer the server never saw was recovered. */
  recoveredLocalOnly: boolean
}

/**
 * Reconcile a local mirror against the server's content on load/reconnect.
 * Server-state wins on conflict (AC22); a local-only answer (a brand-new answer
 * the server never received — the crash case) is RECOVERED; flags are unioned
 * (non-destructive).
 */
export function reconcileDrafts(
  local: AttemptContent | null,
  server: AttemptContent,
): ReconcileResult {
  if (local === null) {
    return { merged: server, hadConflict: false, recoveredLocalOnly: false }
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
    hadConflict,
    recoveredLocalOnly,
  }
}
