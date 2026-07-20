/**
 * ComingSoonPanel — Story 3.2 (AC3). The single element a dormant tab renders,
 * and NOTHING else: a hard ceiling of no data fetch, no data-shaped stub, no
 * interactive control. Copy speaks the tab's benefit in the user's language and
 * carries NO roadmap / epic / date words — a neutral "Coming soon" chip is the
 * ceiling of any roadmap signal. The owning-epic pointer lives only in a code
 * comment in each tab file (grep seam for the future dev), never on screen.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

interface ComingSoonPanelProps {
  /** i18n key for the benefit-language title. */
  titleKey: string
  /** i18n key for the benefit-language body. */
  bodyKey: string
  /** Distinct per-tab hook, e.g. `class-tab-students-coming-soon`. */
  testid: string
}

export function ComingSoonPanel({
  titleKey,
  bodyKey,
  testid,
}: ComingSoonPanelProps): ReactElement {
  const { t } = useTranslation()
  return (
    <section
      data-testid={testid}
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
    >
      {/* Purely-decorative mark — aria-hidden, no data shape (AC3). */}
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-300"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="font-fraunces text-lg text-slate-900">{t(titleKey)}</h2>
      <p className="max-w-sm text-sm text-slate-500">{t(bodyKey)}</p>
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
        {t('classes.detail.head.comingSoonChip')}
      </span>
    </section>
  )
}
