/**
 * FounderDashboardBody — Story 2-4 Task 6.2 (S-STRONG-11 UX-3 fold).
 *
 * Founder persona composition — checklist + AI-graded essay preview +
 * Your Classes row. Identical layout to Solo Teacher; differs only in
 * checklist enumeration (7 items vs 4).
 */
import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import FirstAIGradeCard from '@/features/dashboard/FirstAIGradeCard'
import YourClassesRow from '@/features/dashboard/YourClassesRow'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

export interface FounderDashboardBodyProps {
  userId: string | null
  ctx: ChecklistCtx
  centerName: string
  classesDraft: TemplateDraftPayload['classesDraft'] | undefined
}

export default function FounderDashboardBody({
  userId,
  ctx,
  centerName,
  classesDraft,
}: FounderDashboardBodyProps) {
  return (
    <div className="mt-6 space-y-6">
      <FinishSetupCard persona="founder" userId={userId} ctx={ctx} />
      <FirstAIGradeCard />
      <YourClassesRow centerName={centerName} classesDraft={classesDraft} />
    </div>
  )
}
