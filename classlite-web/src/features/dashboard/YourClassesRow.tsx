/**
 * YourClassesRow — Story 2-4 AC9.
 *
 * Renders up to 2 class cards from `templateDraft.classesDraft.slice(0,2)`
 * below the persona-value card (FirstAIGradeCard for Founder/Solo,
 * SampleDashboardPreview for Operator). Each card shows the cohort name,
 * a locale-formatted start date, and a placeholder stat strip (`—` values
 * — real numbers land Epic 3+ / Epic 5+).
 *
 * If `classesDraft` is empty or undefined, render a ghost card with a
 * dashed-border "+ Create another from template" CTA that routes through
 * `<DeadLinkTrigger>` (dead-link toast — the templates surface graduates
 * with Story 3.3).
 *
 * XSS safety [W-INFO-17]: `cohortName` is a user-typed string. It renders
 * via React text-node interpolation (auto-escaped). ARIA labels are
 * composed via i18n interpolation (`t('...', { name })`), NOT string
 * concatenation.
 */
import { useTranslation } from 'react-i18next'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import DeadLinkTrigger from '@/features/dashboard/components/DeadLinkTrigger'

export interface YourClassesRowProps {
  centerName: string
  classesDraft: TemplateDraftPayload['classesDraft'] | undefined
}

// Date-only ISO strings (`YYYY-MM-DD`) parse as UTC midnight; formatted in
// browser locale that would display a day earlier for Americas timezones.
// Parse those as local dates instead. Fall back to Date() for full ISO
// timestamps (rare for classesDraft but tolerated).
const DATE_ONLY_ISO = /^\d{4}-\d{2}-\d{2}$/

function parseDraftDate(iso: string): Date {
  const match = DATE_ONLY_ISO.exec(iso)
  if (match !== null) {
    const [year, month, day] = iso.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date(iso)
}

function formatStartDate(iso: string, locale: string): string {
  if (iso === '') return ''
  const parsed = parseDraftDate(iso)
  // `Intl.format(Invalid Date)` returns the literal string "Invalid Date"
  // rather than throwing — guard explicitly so wire-drift or a bad fixture
  // shows the raw ISO instead of leaking "Invalid Date" into the UI.
  if (Number.isNaN(parsed.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(parsed)
  } catch {
    return iso
  }
}

export default function YourClassesRow({
  centerName,
  classesDraft,
}: YourClassesRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('vi') ? 'vi-VN' : 'en-US'
  const visible = classesDraft?.slice(0, 2) ?? []

  return (
    <section
      data-testid="dashboard-your-classes-row"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="dashboard-your-classes-heading"
    >
      <h2
        id="dashboard-your-classes-heading"
        className="font-[var(--cl-font-display)] text-2xl italic text-[var(--cl-ink)]"
      >
        {t('dashboard.yourClasses.heading')}
      </h2>

      {visible.length === 0 ? (
        <div
          data-testid="dashboard-your-classes-ghost"
          className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"
        >
          <p className="text-sm text-slate-600">
            {t('dashboard.yourClasses.ghost', { centerName: centerName ?? '' })}
          </p>
          <div className="mt-3">
            <DeadLinkTrigger
              targetPath="/classes"
              targetSurface="classes"
              epicNum={3}
            >
              {t('dashboard.yourClasses.createAnotherCta')}
            </DeadLinkTrigger>
          </div>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((cls, idx) => (
            <li
              key={`${cls.cohortName}-${idx}`}
              data-testid={`dashboard-your-classes-card-${idx}`}
              aria-label={t('dashboard.yourClasses.cardAriaLabel', {
                name: cls.cohortName,
              })}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <p className="truncate text-sm font-semibold text-slate-900">
                {cls.cohortName}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatStartDate(cls.startDate, locale)}
              </p>
              <ul className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                <li>{t('dashboard.yourClasses.placeholder.students')}</li>
                <li>{t('dashboard.yourClasses.placeholder.sessions')}</li>
                <li>{t('dashboard.yourClasses.placeholder.nextSession')}</li>
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
