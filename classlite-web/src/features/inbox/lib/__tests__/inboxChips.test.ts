/**
 * inboxChips.test.ts — Story 10-1b · AC8(b) / DD8 (the FE-owned risk-6, part 2).
 *
 * RED (FE convention: imports a not-yet-existing module → `tsc -b` fails). COMPILE
 * SEAM: `../inboxChips` (`deriveInboxChips`). Dev greens by shipping
 * `src/features/inbox/lib/inboxChips.ts`.
 *
 * WHY THIS BITES (Murat): role-scope is a WRITE invariant on the backend, so a
 * happy-path "admin fixture has no billing row → none renders" is VACUOUS (it tests
 * the fixture). This asserts the DERIVATION instead: the admin chip set must NOT
 * contain a Billing or Alerts chip, and the owner set MUST — so a later widening of
 * the admin config (the copy-paste-drift failure mode across four near-identical
 * role views) fails THIS test, not production.
 *
 * GREEN SEAM — `deriveInboxChips(role: Role): InboxFilterChip[]`:
 *   derive chips from the role's AVAILABLE v1 NotificationTypes (DD8; no permanently
 *   -empty chips). Every set leads with `all` + `unread`. Per role:
 *     student → all · unread · grades · assignments · schedule
 *     teacher → all · unread · questions            (10-1c adds submissions/late)
 *     admin   → all · unread · enrolments           (NO billing, NO alerts)
 *     owner   → all · unread · enrolments · billing · alerts
 *   chip.key doubles as the i18n label key; reuse existing inboxList.filters.*
 *   where 1d-4 shipped them, new ones (unread/schedule/alerts) are in STORY_10_1B_KEYS.
 */
import { describe, expect, it } from 'vitest'

import type { Role } from '@/features/auth/api/authKeys'
import type { InboxFilterChip } from '@/components/domain/InboxListShell'

// COMPILE SEAM (red): this module does not exist yet.
import { deriveInboxChips } from '../inboxChips'

function chipKeys(role: Role): string[] {
  return deriveInboxChips(role).map((c: InboxFilterChip) => c.key)
}

/** Returns true if any chip key ends with the given filter token (namespace-agnostic). */
function hasFilter(role: Role, token: string): boolean {
  return chipKeys(role).some((k) => k === token || k.endsWith(`.${token}`))
}

describe('deriveInboxChips — per-role derivation (DD8)', () => {
  it('every role leads with all + unread', () => {
    for (const role of ['owner', 'admin', 'teacher', 'student'] as Role[]) {
      expect(hasFilter(role, 'all'), `${role} has All`).toBe(true)
      expect(hasFilter(role, 'unread'), `${role} has Unread`).toBe(true)
    }
  })

  it('student = grades + assignments + schedule (not questions/billing)', () => {
    expect(hasFilter('student', 'grades')).toBe(true)
    expect(hasFilter('student', 'assignments')).toBe(true)
    expect(hasFilter('student', 'schedule')).toBe(true)
    expect(hasFilter('student', 'questions')).toBe(false)
    expect(hasFilter('student', 'billing')).toBe(false)
  })

  it('teacher = questions only (10-1c adds submissions/late)', () => {
    expect(hasFilter('teacher', 'questions')).toBe(true)
    expect(hasFilter('teacher', 'submissions')).toBe(false)
    expect(hasFilter('teacher', 'grades')).toBe(false)
  })

  // The crux: the FE-owned cross-role guard. Admin must NOT surface owner-only lanes.
  it('admin = enrolments, with NO Billing and NO Alerts chip', () => {
    expect(hasFilter('admin', 'enrolments')).toBe(true)
    expect(hasFilter('admin', 'billing'), 'admin must NOT have a Billing chip (owner-only)').toBe(false)
    expect(hasFilter('admin', 'alerts'), 'admin must NOT have an Alerts/storage chip (owner-only)').toBe(false)
  })

  it('owner = enrolments + billing + alerts', () => {
    expect(hasFilter('owner', 'enrolments')).toBe(true)
    expect(hasFilter('owner', 'billing')).toBe(true)
    expect(hasFilter('owner', 'alerts')).toBe(true)
  })

  it('no chip set contains a permanently-empty category (no replies/mentions/staff in v1)', () => {
    for (const role of ['owner', 'admin', 'teacher', 'student'] as Role[]) {
      expect(hasFilter(role, 'replies'), `${role} must not show empty Replies`).toBe(false)
      expect(hasFilter(role, 'mentions'), `${role} must not show empty Mentions`).toBe(false)
      expect(hasFilter(role, 'staff'), `${role} must not show empty Staff`).toBe(false)
    }
  })
})
