/**
 * attemptTimer — Story 5.2b Task 5 (AC11, Winston-S3 / Murat-a). The
 * server-anchored MONOTONIC clock + the pure remaining-seconds computation that
 * drives BOTH the countdown and the AC15 read-only gate. Never `Date.now()`:
 * the clock is `serverTime`(at load) + `performance.now()`-delta, so a skewed
 * client wall-clock can neither shorten nor extend a timed exam.
 *
 * Everything here is pure / injectable (AC11a) — `computeRemainingSeconds` is a
 * plain function of `(startedAt, timeBudgetSeconds, nowMs)` so the remaining
 * table unit-tests directly, and `createServerClock` takes an injectable
 * `perfNow` so tests drive the clock without touching the wall clock or fake
 * timers.
 */

/**
 * Seconds left on a timed attempt, or `null` when the attempt is untimed.
 * `remaining = ceil((startedAt + timeBudget − now) / 1s)`, floored at 0.
 * @param startedAtIso server-authoritative attempt start (set once, never reset).
 * @param timeBudgetSeconds total budget; `null` → untimed (no timer, no auto-submit).
 * @param nowMs the monotonic server-anchored "now" in ms (from `serverNow()`).
 */
export function computeRemainingSeconds(
  startedAtIso: string,
  timeBudgetSeconds: number | null,
  nowMs: number,
): number | null {
  if (timeBudgetSeconds === null) return null
  const startedMs = Date.parse(startedAtIso)
  // Defensive: `startedAt` is a server-authoritative ISO string, so this is
  // unreachable in practice — but an unparseable value would make `deadlineMs`
  // NaN, so `remaining` NaN, so `NaN <= 0` false: the timer would render `NaN`
  // and never expire (never auto-submit). Fail closed to 0 (expired) instead.
  if (Number.isNaN(startedMs)) return 0
  const deadlineMs = startedMs + timeBudgetSeconds * 1000
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))
}

/** True once a timed attempt has run out (`remaining <= 0`). Untimed → never. */
export function isExpired(
  startedAtIso: string,
  timeBudgetSeconds: number | null,
  nowMs: number,
): boolean {
  const remaining = computeRemainingSeconds(startedAtIso, timeBudgetSeconds, nowMs)
  return remaining !== null && remaining <= 0
}

/**
 * Build a monotonic server-anchored clock. Reads the server anchor ONCE (here,
 * not in the tick) and advances it by the `performance.now()` delta — skew-
 * immune and re-reconcilable on tab re-focus by re-sampling.
 * @param serverTimeIso the `meta.serverTime` from the bundle load.
 * @param perfAtLoad `performance.now()` sampled when `serverTimeIso` landed.
 * @param perfNow injectable monotonic sampler (default `performance.now`).
 * @returns `serverNow()` → current server-anchored time in ms.
 */
export function createServerClock(
  serverTimeIso: string,
  perfAtLoad: number,
  perfNow: () => number = () => performance.now(),
): () => number {
  const serverBaseMs = Date.parse(serverTimeIso)
  return () => serverBaseMs + (perfNow() - perfAtLoad)
}

/** Timer warning tier for the chip styling + aria announcements (AC20). */
export type TimerWarningLevel = 'normal' | 'amber' | 'red'

export const AMBER_THRESHOLD_SECONDS = 5 * 60
export const RED_THRESHOLD_SECONDS = 60

/** Amber at ≤5:00, red at ≤1:00 (AC20). Untimed / null → 'normal'. */
export function timerWarningLevel(
  remainingSeconds: number | null,
): TimerWarningLevel {
  if (remainingSeconds === null) return 'normal'
  if (remainingSeconds <= RED_THRESHOLD_SECONDS) return 'red'
  if (remainingSeconds <= AMBER_THRESHOLD_SECONDS) return 'amber'
  return 'normal'
}

/** Format seconds as `M:SS` (or `H:MM:SS` past an hour) for the timer chip. */
export function formatRemaining(remainingSeconds: number): string {
  const total = Math.max(0, remainingSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    const mm = String(minutes).padStart(2, '0')
    return `${hours}:${mm}:${ss}`
  }
  return `${minutes}:${ss}`
}
