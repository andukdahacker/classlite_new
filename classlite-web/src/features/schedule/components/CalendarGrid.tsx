/**
 * CalendarGrid — Story 3.4 (AC5/AC6). Hand-rolled Day/Week/Month grid with
 * absolutely-positioned blocks, a "now" line + today highlight, real overlap
 * column-splitting, and a "+K more" chip in month cells. Behind the positioned
 * grid sits a visually-hidden, chronological ordered list — the REAL navigable
 * structure for screen readers (Sally BLOCKER). Mobile renders a DIFFERENT tree
 * (single-day agenda list), not a squished week.
 *
 * Time math is anchored to the app zone (Asia/Ho_Chi_Minh, +07:00, no DST) via
 * appZoneParts, so a block's vertical slot and day column match its HCMC-pinned
 * printed time for ANY viewer browser (CR-3-4 FD1).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { format as dfFormat } from 'date-fns'
import { vi, enUS, type Locale } from 'date-fns/locale'
import type { SessionWire } from '../api/useSessions'
import { formatSessionDateTime, formatSessionTimeRange } from '../lib/formatSessionTime'
import { isSameDay, appZoneParts, isAppZoneSameDay, type CalendarView } from '../lib/scheduleDates'
import { SessionBlock } from './SessionBlock'

const DAY_START_HOUR = 7
const DAY_END_HOUR = 21
const PX_PER_HOUR = 48
const MONTH_CELL_MAX = 2
const MIN_BLOCK_MINUTES = 30
const GRID_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * PX_PER_HOUR

interface CalendarGridProps {
  sessions: SessionWire[]
  view: CalendarView
  days: Date[]
  /** The focused day (mobile single-day agenda renders this, not days[0]). */
  focusedDay: Date
  now: Date
  locale: string
  onSelectSession: (session: SessionWire) => void
  onNewSessionAt: (day: Date) => void
  /** Jump to Day view on the given date (month "+K more"). */
  onViewDay: (day: Date) => void
}

function dfLocale(locale: string): Locale {
  return locale.startsWith('vi') ? vi : enUS
}

