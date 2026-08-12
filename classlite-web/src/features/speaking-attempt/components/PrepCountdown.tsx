/**
 * PrepCountdown — Story 5.4 Task 6 (AC6, D4, Sally S1). A CALM preparation
 * countdown before recording (the DueDateCountdown calm model — NOT the exam
 * amber/red-pulse ramp). Numerals are `aria-live="off"` (no per-second SR
 * narration); a single `aria-live="polite"` announces "Prep done — you can record
 * now" when it ends. A "Start recording now" affordance ends prep early — it
 * protects nothing (unenforced, D4). Client-side default `SPEAKING_PREP_SECONDS`;
 * a real `exercise.prepSeconds` field is FU-5-4-A.
 */
import { useTranslation } from 'react-i18next'
import { useCountdown } from '@/hooks/useCountdown'
import { formatRemaining } from '@/features/attempts'
import { SPEAKING_PREP_SECONDS } from '../lib/speakingContent'

export interface PrepCountdownProps {
  /** Fired once when the countdown reaches zero OR the student skips it. */
  onDone: () => void
  /**
   * Fired ONLY on natural countdown expiry (not skip). The "prep done" polite
   * announce must live in a region that OUTLIVES this component — `onDone` unmounts
   * PrepCountdown, so an `aria-live` node here would be inserted-and-removed in one
   * reconciliation and never spoken (AC6). The leaf owns the persistent SR region.
   */
  onExpire?: () => void
  /** Prep seconds (client default; injectable for tests). */
  prepSeconds?: number
}

export function PrepCountdown({
  onDone,
  onExpire,
  prepSeconds = SPEAKING_PREP_SECONDS,
}: PrepCountdownProps) {
  const { t } = useTranslation()
  const { remainingSeconds } = useCountdown({
    initialSeconds: prepSeconds,
    onZero: () => {
      onExpire?.()
      onDone()
    },
  })

  return (
    <div
      data-testid="speaking-prep"
      className="flex flex-col items-center gap-3 text-center"
    >
      <p className="text-sm text-[color:var(--cl-ink-soft)]">{t('speaking.prep.label')}</p>
      {/* Numerals do not narrate per second (Sally S1). */}
      <p
        aria-live="off"
        data-testid="speaking-prep-remaining"
        className="text-3xl font-semibold tabular-nums text-[color:var(--cl-ink)]"
      >
        {formatRemaining(Math.max(0, remainingSeconds))}
      </p>
      <button
        type="button"
        onClick={onDone}
        data-testid="speaking-prep-skip"
        className="min-h-12 rounded-md border border-[color:var(--cl-line-soft)] px-4 text-base font-medium text-[color:var(--cl-ink)] hover:bg-[color:var(--cl-tint-red)]"
      >
        {t('speaking.prep.skip')}
      </button>
    </div>
  )
}
