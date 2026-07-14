/**
 * OperatorDashboardBody — Story 2-4 Task 6.2 (S-STRONG-11 UX-3 fold).
 *
 * Composes the Operator persona's post-onboarding surface:
 *   1. `<FinishSetupCard>` (visibility gate lives inside the card)
 *   2. `<SampleDashboardPreview>` (ghosted analytics — Operator's value)
 *   3. `<YourClassesRow>` (up to 2 spawned classes)
 *
 * Extracted now (not deferred to Story 2.6) so the per-role route split
 * later becomes a routing swap, not a body rewrite.
 */
import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import SampleDashboardPreview from '@/features/dashboard/SampleDashboardPreview'
import YourClassesRow from '@/features/dashboard/YourClassesRow'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

export interface OperatorDashboardBodyProps {
  userId: string | null
  ctx: ChecklistCtx
  centerName: string
  classesDraft: TemplateDraftPayload['classesDraft'] | undefined
}

export default function OperatorDashboardBody({
  userId,
  ctx,
  centerName,
  classesDraft,
}: OperatorDashboardBodyProps) {
  return (
    <div className="mt-6 space-y-6">
      <FinishSetupCard persona="operator" userId={userId} ctx={ctx} />
      <SampleDashboardPreview />
      <YourClassesRow centerName={centerName} classesDraft={classesDraft} />
    </div>
  )
}
