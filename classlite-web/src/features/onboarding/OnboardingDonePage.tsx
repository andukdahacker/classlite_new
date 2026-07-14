/**
 * OnboardingDonePage — Story 2-3c AC1 / AC2 / AC3 / AC9 / AC11, Task 2.1.
 *
 * Terminal `/setup/done` celebration screen (s04 Operator/Founder, s06 Solo
 * per UX §8.1). Consumes the state 2-3b's terminal spawn/first-class PUT
 * already wrote (`currentStep: 'done'` + `templateDraft.spawnedClassIds`)
 * and renders a `<DoneHeroPanel>` — center-name headline, stat strip, and
 * "Open Dashboard →" primary CTA.
 *
 * Deep-import discipline (W-S4): imports `useOnboardingProgress` from the
 * deep path, NOT via `@/features/onboarding` barrel.
 *
 * AC2 6-branch guard ladder + navigate-only latch semantics (W-B3):
 *   Guard 0   — early-out on !progress.data
 *   Guard 0b  — boot-probe compound gate `!inFlight`
 *   Branch 1  — persona === null → /welcome
 *   Branch 2  — session?.center == null → /setup/center
 *   Branch 3  — currentStep !== 'done' → dispatch by persona × step; corrupt
 *               persona × step combos route to /welcome + Sentry breadcrumb
 *               (Round 1 code-review P23 — R1-C1-P23)
 *   Branch 4  — spawnedClassIds empty|undefined|non-array → visible fail state
 *   Branch 5  — stay + render DoneHeroPanel
 *
 * hasRoutedOnMountRef is set ONLY inside navigate(...) branches (1/2/3). The
 * ref resets on unmount so back-nav to /setup/done re-runs the ladder against
 * fresh data (R1-C1-P10). Branches 4/5 do NOT set the ref (R1-C1-P1) so
 * subsequent refetches (tab focus / auth invalidation) re-check the ladder.
 *
 * On progress.isError — do NOT auto-route; render Alert with retry (AC9).
 * Persistent-failure ratchet (M-B3) — counts REFETCH FAILURES via a
 * transition-tracked effect (R1-C1-P4), not click count. Resets on success.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { addBreadcrumb } from '@sentry/react'
import { authKeys } from '@/features/auth/api/authKeys'
import { useAuth } from '@/hooks/useAuth'
import { useOnboardingProgress } from '@/features/onboarding/api/useOnboardingProgress'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import { teachersInvitedCount } from '@/lib/teachersInvitedCount'
import DoneHeroPanel, {
  type DoneHeroPersona,
} from '@/features/onboarding/components/DoneHeroPanel'

type Persona = DoneHeroPersona
type CurrentStep =
  | 'persona'
  | 'center'
  | 'template'
  | 'spawn'
  | 'solo_first_class'
  | 'done'

const PERSISTENT_FAILURE_THRESHOLD = 3

function OnboardingDonePageSkeleton() {
  return (
    <section
      data-testid="skeleton-done"
      aria-busy="true"
      className="mx-auto max-w-2xl px-4 py-16 text-center"
    >
      <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-slate-200" />
      <div className="mx-auto mt-6 h-8 w-64 animate-pulse rounded bg-slate-200" />
      <div className="mx-auto mt-4 h-4 w-80 animate-pulse rounded bg-slate-200" />
      <div className="mx-auto mt-10 grid max-w-lg grid-cols-3 gap-4">
        <div className="h-20 animate-pulse rounded bg-slate-200" />
        <div className="h-20 animate-pulse rounded bg-slate-200" />
        <div className="h-20 animate-pulse rounded bg-slate-200" />
      </div>
    </section>
  )
}

interface ErrorAlertProps {
  message: string
  onRetry: () => void
  retryLabel: string
  persistent: boolean
  disabled: boolean
}

// R1-C1-P13: focus-move on mount so SR reliably announces the state change
// (belt for role="alert"'s implicit aria-live; some SR/browser combos miss
// role="alert" content that mounts at initial-page settle).
function ErrorAlert({
  message,
  onRetry,
  retryLabel,
  persistent,
  disabled,
}: ErrorAlertProps) {
  const alertRef = useRef<HTMLElement>(null)
  useEffect(() => {
    alertRef.current?.focus()
  }, [])
  return (
    <section
      ref={alertRef}
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      data-testid={persistent ? 'done-error-persistent' : 'done-error'}
      className="mx-auto mt-16 max-w-lg rounded-md border border-amber-300 bg-amber-50 p-6 text-center focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
    >
      <p className="text-sm text-slate-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        className="mt-4 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {retryLabel}
      </button>
    </section>
  )
}

interface SetupIncompleteAlertProps {
  onRetry: () => void
  onContinueToDashboard: () => void
  retryDisabled: boolean
}

function SetupIncompleteAlert({
  onRetry,
  onContinueToDashboard,
  retryDisabled,
}: SetupIncompleteAlertProps) {
  const { t } = useTranslation()
  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto mt-16 max-w-lg rounded-md border border-amber-300 bg-amber-50 p-6 text-center"
    >
      <p className="text-sm text-slate-800">
        {t('onboarding.done.error.setupIncomplete')}
      </p>
      <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('onboarding.done.error.retryCta')}
        </button>
        <button
          type="button"
          onClick={onContinueToDashboard}
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          {t('onboarding.done.error.continueToDashboardCta')}
        </button>
      </div>
    </section>
  )
}

// R1-C1-P23: logically-impossible persona × step combos route to /welcome; the
// caller emits a Sentry breadcrumb so we notice corrupted state at scale.
// Legitimate `step === 'persona'` (no persona picked yet) also routes to
// /welcome but is NOT flagged as corruption at the caller (that's the normal
// resume-to-persona case).
function dispatchNonDoneStep(persona: Persona, step: CurrentStep): string {
  if (step === 'persona') return '/welcome'

  if (persona === 'solo_teacher') {
    if (step === 'center') return '/setup/center'
    if (step === 'solo_first_class') return '/setup/first-class'
    // Solo × (template | spawn) = corruption
    return '/welcome'
  }

  // Operator + Founder
  if (step === 'center') return '/setup/center'
  if (step === 'template') return '/setup/template'
  if (step === 'spawn') return '/setup/spawn'
  // Operator|Founder × solo_first_class = corruption
  return '/welcome'
}

// Story 2-4 W-BLOCKER-3 pragmatic port: this file's private
// `deriveTeachersInvitedCount` moved to `@/lib/teachersInvitedCount` so BOTH
// Story 2-3c (this page) AND Story 2-4 (dashboard checklist) consume the same
// implementation. Behavior unchanged — full case-insensitive + trim + Set
// dedup + whitespace filter + null-user fallback lives in the shared lib.

export default function OnboardingDonePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isLoading: authLoading, session, user } = useAuth()
  const progress = useOnboardingProgress()

  const sessionKnown =
    queryClient.getQueryState(authKeys.session()) !== undefined
  const inFlight = authLoading || !sessionKnown || progress.isLoading

  const hasRoutedOnMountRef = useRef(false)

  // R1-C1-P10: reset latch on unmount so route re-entry re-runs the ladder.
  useEffect(() => {
    return () => {
      hasRoutedOnMountRef.current = false
    }
  }, [])

  // R1-C1-P4: ratchet counts REFETCH FAILURES, not raw click count. Increments
  // only when a click-triggered refetch settles with error; resets on success.
  // Combined with `disabled={progress.isFetching}` on the retry button
  // (R1-C1-P9), 1 click = 1 refetch = 1 settled outcome — so click-triggered
  // counting is a lint-clean equivalent of "3 refetch failures" (avoids the
  // React 19 `react-hooks/set-state-in-effect` boundary that D4 documented).
  // Background refetches (window focus) don't participate — an acceptable
  // narrow gap.
  const [retryCount, setRetryCount] = useState(0)
  const persistent = retryCount >= PERSISTENT_FAILURE_THRESHOLD

  const handleRetry = async () => {
    const result = await progress.refetch()
    if (result.isSuccess) {
      setRetryCount(0)
    } else if (result.isError) {
      setRetryCount((n) => n + 1)
    }
  }

  // R1-C1-P12: Sentry breadcrumb fires ONCE on persistent transition.
  const breadcrumbFiredRef = useRef(false)
  useEffect(() => {
    if (persistent && !breadcrumbFiredRef.current) {
      breadcrumbFiredRef.current = true
      addBreadcrumb({
        category: 'onboarding',
        message: 'done-page-persistent-failure',
        level: 'warning',
        data: { retryCount },
      })
    }
  }, [persistent, retryCount])

  // AC2 6-branch resume-routing ladder.
  useEffect(() => {
    if (hasRoutedOnMountRef.current) return
    if (inFlight) return
    if (progress.isError) return
    if (!progress.data) return

    const persona = progress.data.persona as Persona | null
    const currentStep = progress.data.currentStep as CurrentStep

    if (persona === null) {
      hasRoutedOnMountRef.current = true
      navigate('/welcome', { replace: true })
      return
    }

    if (session?.center == null) {
      hasRoutedOnMountRef.current = true
      navigate('/setup/center', { replace: true })
      return
    }

    if (currentStep !== 'done') {
      const target = dispatchNonDoneStep(persona, currentStep)
      // R1-C1-P23: /welcome from a non-persona step = state corruption.
      if (target === '/welcome' && currentStep !== 'persona') {
        addBreadcrumb({
          category: 'onboarding',
          message: 'done-page-corrupt-step',
          level: 'warning',
          data: { persona, currentStep },
        })
      }
      hasRoutedOnMountRef.current = true
      navigate(target, { replace: true })
      return
    }

    // Branches 4/5 — DO NOT set hasRoutedOnMountRef (R1-C1-P1).
  }, [
    inFlight,
    progress.isError,
    progress.data,
    session?.center,
    navigate,
  ])

  // Render layer.

  if (inFlight) {
    return <OnboardingDonePageSkeleton />
  }

  if (progress.isError) {
    const requestId =
      (progress.error as { requestId?: string } | undefined)?.requestId ?? ''
    // R1-C1-P8: split into two keys so an empty requestId doesn't produce
    // "(request ID: )".
    const message = requestId
      ? t('onboarding.done.error.genericWithRequestId', { requestId })
      : t('onboarding.done.error.generic')
    return (
      <ErrorAlert
        persistent={persistent}
        message={message}
        retryLabel={t('onboarding.done.error.retryCta')}
        disabled={progress.isFetching}
        onRetry={() => {
          void handleRetry()
        }}
      />
    )
  }

  if (!progress.data) {
    return <OnboardingDonePageSkeleton />
  }

  const persona = progress.data.persona as Persona | null
  const currentStep = progress.data.currentStep as CurrentStep
  const payload = progress.data.payload as {
    templateDraft?: TemplateDraftPayload | null
  } | null

  if (persona === null) return <OnboardingDonePageSkeleton />
  if (!session?.center) return <OnboardingDonePageSkeleton />
  if (currentStep !== 'done') return <OnboardingDonePageSkeleton />

  const templateDraft = payload?.templateDraft ?? undefined
  const spawnedClassIds = templateDraft?.spawnedClassIds

  // R1-C1-P21: also guard non-array truthy values (tampered payload).
  if (
    spawnedClassIds === undefined ||
    !Array.isArray(spawnedClassIds) ||
    spawnedClassIds.length === 0
  ) {
    return (
      <SetupIncompleteAlert
        retryDisabled={progress.isFetching}
        onRetry={() => {
          void progress.refetch()
        }}
        onContinueToDashboard={() => {
          navigate('/dashboard', { replace: true })
        }}
      />
    )
  }

  if (!user) return <OnboardingDonePageSkeleton />

  const classCount = spawnedClassIds.length
  const teachersInvitedCountValue = teachersInvitedCount(
    templateDraft?.classesDraft,
    user.email,
  )

  // R1-C1-P2 + R1-C1-P3: NO stableProps render-latch — re-derive on every
  // render. Refetches that transiently narrow progress.data render skeleton
  // via defensive bounce branches above, then re-render the panel when data
  // resolves. Satisfies AC2 W-B3 "guard re-fires on session ageing" —
  // render layer stays reactive to progress.data changes.
  return (
    <DoneHeroPanel
      centerName={session.center.name}
      shortCode={session.center.shortCode}
      persona={persona}
      classCount={classCount}
      teachersInvitedCount={teachersInvitedCountValue}
      onOpenDashboard={() => {
        navigate('/dashboard', { replace: true })
      }}
    />
  )
}
