/**
 * CalendarLegend — Story 3.4 (AC5/AC7). Per-class colour swatches derived from
 * the VISIBLE sessions only (so it reflects exactly the caller's scope — a
 * teacher never sees another teacher's classes here).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionWire } from '../api/useSessions'

interface CalendarLegendProps {
  sessions: SessionWire[]
}

export function CalendarLegend({ sessions }: CalendarLegendProps): ReactElement {
  const { t } = useTranslation()
  const byClass = new Map<string, { id: string; name: string; color: string | null }>()
  for (const s of sessions) {
    if (!byClass.has(s.classId)) byClass.set(s.classId, { id: s.classId, name: s.className, color: s.classColor })
  }
  const entries = Array.from(byClass.values()).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div data-testid="schedule-legend" className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold uppercase text-slate-400">{t('schedule.legend.title')}</h2>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">{t('schedule.legend.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs text-slate-600">
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: e.color ?? 'var(--cl-accent)' }}
              />
              {e.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
