/**
 * assignmentRow — pure row-model helpers for the student assignments list
 * (Story 5.2c, AC4/AC5). No React, no i18n resolution here — these return i18n
 * KEYS and route strings; the component resolves + renders. Kept pure so the
 * status/CTA/overdue matrix is unit-tested in isolation (RED-first).
 */
import type { components } from '@/lib/api/client'

type ExerciseSkill = components['schemas']['ExerciseSkill']
type SubmissionStatus = components['schemas']['SubmissionStatus']

/**
 * Map an assignment's exercise skill to its attempt route, or `null` when the
 * skill's attempt UI is not built yet (the row degrades to a disabled
 * "Available soon" CTA — D2).
 *
 * - `reading | listening | vocabulary | grammar` → the 5.2b quiz attempt route.
 * - `writing` (5.3) → the writing attempt route (`/write`).
 * - `speaking` (5.4) → the speaking attempt route (`/speak`).
 * - `general` → `null` (no dedicated attempt UI).
 *
 * The `null` return is the seam Story 5.5+ extends when their routes land.
 * @param skill the assignment's exercise skill.
 * @param assignmentId the assignment id used to build the route.
 * @returns the attempt route path, or `null` if not yet available.
 */
export function attemptRouteForSkill(
  skill: ExerciseSkill,
  assignmentId: string,
): string | null {
  switch (skill) {
    case 'reading':
    case 'listening':
    case 'vocabulary':
    case 'grammar':
      return `/assignments/${assignmentId}/attempt`
    case 'writing':
      return `/assignments/${assignmentId}/write`
    case 'speaking':
      return `/assignments/${assignmentId}/speak`
    case 'general':
      return null
    default:
      // Fail-safe for an exerciseSkill outside the generated union (server/type
      // version skew): degrade to the "Available soon" CTA rather than emit a
      // broken `<Link to={undefined}>` into an unbuilt attempt route (D2).
      return null
  }
}

/** The primary action a row offers, derived from `submissionStatus`. */
export type RowCta = 'start' | 'continue' | 'view' | 'none'

export interface RowStatus {
  /** i18n key for the status badge label. */
  statusKey: string
  /** The primary CTA kind (the component maps it to a label + destination). */
  cta: RowCta
}

/**
 * Derive the status label key + primary CTA from the caller's own submission
 * status (AC4).
 *
 * - `null` (not started) → Start.
 * - `in_progress` → Continue.
 * - `submitted` / `ai_processing` → "Submitted"; opens read-only (view).
 * - `graded` → Graded badge only; the result view is Story 5.5 (no CTA here).
 * @param submissionStatus the caller's submission status, or `null` if not started.
 * @returns the status i18n key + CTA kind.
 */
export function rowStatus(submissionStatus: SubmissionStatus | null): RowStatus {
  switch (submissionStatus) {
    case null:
      return { statusKey: 'assignments.status.notStarted', cta: 'start' }
    case 'in_progress':
      return { statusKey: 'assignments.status.inProgress', cta: 'continue' }
    case 'submitted':
    case 'ai_processing':
      return { statusKey: 'assignments.status.submitted', cta: 'view' }
    case 'graded':
      return { statusKey: 'assignments.status.graded', cta: 'none' }
    default:
      // Fail-safe for a submissionStatus outside the generated union
      // (server/type version skew): degrade to a passive, no-action row rather
      // than return `undefined` and crash the whole list on destructure.
      return { statusKey: 'assignments.status.submitted', cta: 'none' }
  }
}

/**
 * Whether a row is overdue: its deadline is strictly in the past AND the
 * student has not yet submitted (AC5). A `submitted` / `ai_processing` /
 * `graded` row is never overdue — submission closes the window. Uses the
 * server clock (`serverTime`, captured from the list envelope) as the
 * reference time so a skewed client wall-clock never flips a row overdue
 * early; falls back to the wall clock only when no server time is supplied.
 * This is a timestamp COMPARISON (not a render-path format), so parsing the
 * ISO strings here is safe under TS-6.
 * @param deadlineAt the assignment deadline (ISO 8601).
 * @param submissionStatus the caller's submission status, or `null`.
 * @param serverTime the server reference clock (ISO 8601); optional.
 * @returns `true` when the row should show the overdue marker.
 */
export function isOverdue(
  deadlineAt: string,
  submissionStatus: SubmissionStatus | null,
  serverTime?: string,
): boolean {
  if (submissionStatus !== null && submissionStatus !== 'in_progress') {
    return false
  }
  const now = serverTime ? Date.parse(serverTime) : Date.now()
  const deadline = Date.parse(deadlineAt)
  if (Number.isNaN(deadline) || Number.isNaN(now)) return false
  return deadline < now
}
