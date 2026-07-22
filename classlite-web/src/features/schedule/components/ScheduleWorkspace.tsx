/**
 * ScheduleWorkspace — Story 3.4 (AC5). The hand-rolled two-pane workspace (root
 * testid `schedule-workspace`). Left: mini-month + legend. Right: toolbar over
 * the Day/Week/Month grid. Trilogy choreography: loading = skeleton grid (never
 * a spinner); empty = the REAL grid renders with an in-canvas week-scoped
 * overlay (not a blanked pane); error is handled one level up (SchedulePage) so
 * it looks different from empty.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import type { ClassWire } from '@/features/classes/api/useClasses'
import type { SessionWire } from '../api/useSessions'
import type { CalendarView } from '../lib/scheduleDates'
import { visibleDays } from '../lib/scheduleDates'
import { ScheduleToolbar } from './ScheduleToolbar'
import { CalendarGrid } from './CalendarGrid'
import { CalendarLegend } from './CalendarLegend'
import { MiniMonthNavigator } from './MiniMonthNavigator'

interface ScheduleWorkspaceProps {
  sessions: SessionWire[]
  loading: boolean
  view: CalendarView
  anchor: Date
  now: Date
  classes: ClassWire[]
  classFilter: string | null
  locale: string
  onStep: (direction: -1 | 1) => void
  onToday: () => void
  onViewChange: (view: CalendarView) => void
  onAnchorChange: (date: Date) => void
  onClassFilterChange: (classId: string | null) => void
  onSelectSession: (session: SessionWire) => void
  onNewSession: (day?: Date) => void
}

export function ScheduleWorkspace(props: ScheduleWorkspaceProps): ReactElement {
  const { t } = useTranslation()
  const days = visibleDays(props.anchor, props.view)
  const isEmpty = !props.loading && props.sessions.length === 0

  return (
    <div data-testid="schedule-workspace" className="flex flex-col gap-4 md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 md:w-64">
        <MiniMonthNavigator selected={props.anchor} onSelect={props.onAnchorChange} />
        <CalendarLegend sessions={props.sessions} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <ScheduleToolbar
          view={props.view}
          anchor={props.anchor}
          locale={props.locale}
          classes={props.classes}
          classFilter={props.classFilter}
          onStep={props.onStep}
          onToday={props.onToday}
          onViewChange={props.onViewChange}
          onClassFilterChange={props.onClassFilterChange}
          onNewSession={() => props.onNewSession()}
        />

        <div className="relative">
          {props.loading ? (
            <div data-testid="schedule-skeleton" className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <CalendarGrid
              sessions={props.sessions}
              view={props.view}
              days={days}
              focusedDay={props.anchor}
              now={props.now}
              locale={props.locale}
              onSelectSession={props.onSelectSession}
              onNewSessionAt={(day) => props.onNewSession(day)}
              onViewDay={(day) => {
                props.onAnchorChange(day)
                props.onViewChange('day')
              }}
            />
          )}

          {isEmpty && (
            <div
              data-testid="schedule-empty-overlay"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <p className="pointer-events-auto rounded-md bg-white/90 px-4 py-2 text-sm text-slate-500 shadow-sm">
                {t('schedule.empty.body')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
