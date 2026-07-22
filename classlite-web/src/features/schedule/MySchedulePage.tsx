/**
 * MySchedulePage — Story 3.4 (AC9). Truthful dormant STUB for students. The
 * real student schedule (enrolled-class filtered) is deferred to Epic 7 / 7.3
 * (enrollments) — tracked as FU-3-4-A. This is an EMPTY STATE, not a rendered
 * dormant calendar, not an error, not a spinner, and carries no nav badge.
 */
// epic: 7 (FU-3-4-A) — replace this stub with the enrolled-class calendar view.
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export function MySchedulePage(): ReactElement {
  const { t } = useTranslation()
  return (
    <section
      data-testid="my-schedule-placeholder"
      className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-20 text-center"
    >
      <span aria-hidden="true" className="text-4xl">📅</span>
      <h1 className="text-lg font-semibold text-slate-800">{t('mySchedule.empty.headline')}</h1>
      <p className="text-sm text-slate-500">{t('mySchedule.empty.body')}</p>
      <p className="text-xs text-slate-400">{t('mySchedule.empty.disclaimer')}</p>
    </section>
  )
}
