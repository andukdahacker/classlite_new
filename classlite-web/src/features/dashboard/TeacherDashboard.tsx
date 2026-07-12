/**
 * TeacherDashboard — root of the teacher lazy bundle group.
 *
 * Teacher/owner/admin surfaces are the largest of the three lazy bundle
 * groups. The router lazy-loads this component as the teacher chunk
 * entry so Rolldown can emit a focused bundle that pre-auth and student
 * sessions never pull in.
 *
 * Routing-level role gating (block teachers from `/student`, block
 * students from `/dashboard`, etc.) ships with Story 2-6 (roles &
 * authorization). Story 1-7b ships a single-heading placeholder.
 *
 * Story 2-3a AC11 (Sally-S3 fold) — welcome-back banner for users who
 * clicked "Save and finish later" in the onboarding wizard. Reads
 * `useOnboardingProgress()` + `useCurrentCenter()`:
 *   - Mid-wizard user (has picked persona but not created center) → banner
 *     "Continue setup →" navigates to `/setup/center`.
 *   - Post-center but pre-completion (center exists, currentStep !== 'done')
 *     → banner points at `/setup/template`.
 * The banner is the seam Story 2.4's "Finish setting up" card grows into.
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
// Deep import (rather than the `@/features/onboarding` barrel) so the
// teacher-dashboard chunk stays isolated from the onboarding pages. Winston-W5
// route-bundle-boundaries spec asserts this — importing from the barrel would
// drag OnboardingLayout / PersonaSelectPage / CenterSetupPage into the
// TeacherDashboard chunk. Deep import bypasses the barrel edge.
import { useOnboardingProgress } from '@/features/onboarding/api/useOnboardingProgress'
import { useCurrentCenter } from '@/hooks/useCurrentCenter'

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const progress = useOnboardingProgress()
  const currentCenter = useCurrentCenter()

  const currentStep = progress.data?.currentStep
  const persona = progress.data?.persona ?? null
  const midWizardNoCenter =
    currentCenter === null &&
    currentStep !== undefined &&
    currentStep !== 'persona' &&
    currentStep !== 'done'
  const postCenterIncomplete =
    currentCenter !== null &&
    currentStep !== undefined &&
    currentStep !== 'done'
  // R1-P8: fall back to a "resume" banner when the progress GET failed but
  // the user has no center — they need the affordance even when we can't
  // read the step field.
  const progressUnknownNoCenter =
    currentCenter === null && progress.isError

  const showBanner =
    midWizardNoCenter || postCenterIncomplete || progressUnknownNoCenter

  return (
    <>
      {showBanner ? (
        <div
          data-testid="dashboard-finish-setup-banner"
          role="status"
          className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-800">
              {postCenterIncomplete && persona === null
                ? // R1-P38 (R1-D2) + Amelia-S2 amendment: with 2-3b live, the
                  // CTA target is persona-derived. Persona=null retains the
                  // stopgap "awaitingNextStep" copy — no clear destination
                  // if the wire never persisted a persona.
                  t('dashboard.finishSetup.awaitingNextStep')
                : t('dashboard.finishSetup.banner')}
            </p>
            {midWizardNoCenter || progressUnknownNoCenter ? (
              <button
                type="button"
                onClick={() =>
                  navigate('/setup/center', { replace: true })
                }
                className="text-sm font-medium text-slate-900 underline"
                data-testid="dashboard-finish-setup-cta"
              >
                {t('dashboard.finishSetup.continueCta')}
              </button>
            ) : postCenterIncomplete && persona !== null ? (
              <button
                type="button"
                onClick={() => {
                  const target =
                    persona === 'solo_teacher'
                      ? '/setup/first-class'
                      : '/setup/template'
                  navigate(target, { replace: true })
                }}
                className="text-sm font-medium text-slate-900 underline"
                data-testid="dashboard-finish-setup-cta"
              >
                {t('dashboard.finishSetup.continueCta')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <h1
        data-testid="teacher-dashboard-heading"
        className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
      >
        {t('app.welcome')}
      </h1>
    </>
  )
}
