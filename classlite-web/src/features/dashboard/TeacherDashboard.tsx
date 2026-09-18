/**
 * TeacherDashboard — root of the teacher lazy bundle group; mounted by
 * `DashboardRoute` for role `teacher`.
 *
 * Story 8-1b (D2) splits this into two surfaces over the ONE `useDashboard`
 * fetch, keyed off onboarding progress:
 *
 *   - Onboarding INCOMPLETE (a pre-`done` step, a done-without-persona, or an
 *     unknown-progress-without-center) → the PRESERVED Epic-2 shell: the
 *     `WelcomeBackBanner` (Story 2-4/2-5a machinery, unchanged). The banner-
 *     branch computation below is carried over verbatim, including the
 *     center-durability resume-routing fallback.
 *   - Onboarding COMPLETE (`done` + persona) — or an authenticated teacher whose
 *     progress can't be pinned as incomplete (error/unknown but a center
 *     exists) → the real s06 teaching dashboard (`RealTeacherDashboard`:
 *     week-strip + 3 rails), in place of the old persona-preview bodies.
 *
 * The Epic-2 persona-value preview bodies (`SampleDashboardPreview` /
 * `FirstAIGradeCard` / persona `*DashboardBody`) are no longer mounted here per
 * the D2 ruling ("the real dashboard with UX-1 empty states, not the ghost
 * preview") — the components remain in the repo (with their own stories/tests)
 * and are not deleted.
 */
import { useTranslation } from 'react-i18next'
import { useOnboardingProgress } from '@/features/onboarding/api/useOnboardingProgress'
import { useAuth } from '@/hooks/useAuth'
import { useSessionCenter, useSessionUser } from '@/hooks/useRole'
import { teachersInvitedCount } from '@/lib/teachersInvitedCount'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import WelcomeBackBanner, {
  type BannerBranch,
} from '@/features/dashboard/WelcomeBackBanner'
import { DashboardSkeleton } from '@/features/dashboard/components/DashboardStates'
import { RealTeacherDashboard } from '@/features/dashboard/RealTeacherDashboard'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'

type Persona = 'operator' | 'founder' | 'solo_teacher'
type CurrentStep =
  | 'persona'
  | 'center'
  | 'template'
  | 'spawn'
  | 'solo_first_class'
  | 'done'

interface ProgressData {
  currentStep?: CurrentStep
  persona?: Persona | null
  payload?: { templateDraft?: TemplateDraftPayload | null } | null
}

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const progress = useOnboardingProgress()
  const currentCenter = useSessionCenter()
  const { isLoading: authLoading } = useAuth()
  const user = useSessionUser()

  const progressData = progress.data as ProgressData | undefined
  const currentStep = progressData?.currentStep
  const stepIsDone = currentStep === 'done'
  const persona = progressData?.persona ?? null

  // ------ Loading ------ (session boot-probe OR progress in flight)
  if (authLoading || progress.isLoading) {
    return <DashboardSkeleton />
  }

  // ------ Welcome-back banner branches (Story 2-4 AC1 matrix, unchanged) ------
  // "Does a center exist?" must NOT rely on `currentCenter` (session.center)
  // alone: the wizard only advances PAST `center` after CreateCenter succeeds,
  // so any later step is proof a center exists — a signal that survives a reload
  // even if session.center hasn't rehydrated yet.
  const centerCreatedByStep =
    currentStep !== undefined &&
    currentStep !== 'persona' &&
    currentStep !== 'center'
  const centerExists = currentCenter !== null || centerCreatedByStep

  const midWizardNoCenter =
    !centerExists && currentStep !== undefined && !stepIsDone
  const postCenterIncomplete =
    centerExists && currentStep !== undefined && !stepIsDone
  const progressUnknownNoCenter =
    currentCenter === null && !centerCreatedByStep && progress.isError

  let bannerBranch: BannerBranch | null = null
  if (midWizardNoCenter) bannerBranch = 'midWizardNoCenter'
  else if (postCenterIncomplete) bannerBranch = 'postCenterIncomplete'
  else if (progressUnknownNoCenter) bannerBranch = 'progressUnknownNoCenter'

  // AC1 cell 4: currentStep === 'done' but persona is null → awaiting-next-step.
  const awaitingNextStep = centerExists && stepIsDone && persona === null
  if (awaitingNextStep) bannerBranch = 'postCenterIncomplete'

  // ------ Onboarding-incomplete shell (PRESERVED) ------
  if (bannerBranch !== null) {
    const displayName = user?.fullName ?? user?.email ?? ''
    return (
      <div data-testid="teacher-dashboard">
        <WelcomeBackBanner branch={bannerBranch} persona={persona} />
        <h1
          data-testid="teacher-dashboard-heading"
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
        >
          {t('dashboard.welcomeHeading', { name: displayName })}
        </h1>
      </div>
    )
  }

  // ------ Onboarding complete / authenticated-with-center → real dashboard ------
  // The finish-setup checklist rides along as a secondary strip (Ducdo
  // 2026-09-16): once a persona is known, hand RealTeacherDashboard the
  // checklist context so FinishSetupCard can coexist with the real dashboard
  // (it self-hides when snoozed / no center). `persona === null` (the awaiting
  // branch already routed to the banner above) → no strip.
  const templateDraft = progressData?.payload?.templateDraft ?? null
  const checklistCtx: ChecklistCtx | null =
    persona !== null && currentCenter !== null
      ? {
          currentCenter,
          templateDraft,
          teachersInvitedCount: teachersInvitedCount(
            templateDraft?.classesDraft,
            user?.email,
          ),
        }
      : null

  return <RealTeacherDashboard persona={persona} checklistCtx={checklistCtx} />
}
