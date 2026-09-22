/**
 * MyPerformancePage — Story 8-2b (AC4, D8). A truthful, dormant placeholder for
 * the student `/my-performance` surface so the `/analytics` → student redirect
 * (and the pre-existing student sidebar link) never 404s. The REAL page +
 * `GET /api/analytics/me` are Story 8.3 / FR-50 — this is an EMPTY STATE, not a
 * fabricated dashboard, not an error, not a spinner (mirrors the `/my-schedule`
 * stub precedent).
 */
// epic: 8 (Story 8.3 / FR-50) — replace this stub with the real my-performance view.
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export function MyPerformancePage(): ReactElement {
  const { t } = useTranslation()
  return (
    <section
      data-testid="my-performance-placeholder"
      className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-20 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        📈
      </span>
      <h1 className="text-lg font-semibold text-slate-800">
        {t('analytics.myPerformance.empty.headline')}
      </h1>
      <p className="text-sm text-slate-500">
        {t('analytics.myPerformance.empty.body')}
      </p>
      <p className="text-xs text-slate-400">
        {t('analytics.myPerformance.empty.disclaimer')}
      </p>
    </section>
  )
}
