/**
 * teachersInvitedCount — shared derivation of "unique teachers invited" from
 * a classesDraft payload, given the current user's email for self-exclusion.
 *
 * Story 2-4 W-BLOCKER-3 pragmatic fold: extracted from
 * `OnboardingDonePage.tsx:188-206` (Story 2-3c Round 1 hardened) into a
 * shared-lib location so BOTH the dashboard checklist (2-4) AND the
 * onboarding done page (2-3c) consume the same implementation. Dual-impl
 * drift is worse than a one-commit refactor.
 *
 * Contract — carries all 2-3c R1 hardening verbatim:
 *   - Case-insensitive normalization (`toLowerCase`)
 *   - Whitespace trim
 *   - Set-based dedup (a teacher assigned to N classes counts as 1 invite;
 *     copy "M teachers invited" reads more honestly as a people count).
 *     R1-C1-P24.
 *   - Whitespace-only teacherEmail rows excluded (R1-C1-P20).
 *   - Self-exclusion when a row's normalized email matches the user's email
 *     (Winston-W4 — Founder row 0 draft has `teacherEmail = user.email`
 *     while the wire ships `null`).
 *   - Null-user boot-probe fallback (W-S3): when `userEmail` is null /
 *     undefined / empty, fall back to "count everything (dedup'd)" —
 *     misfiring self-exclusion on a transient boot-probe tick would
 *     under-count on legitimate rows.
 *
 * Consumers must NOT re-implement this logic. Story 2-3c
 * `OnboardingDonePage.tsx` imports from here; Story 2-4
 * `checklistDefinition.ts` builds `ChecklistCtx.teachersInvitedCount` by
 * calling this. Any behavior change requires updating BOTH consumers'
 * test suites.
 */
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

type ClassesDraft = TemplateDraftPayload['classesDraft']

export function teachersInvitedCount(
  classesDraft: ClassesDraft | null | undefined,
  userEmail: string | null | undefined,
): number {
  if (classesDraft == null) return 0
  const selfEmail = userEmail?.toLowerCase().trim() ?? ''
  const uniqueEmails = new Set<string>()
  for (const row of classesDraft) {
    // Wire-drift resilience — a sparse/malformed classesDraft (upstream bug,
    // stale payload during migration) must not crash the whole dashboard.
    if (row == null) continue
    if (typeof row.teacherEmail !== 'string') continue
    const normalized = row.teacherEmail.toLowerCase().trim()
    if (normalized === '') continue
    if (selfEmail !== '' && normalized === selfEmail) continue
    uniqueEmails.add(normalized)
  }
  return uniqueEmails.size
}
