/**
 * resultSeen — Story 5.5b Task 5b (AC15, D-DISCOVERY). A tiny per-device localStorage
 * ledger of which released results the student has opened, so the `/assignments` list
 * can show a "new result" unread indicator without a backend `viewed_at` (durable
 * cross-device unread is the Epic-10 Inbox — FU-5-5b-DISCOVERY).
 *
 * Keyed by `assignmentId` (+ `gradedAt` when available, so a re-grade re-arms the
 * indicator). When the list row lacks `gradedAt` (the 5.2c list item carries none),
 * the key is `assignmentId` alone — the re-grade-rearm limitation is tracked as part of
 * FU-5-5b-DISCOVERY. SSR/quota-safe: every access is guarded, a throw never bubbles.
 */
const STORAGE_PREFIX = 'cl.resultSeen.'

/** Build the storage key. `gradedAt` (when present) makes a re-grade re-arm unread. */
function seenKey(assignmentId: string, gradedAt?: string | null): string {
  return gradedAt
    ? `${STORAGE_PREFIX}${assignmentId}.${gradedAt}`
    : `${STORAGE_PREFIX}${assignmentId}`
}

/**
 * Whether `key` has been marked seen. Returns `true` on ANY storage failure
 * (SSR / disabled / quota) so a broken store defaults to "seen" — a dot that can
 * never be cleared is worse UX than a missed hint (the durable signal is Epic-10).
 */
function hasSeen(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true
    return window.localStorage.getItem(key) !== null
  } catch {
    return true
  }
}

/** Write localStorage without ever throwing (SSR / disabled storage / quota). */
function safeSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, value)
  } catch {
    // Best-effort per-device; a full/blocked store just means the dot lingers.
  }
}

/**
 * Mark a released result as seen (called when the student opens the result view).
 * @param assignmentId the assignment whose result was opened.
 * @param gradedAt the grade timestamp, when known (re-arms unread on a re-grade).
 */
export function markResultSeen(assignmentId: string, gradedAt?: string | null): void {
  if (!assignmentId) return
  safeSet(seenKey(assignmentId, gradedAt), '1')
}

/**
 * Whether a released result is UNREAD on this device.
 * @param assignmentId the assignment to check.
 * @param released whether the row's result is released (only released rows can be unread).
 * @param gradedAt the grade timestamp, when the row carries one.
 * @returns true when released and not yet seen on this device.
 */
export function isResultUnread(
  assignmentId: string,
  released: boolean,
  gradedAt?: string | null,
): boolean {
  if (!released || !assignmentId) return false
  return !hasSeen(seenKey(assignmentId, gradedAt))
}
