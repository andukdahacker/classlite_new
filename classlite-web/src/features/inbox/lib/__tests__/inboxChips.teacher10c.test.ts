/**
 * inboxChips.teacher10c.test.ts — Story 10-1c · AC7 / DD4.
 *
 * RED (runtime): `../inboxChips` already exists (10-1b), so this is NOT a compile
 * seam — it's a behavioural red. Today `ROLE_CHIPS.teacher = ['all','unread',
 * 'questions']`, so the `submissions`/`late` assertions below FAIL until the dev
 * widens the teacher set. (The green dev ALSO flips the 10-1b `inboxChips.test.ts`
 * line `expect(hasFilter('teacher','submissions')).toBe(false)` → true.)
 *
 * GREEN SEAM — extend inboxChips so the TEACHER set derives to
 *   all · unread · questions · submissions · late
 * where `submissions` → the teacher-queue source (lateOnly:false) and `late` →
 * the teacher-queue source (lateOnly:true, SERVER-side filter, Ducdo Q3). The
 * cross-role guard still holds: student/admin/owner get NO submissions/late chip
 * (the copy-paste-drift failure mode across four role views must fail THIS test).
 */
import { describe, expect, it } from 'vitest'

import type { Role } from '@/features/auth/api/authKeys'
import type { InboxFilterChip } from '@/components/domain/InboxListShell'

import { deriveInboxChips } from '../inboxChips'

function chipKeys(role: Role): string[] {
  return deriveInboxChips(role).map((c: InboxFilterChip) => c.key)
}

/** namespace-agnostic: a chip whose key is or ends with `.token`. */
function hasFilter(role: Role, token: string): boolean {
  return chipKeys(role).some((k) => k === token || k.endsWith(`.${token}`))
}

describe('deriveInboxChips — teacher gains the grading-queue chips (10-1c)', () => {
  it('teacher = questions + submissions + late (plus all/unread)', () => {
    expect(hasFilter('teacher', 'all')).toBe(true)
    expect(hasFilter('teacher', 'unread')).toBe(true)
    expect(hasFilter('teacher', 'questions')).toBe(true)
    expect(hasFilter('teacher', 'submissions')).toBe(true)
    expect(hasFilter('teacher', 'late')).toBe(true)
  })

  it('CROSS-ROLE GUARD: no other role gains a submissions/late chip', () => {
    for (const role of ['student', 'admin', 'owner'] as Role[]) {
      expect(hasFilter(role, 'submissions'), `${role} must NOT have a submissions chip`).toBe(false)
      expect(hasFilter(role, 'late'), `${role} must NOT have a late chip`).toBe(false)
    }
  })
})
