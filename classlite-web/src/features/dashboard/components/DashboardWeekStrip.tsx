/**
 * DashboardWeekStrip — the lean s06 week glance (Story 8-1b, D5). Seven day
 * columns starting at the center-local "today", each holding the day's sessions
 * as compact rows. Today is highlighted; the next upcoming session (the first
 * whose start is after `serverTime`) is inverted (dark) with an amber left
 * border and a "· NEXT" marker.
 *
 * NOT a reuse of `features/schedule` `SessionBlock` — that is typed to the
 * heavier `SessionWire` (`classColor`/`id`); dashboard sessions are the leaner
 * `DashboardSessionLite` (`color`/`sessionId`) pre-bundled in the payload, so a
 * reuse would need a lossy adapter + a cross-feature import (FW-7). `useSessions`
 * is deliberately NOT called — the week is already tz-bucketed server-side (D16)
 * and a second fetch would double-fetch.
 *
 * Domain-agnostic time display goes through the zoned helpers in
 * `../lib/dashboardTime` (center timezone), never `Date.now()`/`new Date()` in a
 * locale path (TS-6 / D16). The strip scrolls horizontally on narrow viewports
 * so the page body never overflows (D14).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import {
  weekDayKeys,
  zonedDayKey,
  zonedDayOfMonth,
  zonedTimeLabel,
  type WeekStripAnchor,
} from '../lib/dashboardTime'

type DashboardSessionLite = components['schemas']['DashboardSessionLite']

export interface DashboardWeekStripProps {
  sessions: DashboardSessionLite[]
  serverTime: string
  timezone: string
  /**
   * Column anchoring (D5). `'week'` for the teacher `weekSessions` calendar-week
   * window `[startOfWeek,+7d)` (Monday-anchored so this-week's already-passed
   * sessions still land in a column); `'today'` (default) for the student
   * `upcomingSessions` rolling `[now,+7d)` window.
   */
  anchor?: WeekStripAnchor
}

function nextUpcomingSessionId(
  sessions: DashboardSessionLite[],
  serverTime: string,
): string | null {
  const nowMs = Date.parse(serverTime)
  let bestId: string | null = null
  let bestStart = Number.POSITIVE_INFINITY
  for (const session of sessions) {
    const start = Date.parse(session.startsAt)
    if (start > nowMs && start < bestStart) {
      bestStart = start
      bestId = session.sessionId
    }
  }
  return bestId
}

export function DashboardWeekStrip({
  sessions,
  serverTime,
  timezone,
  anchor = 'today',
}: DashboardWeekStripProps): ReactElement {
  const { t } = useTranslation()
  const dayKeys = weekDayKeys(serverTime, timezone, anchor)
  const todayKey = zonedDayKey(serverTime, timezone)
  const nextId = nextUpcomingSessionId(sessions, serverTime)

  return (
    <section
      data-testid="dashboard-week-strip"
      aria-label={t('dashboard.weekStrip.label')}
      className="overflow-x-auto"
    >
      <ol className="flex min-w-max gap-2">
        {dayKeys.map((dayKey) => {
          const isToday = dayKey === todayKey
          const daySessions = sessions.filter(
            (session) => zonedDayKey(session.startsAt, timezone) === dayKey,
          )
          return (
            <li
              key={dayKey}
              data-today={String(isToday)}
              className={`flex w-36 shrink-0 flex-col gap-2 rounded-xl border p-2 ${
                isToday
                  ? 'border-[var(--cl-accent)] bg-[var(--cl-tint-blue)]'
                  : 'border-[var(--cl-border)] bg-[var(--cl-surface)]'
              }`}
            >
              <p className="flex items-baseline justify-between px-1">
                <span className="font-mono text-lg text-[var(--cl-ink)]">
                  {zonedDayOfMonth(dayKey, 'UTC')}
                </span>
                {isToday ? (
                  <span className="text-xs font-medium text-[var(--cl-accent)]">
                    {t('dashboard.weekStrip.today')}
                  </span>
                ) : null}
              </p>
              {daySessions.length === 0 ? (
                <p className="px-1 text-xs text-[var(--cl-ink-soft)]">
                  {t('dashboard.weekStrip.noSessions')}
                </p>
              ) : (
                daySessions.map((session) => {
                  const isNext = session.sessionId === nextId
                  return (
                    <div
                      key={session.sessionId}
                      data-next={String(isNext)}
                      className={`rounded-lg border-l-4 px-2 py-1.5 text-xs ${
                        isNext
                          ? 'border-l-[var(--cl-amber)] bg-[var(--cl-ink)] text-[var(--cl-surface)]'
                          : 'border-l-[var(--cl-accent)] bg-[var(--cl-surface)] text-[var(--cl-ink)]'
                      }`}
                    >
                      <p className="flex items-center gap-1 font-mono">
                        {zonedTimeLabel(session.startsAt, timezone)}
                        {isNext ? (
                          <span className="font-sans font-semibold text-[var(--cl-amber)]">
                            · {t('dashboard.weekStrip.next')}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate font-medium">{session.className}</p>
                      {session.topic ? (
                        <p className="truncate text-[var(--cl-ink-soft)]">
                          {session.topic}
                        </p>
                      ) : null}
                    </div>
                  )
                })
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
