/**
 * SessionsTab — Story 3.4 (AC10). The per-class session list (lit from the
 * Story 3.2 dormant ComingSoonPanel). Reads GET /api/sessions?classId&from&to
 * via the schedule feature barrel (TS-7). Three-state (skeleton / empty / error
 * alert), i18n-formatted times (TS-6), status + topic + time. No roster /
 * attendance (Story 3.5). The s07 Schedule-column date fix (CR-3-1-7) is NOT
 * touched here.
 */
import { type ReactElement } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useClassSessions, formatSessionDateTime } from '@/features/schedule'

const WINDOW_BACK_DAYS = 30
const WINDOW_FORWARD_DAYS = 62 // 92-day total (server range cap)

function isoOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessionsTab(): ReactElement {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const from = isoOffset(-WINDOW_BACK_DAYS)
  const to = isoOffset(WINDOW_FORWARD_DAYS)
  const query = useClassSessions(id ?? '', from, to, Boolean(id))

  if (query.isLoading) {
    return (
      <div data-testid="class-tab-sessions-skeleton" className="flex flex-col gap-2 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <div role="alert" data-testid="class-tab-sessions-error" className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-slate-600">{t('classes.detail.sessions.loadError')}</p>
        <Button onClick={() => query.refetch()}>{t('classes.detail.sessions.retry')}</Button>
      </div>
    )
  }

  const sessions = query.data ?? []
  if (sessions.length === 0) {
    return (
      <div
        data-testid="class-tab-sessions-empty"
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      >
        <span aria-hidden="true" className="text-3xl">📅</span>
        <p className="text-sm text-slate-500">{t('classes.detail.sessions.empty')}</p>
      </div>
    )
  }

  return (
    <section data-testid="class-tab-sessions-list" aria-label={t('classes.detail.sessions.title')}>
      <ul className="flex flex-col divide-y divide-slate-100">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-800">
                {formatSessionDateTime(s.startsAt, i18n.language)}
              </span>
              {s.topic && <span className="text-xs text-slate-500">{s.topic}</span>}
            </div>
            {s.status === 'cancelled' && (
              <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                {t('schedule.block.cancelledPill')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