function sessionsOnDay(sessions: SessionWire[], day: Date): SessionWire[] {
  return sessions
    .filter((s) => isAppZoneSameDay(s.startsAt, day))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

function blockGeometry(s: SessionWire): { top: number; height: number } {
  const start = appZoneParts(s.startsAt)
  const startMin = (start.hour - DAY_START_HOUR) * 60 + start.minute
  const durMin = Math.max(MIN_BLOCK_MINUTES, (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000)
  const rawTop = (startMin / 60) * PX_PER_HOUR
  // Clamp so pre-07:00 / post-21:00 / very long blocks stay on-grid and clickable
  // instead of rendering with a negative top or overrunning the container.
  const minBlockPx = (MIN_BLOCK_MINUTES / 60) * PX_PER_HOUR
  const top = Math.max(0, Math.min(rawTop, GRID_HEIGHT_PX - minBlockPx))
  const height = Math.min((durMin / 60) * PX_PER_HOUR, GRID_HEIGHT_PX - top)
  return { top, height }
}

/**
 * Assigns each block a column within its overlap cluster. Blocks that do not
 * overlap in time get a full-width single column; only genuinely concurrent
 * blocks are width-split side-by-side (AC5). `items` must be sorted by `top`.
 */
function computeColumns(items: Array<{ top: number; height: number }>): Array<{ col: number; cols: number }> {
  const out = items.map(() => ({ col: 0, cols: 1 }))
  let i = 0
  while (i < items.length) {
    let clusterEnd = items[i].top + items[i].height
    const cluster = [i]
    let k = i + 1
    while (k < items.length && items[k].top < clusterEnd) {
      cluster.push(k)
      clusterEnd = Math.max(clusterEnd, items[k].top + items[k].height)
      k++
    }
    const colEnds: number[] = []
    for (const idx of cluster) {
      let placed = false
      for (let c = 0; c < colEnds.length; c++) {
        if (items[idx].top >= colEnds[c]) {
          out[idx].col = c
          colEnds[c] = items[idx].top + items[idx].height
          placed = true
          break
        }
      }
      if (!placed) {
        out[idx].col = colEnds.length
        colEnds.push(items[idx].top + items[idx].height)
      }
    }
    for (const idx of cluster) out[idx].cols = colEnds.length
    i = k
  }
  return out
}

export function CalendarGrid({
  sessions,
  view,
  days,
  focusedDay,
  now,
  locale,
  onSelectSession,
  onNewSessionAt,
  onViewDay,
}: CalendarGridProps): ReactElement {
  const { t } = useTranslation()
  const loc = dfLocale(locale)
  const sorted = [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)

  // The SR-navigable structure: one linear, chronological list of the visible
  // period's sessions, regardless of the positioned layout above it.
  const srList = (
    <ol data-testid="schedule-sr-list" className="sr-only">
      {sorted.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => onSelectSession(s)}>
            {`${s.className} · ${s.topic ?? ''} · ${formatSessionDateTime(s.startsAt, locale)} – ${formatSessionTimeRange(
              s.startsAt,
              s.endsAt,
              locale,
            )}${s.status === 'cancelled' ? ` · ${t('schedule.block.cancelledPill')}` : ''}`}
          </button>
        </li>
      ))}
    </ol>
  )

  // Mobile: single-day agenda tree for the FOCUSED day (a different component
  // tree — Sally), not days[0] (which is the week/month grid start).
  const agendaSessions = sessionsOnDay(sorted, focusedDay)
  const mobileAgenda = (
    <div data-testid="schedule-mobile-agenda" className="flex flex-col gap-2 md:hidden">
      <h3 className="text-sm font-medium text-slate-600">{dfFormat(focusedDay, 'EEEE, MMM d', { locale: loc })}</h3>
      {agendaSessions.length === 0 ? (
        <p className="text-sm text-slate-400">{t('schedule.agenda.empty')}</p>
      ) : (
        agendaSessions.map((s) => (
          <SessionBlock key={s.id} session={s} locale={locale} onSelect={onSelectSession} isPast={new Date(s.startsAt) < now} />
        ))
      )}
    </div>
  )

  if (view === 'month') {
    return (
      <div data-testid="schedule-grid" data-view="month">
        {srList}
        <div className="hidden grid-cols-7 gap-px bg-slate-200 md:grid">
          {days.map((day) => {
            const daySessions = sessionsOnDay(sorted, day)
            const overflow = daySessions.length - MONTH_CELL_MAX
            return (
              <div
                key={day.toISOString()}
                aria-current={isSameDay(day, now) ? 'date' : undefined}
                className={`flex min-h-24 flex-col gap-1 bg-white p-1 ${
                  isSameDay(day, now) ? 'ring-2 ring-inset ring-blue-400' : ''
                }`}
              >
                <button
                  type="button"
                  aria-label={t('schedule.emptySlot.aria', { date: dfFormat(day, 'EEEE, MMM d', { locale: loc }) })}
                  onClick={() => onNewSessionAt(day)}
                  className="self-start text-xs text-slate-400"
                >
                  {dfFormat(day, 'd', { locale: loc })}
                </button>
                {daySessions.slice(0, MONTH_CELL_MAX).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`${s.status === 'cancelled' ? `${t('schedule.block.cancelledPrefix')} ` : ''}${s.className} · ${
                      s.topic ?? ''
                    } · ${formatSessionDateTime(s.startsAt, locale)}`}
                    onClick={() => onSelectSession(s)}
                    style={{ backgroundColor: s.classColor ?? 'var(--cl-accent)' }}
                    className="truncate rounded px-1 text-left text-[10px] text-white"
                  >
                    {s.className}
                  </button>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => onViewDay(day)}
                    className="self-start text-[10px] text-slate-500 underline"
                  >
                    {t('schedule.moreCount', { count: overflow })}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {mobileAgenda}
      </div>
    )
  }

  // Day / Week — a time-axis grid with positioned blocks.
  return (
    <div data-testid="schedule-grid" data-view={view}>
      {srList}
      <div className="hidden md:block">
        <div className="flex">
          {/* hour gutter */}
          <div className="w-14 shrink-0">
            {hours.map((h) => (
              <div key={h} style={{ height: PX_PER_HOUR }} className="text-right text-[10px] text-slate-400">
                {`${h}:00`}
              </div>
            ))}
          </div>
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day) => {
              const daySessions = sessionsOnDay(sorted, day)
              const geos = daySessions.map(blockGeometry)
              const columns = computeColumns(geos)
              const isToday = isSameDay(day, now)
              const nowParts = appZoneParts(now.toISOString())
              return (
                <div
                  key={day.toISOString()}
                  className={`relative border-l border-slate-100 ${isToday ? 'bg-blue-50/40' : ''}`}
                  style={{ height: GRID_HEIGHT_PX }}
                >
                  {view === 'week' && (
                    <div
                      className="sticky top-0 z-10 truncate bg-white/80 text-center text-[10px] font-medium text-slate-500"
                      aria-current={isToday ? 'date' : undefined}
                    >
                      {dfFormat(day, 'EEE d', { locale: loc })}
                    </div>
                  )}
                  {/* empty-slot click to add */}
                  <button
                    type="button"
                    aria-label={t('schedule.emptySlot.aria', { date: dfFormat(day, 'EEEE, MMM d', { locale: loc }) })}
                    onClick={() => onNewSessionAt(day)}
                    className="absolute inset-0 h-full w-full"
                    tabIndex={-1}
                  />
                  {isToday && (
                    <div
                      data-testid="schedule-now-line"
                      aria-hidden="true"
                      className="absolute left-0 right-0 z-20 border-t-2 border-red-500"
                      style={{
                        top: Math.max(
                          0,
                          Math.min(
                            ((nowParts.hour - DAY_START_HOUR) * 60 + nowParts.minute) / 60 * PX_PER_HOUR,
                            GRID_HEIGHT_PX,
                          ),
                        ),
                      }}
                    />
                  )}
                  {daySessions.map((s, i) => {
                    const geo = geos[i]
                    const { col, cols } = columns[i]
                    return (
                      <SessionBlock
                        key={s.id}
                        session={s}
                        locale={locale}
                        onSelect={onSelectSession}
                        isPast={new Date(s.startsAt) < now}
                        tabIndex={i === 0 ? 0 : -1}
                        style={{
                          position: 'absolute',
                          top: geo.top,
                          height: geo.height,
                          left: `${col * (100 / cols)}%`,
                          width: `${100 / cols}%`,
                          zIndex: 5,
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {mobileAgenda}
    </div>
  )
}
