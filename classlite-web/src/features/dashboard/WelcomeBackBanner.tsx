/**
 * WelcomeBackBanner — extracted from the shipped Story 2-3a/b/c
 * `TeacherDashboard.tsx` welcome-back logic (Task 6.1 fold, S-STRONG-11
 * per-persona body split precursor).
 *
 * Renders the "resume onboarding" banner when a user with an incomplete
 * wizard state lands on `/dashboard`. Three shipped branches, unchanged
 * from 2-3a AC11 / 2-3b R1-P38 / 2-3c R1-P8:
 *
 *   - `midWizardNoCenter` — persona picked, no center → CTA to `/setup/center`
 *   - `postCenterIncomplete` — center exists, currentStep !== 'done' → CTA
 *     persona-derived (`/setup/template` or `/setup/first-class`)
 *   - `progressUnknownNoCenter` — progress GET failed AND no center →
 *     fall-back to `/setup/center`
 *
 * Copy uses the AC13-renamed `dashboard.welcomeBack.*` keys (was
 * `dashboard.finishSetup.*` pre-rename).
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export type BannerBranch =
  | 'midWizardNoCenter'
  | 'postCenterIncomplete'
  | 'progressUnknownNoCenter'

export interface WelcomeBackBannerProps {
  branch: BannerBranch
  persona: 'operator' | 'founder' | 'solo_teacher' | null
}

export default function WelcomeBackBanner({
  branch,
  persona,
}: WelcomeBackBannerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const isPostCenterIncomplete = branch === 'postCenterIncomplete'
  const isAwaitingNextStep = isPostCenterIncomplete && persona === null

  const goResume = (): void => {
    if (branch === 'midWizardNoCenter' || branch === 'progressUnknownNoCenter') {
      navigate('/setup/center', { replace: true })
      return
    }
    // postCenterIncomplete with persona known
    const target =
      persona === 'solo_teacher' ? '/setup/first-class' : '/setup/template'
    navigate(target, { replace: true })
  }

  return (
    <div
      data-testid="dashboard-finish-setup-banner"
      role="status"
      className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-800">
          {isAwaitingNextStep
            ? t('dashboard.welcomeBack.awaitingNextStep')
            : t('dashboard.welcomeBack.banner')}
        </p>
        {!isAwaitingNextStep ? (
          <button
            type="button"
            onClick={goResume}
            className="text-sm font-medium text-slate-900 underline"
            data-testid="dashboard-finish-setup-cta"
          >
            {t('dashboard.welcomeBack.continueCta')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
