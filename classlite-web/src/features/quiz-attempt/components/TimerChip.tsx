/**
 * TimerChip — Story 5.2b Task 7 (AC20, Sally-B2/S4). The countdown chip: amber
 * at ≤5:00, red + gentle pulse at ≤1:00 (respecting `prefers-reduced-motion`).
 * Each threshold crossing is announced via `aria-live` ("5 minutes remaining").
 * The numeric time is icon+number-tight so it never wraps at 360px (VN-length).
 * Untimed attempts (`remainingSeconds == null`) render nothing.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatRemaining, type TimerWarningLevel } from '../lib/attemptTimer'

export interface TimerChipProps {
  remainingSeconds: number | null
  warningLevel: TimerWarningLevel
}

export function TimerChip({ remainingSeconds, warningLevel }: TimerChipProps) {
  const { t } = useTranslation()
  const announcedRef = useRef<TimerWarningLevel>('normal')
  const liveRef = useRef<HTMLSpanElement>(null)

  // Announce ONLY on a threshold crossing, not every tick.
  useEffect(() => {
    if (remainingSeconds === null) return
    if (warningLevel !== announcedRef.current) {
      announcedRef.current = warningLevel
      if (liveRef.current) {
        liveRef.current.textContent =
          warningLevel === 'red'
            ? t('attempt.timer.oneMin')
            : warningLevel === 'amber'
              ? t('attempt.timer.fiveMin')
              : ''
      }
    }
  }, [warningLevel, remainingSeconds, t])

  if (remainingSeconds === null) return null

  const formatted = formatRemaining(remainingSeconds)
  return (
    <div
      data-testid="timer-chip"
      data-warning={warningLevel}
      aria-label={t('attempt.timer.remainingAria', { time: formatted })}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--cl-radius-full)] px-3 py-1 text-sm font-semibold tabular-nums',
        warningLevel === 'normal' && 'bg-[var(--cl-surface)] text-[var(--cl-ink)]',
        warningLevel === 'amber' && 'bg-[var(--cl-amber)]/15 text-[var(--cl-amber)]',
        warningLevel === 'red' &&
          'bg-[var(--cl-danger)]/15 text-[var(--cl-danger)] motion-safe:animate-pulse',
      )}
    >
      <span aria-hidden="true">⏱</span>
      <span>{formatted}</span>
      {/* Threshold announcements only (aria-live), not the ticking number. */}
      <span ref={liveRef} role="status" aria-live="polite" className="sr-only" />
    </div>
  )
}
