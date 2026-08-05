/**
 * attemptReadOnly — Story 5.2b Task 8 (AC15, Winston-I3/I4). Two pure deciders:
 *
 *  1. `deriveReadOnly` — is the loaded attempt read-only, and why? A 200 bundle
 *     whose submission is no longer `in_progress`, whose assignment is `closed`,
 *     or whose `hardDeadlineAt` has passed (per the monotonic `serverNow()`, not
 *     `Date.now()`) is read-only: inputs disabled, autosave off, Submit hidden,
 *     shown via an inline banner.
 *
 *  2. `mapWriteError` — a racing write 409/413 → a shared error-code → outcome
 *     map, so a mid-attempt lock flips read-only (no last-rendered answers lost)
 *     and an oversized payload surfaces the Error save-status.
 */
import { ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'

type SubmissionStatus = components['schemas']['SubmissionStatus']
type AssignmentStatus = components['schemas']['AssignmentStatus']

/** Which read-only banner to show. Maps 1:1 to an `attempt.readonly.*` key. */
export type ReadOnlyReason = 'submitted' | 'locked' | 'timeExpired'

export interface ReadOnlyState {
  readOnly: boolean
  reason: ReadOnlyReason | null
}

export interface DeriveReadOnlyInput {
  submissionStatus: SubmissionStatus
  assignmentStatus: AssignmentStatus
  hardDeadlineAt: string | null
  /** Monotonic server-anchored now (ms) — never `Date.now()` (AC11). */
  serverNowMs: number
}

/** The i18n key for a read-only reason (AC15 banner copy). */
export function readOnlyReasonKey(reason: ReadOnlyReason): string {
  return `attempt.readonly.${reason}`
}

/** Derive whether the attempt is read-only from the loaded bundle (AC15). */
export function deriveReadOnly({
  submissionStatus,
  assignmentStatus,
  hardDeadlineAt,
  serverNowMs,
}: DeriveReadOnlyInput): ReadOnlyState {
  if (submissionStatus !== 'in_progress') {
    return { readOnly: true, reason: 'submitted' }
  }
  if (assignmentStatus === 'closed') {
    return { readOnly: true, reason: 'locked' }
  }
  if (hardDeadlineAt !== null) {
    const deadlineMs = Date.parse(hardDeadlineAt)
    // Defensive: `hardDeadlineAt` is a server ISO string, so NaN is unreachable
    // in practice — but `serverNowMs >= NaN` is false, which would silently let a
    // malformed deadline never enforce read-only. Treat NaN as already-passed.
    if (Number.isNaN(deadlineMs) || serverNowMs >= deadlineMs) {
      return { readOnly: true, reason: 'timeExpired' }
    }
  }
  return { readOnly: false, reason: null }
}

export type WriteErrorOutcome =
  | { kind: 'readOnly'; reason: ReadOnlyReason }
  | { kind: 'saveError'; messageKey: string }
  | { kind: 'unknown' }

/** Map a racing write 409/413 to a UI outcome (AC15). */
export function mapWriteError(error: unknown): WriteErrorOutcome {
  if (!(error instanceof ApiError)) return { kind: 'unknown' }
  if (error.status === 409) {
    switch (error.code) {
      case 'TIME_EXPIRED':
        return { kind: 'readOnly', reason: 'timeExpired' }
      case 'SUBMISSION_LOCKED':
        return { kind: 'readOnly', reason: 'locked' }
      case 'SUBMISSION_NOT_EDITABLE':
        return { kind: 'readOnly', reason: 'submitted' }
      default:
        return { kind: 'unknown' }
    }
  }
  if (error.status === 413 || error.code === 'PAYLOAD_TOO_LARGE') {
    return { kind: 'saveError', messageKey: 'attempt.error.payloadTooLarge' }
  }
  return { kind: 'unknown' }
}
