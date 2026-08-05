/**
 * finalizeAttempt — Story 5.2b (AC18, Winston-B3 / Murat-b). The serialized
 * finalizer + single-fire latch, shared by BOTH the AC13 submit-confirm and the
 * AC14 timer-expiry auto-submit (and the AC19 resume-finalize on load).
 *
 * Ordered async sequence:
 *   1. Latch — if `alreadyFinalized` is set, no-op (fires exactly once).
 *   2. `onBeforeFinalize` — cancel the autosave timer + narrate (AC20).
 *   3. `flush()` — supersede any in-flight autosave and await a PUT that carries
 *      the LATEST full `content` and resolves on its ack. NO beacon here — you
 *      cannot beacon a PUT then reliably POST after it.
 *   4. `submit()` — POST /submit, only AFTER the flush ack.
 *
 * Integrity rules:
 *   - If the final flush fails with a TERMINAL 409 (`SUBMISSION_NOT_EDITABLE` /
 *     `SUBMISSION_LOCKED` / `TIME_EXPIRED`) → the server has already sealed the
 *     attempt (AC14 0:00 convergence / AC19 resume-finalize on an already-expired
 *     attempt): the content can no longer be written, but we MUST still finalize,
 *     so fall through to `submit()` (which resolves idempotently). NOT doing so
 *     leaves an expired attempt stuck `in_progress` forever (no server sweep).
 *   - If the final flush fails for ANY OTHER reason (network/5xx) → do NOT POST
 *     (no silent lossy submit). Re-open the latch so the "couldn't save
 *     everything — retry" fallback can retry.
 *   - A terminal 409 on submit is treated as already-final (idempotent, AC19),
 *     not an error — the server finalized it out from under us.
 *   - A non-terminal submit failure (network/5xx) re-opens the latch for retry.
 */
import { ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'

type Submission = components['schemas']['Submission']

/** A mutable single-fire latch shared across confirm + expiry triggers. */
export interface FinalizeLatch {
  current: boolean
}

export interface FinalizeAttemptDeps {
  /**
   * Supersede in-flight autosave and PUT the latest full content, resolving on
   * that save's ack. MUST reject if the save fails.
   */
  flush: () => Promise<void>
  /** POST /submit (no body). */
  submit: () => Promise<Submission>
  /** The shared single-fire latch. */
  alreadyFinalized: FinalizeLatch
  /** Cancel the autosave timer + narrate the finalize (AC20). Runs once, before flush. */
  onBeforeFinalize?: () => void
}

export type FinalizeResult =
  | { kind: 'submitted'; submission: Submission | null }
  | { kind: 'noop' }
  | { kind: 'flush-failed'; error: unknown }
  | { kind: 'submit-failed'; error: unknown }

/** 409 subcodes that mean the server already finalized the attempt (AC19). */
const TERMINAL_SUBMIT_CODES = new Set([
  'SUBMISSION_NOT_EDITABLE',
  'SUBMISSION_LOCKED',
  'TIME_EXPIRED',
])

function isTerminalConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    TERMINAL_SUBMIT_CODES.has(error.code)
  )
}

/**
 * Run the serialized finalize sequence exactly once.
 * @returns a discriminated result; `noop` when the latch was already engaged.
 */
export async function finalizeAttempt(
  deps: FinalizeAttemptDeps,
): Promise<FinalizeResult> {
  if (deps.alreadyFinalized.current) return { kind: 'noop' }
  deps.alreadyFinalized.current = true
  deps.onBeforeFinalize?.()

  // Step 3 — flush the latest content and await its ack. A TERMINAL 409 here
  // means the server already sealed the attempt (time expired / locked) — the
  // content can no longer be written, but we must still finalize, so fall
  // through to submit (which resolves idempotently). Any OTHER failure re-opens
  // the latch and surfaces the retry fallback rather than POSTing a lossy submit.
  try {
    await deps.flush()
  } catch (error) {
    if (!isTerminalConflict(error)) {
      deps.alreadyFinalized.current = false
      return { kind: 'flush-failed', error }
    }
    // terminal conflict — the attempt is already sealed server-side; proceed to
    // the submit step, which returns the finalized submission or an idempotent 409.
  }

  // Step 4 — POST /submit, strictly after the flush ack.
  try {
    const submission = await deps.submit()
    return { kind: 'submitted', submission }
  } catch (error) {
    if (isTerminalConflict(error)) {
      // Server finalized it already (AC19 idempotent). Keep the latch engaged.
      return { kind: 'submitted', submission: null }
    }
    // Retryable failure — re-open the latch for the retry fallback.
    deps.alreadyFinalized.current = false
    return { kind: 'submit-failed', error }
  }
}
