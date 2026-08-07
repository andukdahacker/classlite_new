/**
 * DueDateCountdown — Story 5.3 Task 5 (AC9, Sally S5, brand §7.2). A CALM,
 * informational due-date countdown to `assignment.deadlineAt` off the monotonic
 * `serverNow()` — explicitly NOT the exam-timer amber/red-pulse ramp (brand §7.2
 * "calm over urgency"; this is a due-date, distinct from a timed exam clock).
 *
 *  - Numerals are `aria-live="off"` (no per-second SR narration, Sally S5).
 *  - Crossing the deadline is announced ONCE via a polite live region ("now past
 *    due — a late penalty may apply") and flips a visible overdue state — never a
 *    silent recolor. Late work is still accepted until `hardDeadlineAt`/close.
 *
 * Isolated (owns its own 1s tick) so a tick re-renders only this meter.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_MINUTE = 60

/**
 * Format a due-date remaining span in CALM, day/hour/minute-relative terms — NOT
 * the exam M:SS/H:MM:SS ramp. Due dates are days/weeks out, so `formatRemaining`
 * (the timed-exam formatter) would render e.g. a 16-day span as "384:00:00".
 */
function formatDueRemaining(remainingSec: number, t: TFunction): string {
  const days = Math.floor(remainingSec / SECONDS_PER_DAY)
  const hours = Math.floor((remainingSec % SECONDS_PER_DAY) / SECONDS_PER_HOUR)
  const minutes = Math.floor((remainingSec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  if (days > 0) return t('writing.due.remaining.days', { days, hours })
  if (hours > 0) return t('writing.due.remaining.hours', { hours, minutes })
  // Under an hour: show at least "1m" so a sub-minute span never reads "0m".
  return t('writing.due.remaining.minutes', {
    minutes: Math.max(1, Math.ceil(remainingSec / SECONDS_PER_MINUTE)),
  })
}

export interface DueDateCountdownProps {
  deadlineAt: string
  /** The monotonic server-anchored clock (never `Date.now()`). */
  serverNow: () => number
  /** Tick cadence in ms (default 1s); injectable for tests. */
  tickMs?: number
}

export function DueDateCountdown({
  deadlineAt,
  serverNow,
  tickMs = 1000,
}: DueDateCountdownProps) {
  const { t } = useTranslation()
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  const deadlineMs = Date.parse(deadlineAt)
  const remainingSec = Number.isNaN(deadlineMs)
    ? 0
    : Math.ceil((deadlineMs - serverNow()) / 1000)
  const overdue = remainingSec <= 0

  // Announce the deadline crossing EXACTLY ONCE (Sally S5) — render the polite
  // message only on the false→true transition, not every overdue tick.
  const wasOverdueRef = useRef(overdue)
  const [justCrossed, setJustCrossed] = useState(false)
  useEffect(() => {
    if (overdue && !wasOverdueRef.current) setJustCrossed(true)
    wasOverdueRef.current = overdue
  }, [overdue])

  return (
    <span
      data-testid="writing-due-countdown"
      data-overdue={overdue}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        overdue ? 'text-[color:var(--cl-amber)]' : 'text-[color:var(--cl-ink-soft)]',
      )}
    >
      <span>{t('writing.due.label')}</span>
      {overdue ? (
        <span data-testid="writing-due-overdue">{t('writing.due.overdue')}</span>
      ) : (
        // aria-live off — the ticking remaining must not narrate each second.
        <span aria-live="off" data-testid="writing-due-value">
          {t('writing.due.countdown', { time: formatDueRemaining(remainingSec, t) })}
        </span>
      )}
      {justCrossed ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="writing-due-announce"
          className="sr-only"
        >
          {t('writing.due.overdueAnnounce')}
        </span>
      ) : null}
    </span>
  )
}
