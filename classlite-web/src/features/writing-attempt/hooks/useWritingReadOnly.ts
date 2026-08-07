/**
 * useWritingReadOnly — Story 5.3 Task 5 (AC16, Winston BLOCKER 3). The read-only
 * derivation for the writing attempt, which — unlike the quiz shell's once-at-load
 * `useMemo` — TICKS off the monotonic due-date clock. For writing, an untimed +
 * due-bound attempt is the NORM (not a rare edge): without this tick an untimed
 * attempt would keep autosaving until a PUT 409s and "overdue" would be merely
 * cosmetic. Ticking flips the attempt read-only the moment `hardDeadlineAt` passes
 * mid-session (no write-409 required).
 *
 * A racing-write 409 (`mapWriteError` → `readOnly`) can additionally OVERRIDE to
 * read-only (AC16). The tick only calls `setState` when the derived
 * readOnly/reason actually CHANGES, so a still-editable attempt does NOT re-render
 * the shell every second (only on the flip).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deriveReadOnly,
  mapWriteError,
  type ReadOnlyReason,
  type ReadOnlyState,
  type WriteErrorOutcome,
} from '@/features/attempts'
import type { components } from '@/lib/api/client'

type SubmissionStatus = components['schemas']['SubmissionStatus']
type AssignmentStatus = components['schemas']['AssignmentStatus']

export interface UseWritingReadOnlyOptions {
  submissionStatus: SubmissionStatus
  assignmentStatus: AssignmentStatus
  hardDeadlineAt: string | null
  /** The monotonic server-anchored clock (never `Date.now()`). */
  serverNow: () => number
  /** Tick cadence in ms (default 1s); injectable for tests. */
  tickMs?: number
}

export interface UseWritingReadOnlyResult {
  readOnly: boolean
  reason: ReadOnlyReason | null
  /** Apply a racing-write 409/413; sets the read-only override on a lock. */
  applyWriteError: (error: unknown) => WriteErrorOutcome
}

export function useWritingReadOnly({
  submissionStatus,
  assignmentStatus,
  hardDeadlineAt,
  serverNow,
  tickMs = 1000,
}: UseWritingReadOnlyOptions): UseWritingReadOnlyResult {
  const derive = useCallback(
    (): ReadOnlyState =>
      deriveReadOnly({
        submissionStatus,
        assignmentStatus,
        hardDeadlineAt,
        serverNowMs: serverNow(),
      }),
    [submissionStatus, assignmentStatus, hardDeadlineAt, serverNow],
  )

  const deriveRef = useRef(derive)
  useEffect(() => {
    deriveRef.current = derive
  })

  const [ticked, setTicked] = useState<ReadOnlyState>(() => derive())
  const [override, setOverride] = useState<ReadOnlyReason | null>(null)

  // Re-derive every tick off a FRESH `serverNow()`; only `setState` on a real
  // change so an editable attempt never re-renders the shell per second. The tick
  // reads `deriveRef.current`, so a mid-session bundle-prop change is picked up on
  // the next tick (≤ tickMs) without a synchronous setState-in-effect.
  useEffect(() => {
    const id = setInterval(() => {
      const next = deriveRef.current()
      setTicked((prev) =>
        prev.readOnly === next.readOnly && prev.reason === next.reason
          ? prev
          : next,
      )
    }, tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  const applyWriteError = useCallback((error: unknown): WriteErrorOutcome => {
    const outcome = mapWriteError(error)
    if (outcome.kind === 'readOnly') setOverride(outcome.reason)
    return outcome
  }, [])

  const readOnly = ticked.readOnly || override !== null
  const reason: ReadOnlyReason | null = override ?? ticked.reason

  return { readOnly, reason, applyWriteError }
}
