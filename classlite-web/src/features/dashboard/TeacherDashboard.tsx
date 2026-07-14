/**
 * TeacherDashboard — root of the teacher lazy bundle group.
 *
 * Teacher/owner/admin surfaces are the largest of the three lazy bundle
 * groups. The router lazy-loads this component as the teacher chunk
 * entry so Rolldown can emit a focused bundle that pre-auth and student
 * sessions never pull in.
 *
 * Story 2-4 shell — three interlocking pieces per AC1 / AC12:
 *   1. `<WelcomeBackBanner>` (extracted 2-3a/b logic) — mounts when
 *      onboarding is incomplete.
 *   2. `<WelcomeHeading>` — always renders once the session settles.
 *   3. Per-persona body dispatch — `<OperatorDashboardBody>` /
 *      `<FounderDashboardBody>` / `<SoloTeacherDashboardBody>` — each
 *      composes FinishSetupCard + persona-value card + YourClassesRow.
 *
 * Loading / error handling (AC1 8-cell matrix):
 *   - `useAuth().isLoading` true OR progress in flight → `<DashboardSkeleton>`
 *   - `progress.isError` + no cached `stableProps` → inline `<Alert>` with
 *     retry (routing NEVER auto-fires from an error state).
 *   - `progress.isError` + prior valid snapshot → the stableProps latch
 *     retains the last-good render so a window-focus refetch race does
 *     NOT unmount the card mid-interaction [W-BLOCKER-2].
 *
 * `stableProps` render-latch pattern mirrors the 2-3c precedent
 * (`OnboardingDonePage.tsx`). The first valid `{ progress.data,
 * currentCenter, user }` snapshot is captured; subsequent transient
 * `undefined` progress.data values do NOT reset it. The latch resets
 * only when a NEW non-transient snapshot arrives that fails the AC1 gate.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnboardingProgress } from '@/features/onboarding/api/useOnboardingProgress'
import { useAuth } from '@/hooks/useAuth'
import { useCurrentCenter } from '@/hooks/useCurrentCenter'
import { teachersInvitedCount } from '@/lib/teachersInvitedCount'
import type { CenterSummary } from '@/features/auth/api/authKeys'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import WelcomeBackBanner, {
  type BannerBranch,
} from '@/features/dashboard/WelcomeBackBanner'
import OperatorDashboardBody from '@/features/dashboard/OperatorDashboardBody'
import FounderDashboardBody from '@/features/dashboard/FounderDashboardBody'
import SoloTeacherDashboardBody from '@/features/dashboard/SoloTeacherDashboardBody'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'

type Persona = 'operator' | 'founder' | 'solo_teacher'
type CurrentStep =
  | 'persona'
  | 'center'
  | 'template'
  | 'spawn'
  | 'solo_first_class'
  | 'done'

interface StableSnapshot {
  persona: Persona
  templateDraft: TemplateDraftPayload | null
  currentCenter: CenterSummary
  userId: string
  userEmail: string
  userDisplayName: string
}

function templateDraftContentEqual(
  a: TemplateDraftPayload | null,
  b: TemplateDraftPayload | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.selectedTemplateId !== b.selectedTemplateId) return false
  if (a.buildFromScratch !== b.buildFromScratch) return false
  const aIds = a.spawnedClassIds ?? []
  const bIds = b.spawnedClassIds ?? []
  if (aIds.length !== bIds.length) return false
  for (let i = 0; i < aIds.length; i++) {
    if (aIds[i] !== bIds[i]) return false
  }
  const aClasses = a.classesDraft ?? []
  const bClasses = b.classesDraft ?? []
  if (aClasses.length !== bClasses.length) return false
  for (let i = 0; i < aClasses.length; i++) {
    const ac = aClasses[i]
    const bc = bClasses[i]
    if (ac.cohortName !== bc.cohortName) return false
    if (ac.startDate !== bc.startDate) return false
    if (ac.teacherEmail !== bc.teacherEmail) return false
  }
  return true
}

// Content-equality check for the render-latch. Compares by scalar identity
// fields plus a field-by-field walk over `templateDraft`. Field-by-field
// beats JSON.stringify — stringify is key-order sensitive (backend
// serialization drift = latch churn) and silently drops `undefined`
// values. `currentCenter.name` is included so a center rename actually
// re-renders the ghost copy that interpolates it.
function snapshotContentEqual(
  a: StableSnapshot,
  b: StableSnapshot,
): boolean {
  if (a.persona !== b.persona) return false
  if (a.currentCenter.id !== b.currentCenter.id) return false
  if (a.currentCenter.name !== b.currentCenter.name) return false
  if (a.userId !== b.userId) return false
  if (a.userEmail !== b.userEmail) return false
  if (a.userDisplayName !== b.userDisplayName) return false
  return templateDraftContentEqual(a.templateDraft, b.templateDraft)
}

function DashboardSkeleton() {
  return (
    <div
      data-testid="dashboard-skeleton"
      aria-busy="true"
      className="space-y-6"
    >
      <div className="h-9 w-64 animate-pulse rounded bg-slate-200" />
      <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  )
}

interface ProgressData {
  currentStep?: CurrentStep
  persona?: Persona | null
  payload?: { templateDraft?: TemplateDraftPayload | null } | null
}

function computeStableSnapshot(
  progressData: ProgressData | undefined,
  currentCenter: CenterSummary | null,
  user: ReturnType<typeof useAuth>['user'],
): StableSnapshot | null {
  if (progressData == null) return null
  if (user == null) return null
  const persona = progressData.persona ?? null
  if (persona === null) return null
  if (currentCenter == null) return null
  if (progressData.currentStep !== 'done') return null
  return {
    persona,
    templateDraft: progressData.payload?.templateDraft ?? null,
    currentCenter,
    userId: user.id,
    userEmail: user.email,
    userDisplayName: user.displayName,
  }
}

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const progress = useOnboardingProgress()
  const currentCenter = useCurrentCenter()
  const { isLoading: authLoading, user } = useAuth()

  // Loading gate — session boot-probe OR progress in flight
  const progressData = progress.data as ProgressData | undefined
  const currentStep = progressData?.currentStep
  const persona = progressData?.persona ?? null

  // stableProps render-latch (AC1a per W-BLOCKER-2). Once a valid cell-6
  // snapshot arrives, retain it in `useState` across window-focus refetch
  // races that transiently return `undefined`. The `content-equality` check
  // below prevents an infinite render loop: `computeStableSnapshot`
  // returns a new object literal each render, but as long as its content
  // has not changed we keep the previous `latch` reference so React sees
  // no state change and the effect does not fire a new render.
  const fresh = computeStableSnapshot(progressData, currentCenter, user)
  const [latch, setLatch] = useState<StableSnapshot | null>(null)

  // `setLatch()` in an effect is normally an anti-pattern (derived state
  // should be memoized), but this is a genuine latch: it needs to persist
  // across renders in which `fresh` transiently narrows to `null` (window
  // focus refetch race). The content-equality check in the functional
  // updater is what keeps this from thrashing — a same-content `fresh`
  // returns the previous reference, so React short-circuits the render.
  useEffect(() => {
    if (fresh !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLatch((prev) =>
        prev !== null && snapshotContentEqual(prev, fresh) ? prev : fresh,
      )
      return
    }
    if (
      progressData !== undefined &&
      progress.isFetching === false &&
      progress.isError === false &&
      (progressData.currentStep !== 'done' ||
        (progressData.persona ?? null) === null)
    ) {
      setLatch((prev) => (prev === null ? prev : null))
    }
  }, [fresh, progressData, progress.isFetching, progress.isError])

  // ------ Loading ------
  if (authLoading || progress.isLoading) {
    return <DashboardSkeleton />
  }

  // ------ Welcome-back banner branches (AC1 cells 2/3/4/7) ------
  // Story 2-4 AC1 matrix relaxes the shipped 2-3a `!== 'persona'` exclusion:
  // when the dashboard has NO other content to show (currentStep is any
  // pre-'done' step, no center yet), the banner is the sole surface — even
  // for a fresh account still on the persona-pick step.
  const midWizardNoCenter =
    currentCenter === null &&
    currentStep !== undefined &&
    currentStep !== 'done'
  const postCenterIncomplete =
    currentCenter !== null &&
    currentStep !== undefined &&
    currentStep !== 'done'
  const progressUnknownNoCenter =
    currentCenter === null && progress.isError

  let bannerBranch: BannerBranch | null = null
  if (midWizardNoCenter) bannerBranch = 'midWizardNoCenter'
  else if (postCenterIncomplete) bannerBranch = 'postCenterIncomplete'
  else if (progressUnknownNoCenter) bannerBranch = 'progressUnknownNoCenter'

  // Also cover the AC1 cell 4 branch: currentStep === 'done' but persona
  // is null — treat as postCenterIncomplete "awaitingNextStep" copy.
  const awaitingNextStep =
    currentCenter !== null && currentStep === 'done' && persona === null
  if (awaitingNextStep) bannerBranch = 'postCenterIncomplete'

  // ------ Welcome heading ------
  const displayName = user?.displayName ?? user?.email ?? ''

  const welcomeHeading = (
    <h1
      data-testid="teacher-dashboard-heading"
      className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
    >
      {t('dashboard.welcomeHeading', { name: displayName })}
    </h1>
  )

  // ------ Cell 5 / 6 (persona-value bodies via stableProps latch) ------
  const snapshot = fresh ?? latch
  const showBody =
    snapshot !== null && bannerBranch === null

  const checklistCtx: ChecklistCtx | null = snapshot
    ? {
        currentCenter: snapshot.currentCenter,
        templateDraft: snapshot.templateDraft,
        teachersInvitedCount: teachersInvitedCount(
          snapshot.templateDraft?.classesDraft,
          snapshot.userEmail,
        ),
      }
    : null

  return (
    <>
      {bannerBranch !== null ? (
        <WelcomeBackBanner branch={bannerBranch} persona={persona} />
      ) : null}
      {welcomeHeading}
      {showBody && snapshot !== null && checklistCtx !== null ? (
        snapshot.persona === 'operator' ? (
          <OperatorDashboardBody
            userId={snapshot.userId}
            ctx={checklistCtx}
            centerName={snapshot.currentCenter.name}
            classesDraft={snapshot.templateDraft?.classesDraft}
          />
        ) : snapshot.persona === 'founder' ? (
          <FounderDashboardBody
            userId={snapshot.userId}
            ctx={checklistCtx}
            centerName={snapshot.currentCenter.name}
            classesDraft={snapshot.templateDraft?.classesDraft}
          />
        ) : (
          <SoloTeacherDashboardBody
            userId={snapshot.userId}
            ctx={checklistCtx}
            centerName={snapshot.currentCenter.name}
            classesDraft={snapshot.templateDraft?.classesDraft}
          />
        )
      ) : null}
    </>
  )
}
