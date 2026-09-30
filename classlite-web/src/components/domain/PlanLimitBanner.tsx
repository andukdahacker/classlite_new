/**
 * PlanLimitBanner — Story 9-1b (AC12/AC13, D-9-1b-2). A non-blocking,
 * dismissible strip for a class whose enrolment is filling up. It shows CALM,
 * FACTUAL, present-tense usage — "18 of 20 students" — and a neutral "Split
 * into 2 classes" suggestion.
 *
 * Deliberately NO "limit" / "approaching" / wall language and NO upgrade CTA:
 * enforcement is dark-launched OFF in 9-1b (D19), so the wall does not bite yet
 * — showing "approaching limit" while the wall is dark would be crying wolf.
 * 9.2 (which arms enforcement) escalates this copy to the amber "approaching
 * limit" framing + an upgrade path. The count is a pure client comparison of
 * the per-class enrolment vs `limits.studentsPerClass` (D4/D22) — the server is
 * not consulted for a threshold.
 *
 * Domain tier — no feature imports (FW-7). Role-appropriate copy but neither
 * role is told to "upgrade" here (AC13); the "billing is the owner's job" voice
 * is shared with the non-owner 409 dialog and PermissionDenied (AC19).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export interface PlanLimitBannerProps {
  /** Current enrolled students in this class. */
  current: number
  /** The per-class student ceiling (`limits.studentsPerClass`). */
  max: number
  /** Called when the actor dismisses the banner (defaults to local hide). */
  onDismiss?: () => void
}

export function PlanLimitBanner({
  current,
  max,
  onDismiss,
}: PlanLimitBannerProps): ReactElement | null {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
      data-testid="plan-limit-banner"
    >
      <span className="tabular-nums">
        {t('billing.banner.studentCount', { current, max })}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-slate-500">{t('billing.banner.splitSuggestion')}</span>
        <button
          type="button"
          className="text-slate-400 hover:text-slate-600"
          aria-label={t('billing.banner.dismiss')}
          onClick={() => {
            setDismissed(true)
            onDismiss?.()
          }}
        >
          {t('billing.banner.dismiss')}
        </button>
      </div>
    </div>
  )
}
