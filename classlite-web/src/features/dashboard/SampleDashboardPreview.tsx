/**
 * SampleDashboardPreview — Story 2-4 AC8.
 *
 * Mounted for the Operator persona below the FinishSetupCard. Renders a
 * 4-up "ghosted frame" pulse-stat strip (per UX §6.4) with em-dash values
 * and an amber threshold banner explaining the placeholder state. NO wire
 * dependency — Epic 8 wires real analytics.
 *
 * Rationale (AC8): a non-teaching Admin (Operator) wouldn't grade essays,
 * so the FirstAIGradeCard doesn't land. Center-pulse analytics is the
 * value they'll compound.
 */
import { useTranslation } from 'react-i18next'
import {
  sampleOwnerPreview,
  OWNER_PREVIEW_PLACEHOLDER,
} from '@/features/dashboard/lib/sampleOwnerPreview'

export default function SampleDashboardPreview() {
  const { t } = useTranslation()

  return (
    <section
      data-testid="dashboard-sample-preview"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="dashboard-sample-preview-title"
    >
      <p
        id="dashboard-sample-preview-title"
        className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-slate-800"
      >
        {t('dashboard.samplePreview.thresholdBanner')}
      </p>

      <ul
        className="grid grid-cols-2 gap-4 opacity-50 md:grid-cols-4"
        aria-hidden="false"
      >
        {sampleOwnerPreview.map((tile) => (
          <li
            key={tile.key}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center"
          >
            <p className="text-3xl font-semibold text-slate-400">
              {OWNER_PREVIEW_PLACEHOLDER}
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t(tile.labelKey)}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
        {t('dashboard.samplePreview.disclaimer')}
      </p>
    </section>
  )
}
