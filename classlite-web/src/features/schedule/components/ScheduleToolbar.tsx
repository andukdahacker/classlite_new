/**
 * ScheduleToolbar — Story 3.4 (AC5). prev/next/Today + period label + view
 * toggle + class filter + a persistent "New session" button (keyboard-first
 * create, not a mouse-only empty-slot click).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { format as dfFormat } from 'date-fns'
import { vi, enUS, type Locale } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import type { ClassWire } from '@/features/classes/api/useClasses'
import type { CalendarView } from '../lib/scheduleDates'

interface ScheduleToolbarProps {
  view: CalendarView
  anchor: Date
  locale: string
  classes: ClassWire[]
  classFilter: string | null
  onStep: (direction: -1 | 1) => void
  onToday: () => void
  onViewChange: (view: CalendarView) => void
  onClassFilterChange: (classId: string | null) => void
  onNewSession: () => void
}

const VIEWS: CalendarView[] = ['day', 'week', 'month']

function periodLabel(anchor: Date, view: CalendarView, loc: Locale): string {
  if (view === 'month') return dfFormat(anchor, 'MMMM yyyy', { locale: loc })
  if (view === 'day') return dfFormat(anchor, 'EEEE, MMM d, yyyy', { locale: loc })
  return dfFormat(anchor, "'Week of' MMM d, yyyy", { locale: loc })
}

export function ScheduleToolbar({
  view,
  anchor,
  locale,
  classes,
  classFilter,
  onStep,
  onToday,
  onViewChange,
  onClassFilterChange,
  onNewSession,
}: ScheduleToolbarProps): ReactElement {
  const { t } = useTranslation()
  const loc: Locale = locale.startsWith('vi') ? vi : enUS
  return (
    <div data-testid="schedule-toolbar" className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" aria-label={t('schedule.prev')} onClick={() => onStep(-1)}>
          ‹
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          {t('schedule.today')}
        </Button>
        <Button variant="outline" size="sm" aria-label={t('schedule.next')} onClick={() => onStep(1)}>
          ›
        </Button>
      </div>
      <span className="min-w-40 text-sm font-medium text-slate-700" data-testid="schedule-period-label">
        {periodLabel(anchor, view, loc)}
      </span>

      <div role="group" aria-label={t('schedule.view.legend')} className="ml-auto flex items-center gap-1">
        {VIEWS.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={v === view ? 'default' : 'outline'}
            aria-pressed={v === view}
            onClick={() => onViewChange(v)}
          >
            {t(`schedule.view.${v}`)}
          </Button>
        ))}
      </div>

      <select
        aria-label={t('schedule.filter.label')}
        className="h-8 rounded-md border border-slate-200 px-2 text-sm"
        value={classFilter ?? ''}
        onChange={(e) => onClassFilterChange(e.target.value || null)}
      >
        <option value="">{t('schedule.filter.allClasses')}</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <Button size="sm" onClick={onNewSession} data-testid="schedule-new-session">
        {t('schedule.newSession')}
      </Button>
    </div>
  )
}
