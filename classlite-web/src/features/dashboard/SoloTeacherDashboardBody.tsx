/**
 * SoloTeacherDashboardBody — Story 2-4 Task 6.2 (S-STRONG-11 UX-3 fold).
 *
 * Solo Teacher composition — 4-item checklist + AI-graded essay preview +
 * Your Classes row. Same layout as Founder; checklist enumeration is
 * shorter (per checklistDefinition.ts).
 */
import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import FirstAIGradeCard from '@/features/dashboard/FirstAIGradeCard'
import YourClassesRow from '@/features/dashboard/YourClassesRow'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

export interface SoloTeacherDashboardBodyProps {
  userId: string | null
  ctx: ChecklistCtx
  centerName: string
  classesDraft: TemplateDraftPayload['classesDraft'] | undefined
}

export default function SoloTeacherDashboardBody({
  userId,
  ctx,
  centerName,
  classesDraft,
}: SoloTeacherDashboardBodyProps) {
  return (
    <div className="mt-6 space-y-6">
      <FinishSetupCard persona="solo_teacher" userId={userId} ctx={ctx} />
      <FirstAIGradeCard />
      <YourClassesRow centerName={centerName} classesDraft={classesDraft} />
    </div>
  )
}
