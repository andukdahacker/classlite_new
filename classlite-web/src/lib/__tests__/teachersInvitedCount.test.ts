/**
 * Story 2-4 — `teachersInvitedCount` shared-lib red-phase acceptance tests.
 *
 * Covers AC3 stat-filter contract [W-BLOCKER-3 pragmatic fold] — extracted
 * from `OnboardingDonePage.tsx:188-206` (2-3c `deriveTeachersInvitedCount`)
 * to a shared-lib location (`src/lib/teachersInvitedCount.ts`) so BOTH the
 * dashboard checklist (2-4) AND the onboarding done page (2-3c) consume the
 * same implementation. Dual-impl drift is worse than a one-commit refactor.
 *
 * Contract carries all 2-3c Round 1 hardening verbatim:
 *   - Case-insensitive normalization (toLowerCase)
 *   - Trim whitespace
 *   - Set-based dedup (a teacher assigned to N classes counts as 1 invite)
 *   - Whitespace-only teacherEmail exclusion (R1-C1-P20)
 *   - Self-exclusion when userEmail matches (case+trim normalized)
 *   - Null-user boot-probe fallback (`userEmail === null | undefined`):
 *     falls back to "count everything (dedup'd)" per W-S3 defensive posture
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 2.1
 * (`src/lib/teachersInvitedCount.ts`) — TS2307 error is the RED signal.
 *
 * Test matrix inherits 2-3c AC1 6-row negative matrix + 1 boot-probe row:
 *   1. case-mismatch → excluded (Case-insensitive contract)
 *   2. trim-mismatch → excluded (Trim contract)
 *   3. null classesDraft → 0 (no throw)
 *   4. empty classesDraft → 0
 *   5. Founder self-injection (Winston-W4) → excluded
 *   6. undefined/whitespace-only teacherEmail row → skipped
 *   7. null userEmail (boot-probe) → count everything dedup'd (W-S3)
 * Plus:
 *   8. Duplicate email across multiple classes → counted once (R1-C1-P24)
 */
import { describe, expect, test } from 'vitest'

import { teachersInvitedCount } from '@/lib/teachersInvitedCount'

type ClassesDraft = Parameters<typeof teachersInvitedCount>[0]

const rowsFor = (emails: Array<string | null>): ClassesDraft =>
  emails.map((teacherEmail, i) => ({
    cohortName: `Cohort ${i + 1}`,
    startDate: '2026-08-15',
    teacherEmail,
  }))

describe('teachersInvitedCount — 2-3c AC1 contract (shared-lib port per W-BLOCKER-3)', () => {
  test('case-mismatch: OWNER@EXAMPLE.COM vs owner@example.com → self excluded', () => {
    const draft = rowsFor(['OWNER@EXAMPLE.COM'])
    expect(teachersInvitedCount(draft, 'owner@example.com')).toBe(0)
  })

  test('trim-mismatch: "  bob@example.com  " vs bob@example.com → self excluded', () => {
    const draft = rowsFor(['  bob@example.com  '])
    expect(teachersInvitedCount(draft, 'bob@example.com')).toBe(0)
  })

  test('null classesDraft → 0 (no throw)', () => {
    expect(() => teachersInvitedCount(null, 'owner@example.com')).not.toThrow()
    expect(teachersInvitedCount(null, 'owner@example.com')).toBe(0)
  })

  test('undefined classesDraft → 0 (no throw)', () => {
    expect(() => teachersInvitedCount(undefined, 'owner@example.com')).not.toThrow()
    expect(teachersInvitedCount(undefined, 'owner@example.com')).toBe(0)
  })

  test('empty classesDraft array → 0', () => {
    expect(teachersInvitedCount([], 'owner@example.com')).toBe(0)
  })

  test('Founder self-injection (Winston-W4): row 0 teacherEmail = user.email → excluded, count 0 not 1', () => {
    const draft = rowsFor(['founder@example.com'])
    expect(teachersInvitedCount(draft, 'founder@example.com')).toBe(0)
  })

  test('null teacherEmail rows → skipped (filter with != null)', () => {
    const draft = rowsFor([null, null, 'bob@example.com'])
    expect(teachersInvitedCount(draft, 'owner@example.com')).toBe(1)
  })

  test('whitespace-only teacherEmail row → excluded (R1-C1-P20)', () => {
    const draft = rowsFor(['   ', '\t', '\n', 'bob@example.com'])
    expect(teachersInvitedCount(draft, 'owner@example.com')).toBe(1)
  })

  test('duplicate emails across classes → counted once (R1-C1-P24 Set-based dedup)', () => {
    const draft = rowsFor([
      'bob@example.com',
      'bob@example.com',
      'BOB@example.com',
      '  bob@EXAMPLE.com  ',
      'alice@example.com',
    ])
    expect(teachersInvitedCount(draft, 'owner@example.com')).toBe(2)
  })

  test('null userEmail (boot-probe) → count everything dedup\'d (W-S3 defensive fallback)', () => {
    const draft = rowsFor(['bob@example.com', 'alice@example.com', 'bob@example.com'])
    expect(teachersInvitedCount(draft, null)).toBe(2)
  })

  test('undefined userEmail → same fallback as null', () => {
    const draft = rowsFor(['bob@example.com', 'alice@example.com'])
    expect(teachersInvitedCount(draft, undefined)).toBe(2)
  })

  test('empty-string userEmail → same fallback (defensive against trim-to-empty)', () => {
    const draft = rowsFor(['bob@example.com', 'alice@example.com'])
    expect(teachersInvitedCount(draft, '')).toBe(2)
  })

  test('mixed real-world Operator scenario: 3 classes, 2 unique teachers, 1 Founder self, 1 whitespace', () => {
    const draft = rowsFor([
      'owner@example.com', // self — excluded
      'bob@example.com',
      '   ', // whitespace — excluded
      'alice@example.com',
      'BOB@example.com', // dup of bob — dedup
    ])
    expect(teachersInvitedCount(draft, 'owner@example.com')).toBe(2)
  })
})
