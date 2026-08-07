/**
 * TimeOnTaskMeter — Story 5.3 Task 5 (AC8, Sally S5/N2). The elapsed time-on-task
 * counter: counts up from `submission.startedAt` off the monotonic server clock
 * (`serverNow()` — NEVER `Date.now()`). Isolated (owns its own 1s tick) so a tick
 * re-renders only this meter, never the shell. Honestly labelled as OPEN/elapsed
 * time (not "active" time — Sally N2). The numerals are `aria-live="off"` — no
 * per-second screen-reader narration (Sally S5).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRemaining } from '@/features/attempts'

export interface TimeOnTaskMeterProps {
  startedAt: string
  /** The monotonic server-anchored clock (never `Date.now()`). */
  serverNow: () => number
  /** Tick cadence in ms (default 1s); injectable for tests. */
  tickMs?: number
}

export function TimeOnTaskMeter({
  startedAt,
  serverNow,
  tickMs = 1000,
}: TimeOnTaskMeterProps) {
  const { t } = useTranslation()
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  const startedMs = Date.parse(startedAt)
  const elapsedSec = Number.isNaN(startedMs)
    ? 0
    : Math.max(0, Math.floor((serverNow() - startedMs) / 1000))

  return (
    <span
      data-testid="writing-time-on-task"
      className="inline-flex items-center gap-1.5 font-mono text-xs text-[color:var(--cl-ink-soft)]"
    >
      <span className="font-sans">{t('writing.timeOnTask.label')}</span>
      {/* aria-live off — the ticking numeral must not narrate each second. */}
      <span aria-live="off" data-testid="writing-time-on-task-value">
        {formatRemaining(elapsedSec)}
      </span>
    </span>
  )
}
