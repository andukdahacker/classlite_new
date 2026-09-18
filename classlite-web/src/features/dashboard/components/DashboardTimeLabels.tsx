/**
 * DashboardTimeLabels — the serverTime-driven relative-time labels (Story 8-1b,
 * D16). `QuestionAge` renders "N ago" for a question thread; `DueCountdown`
 * renders the remaining time (or an overdue flag) for an assignment. Both derive
 * their value from the injected `meta.serverTime` via `../lib/dashboardTime`,
 * NEVER `Date.now()`, so the labels are skew- and hydration-immune. All copy is
 * i18n (`dashboard.time.*`, en + vi) with the count interpolated.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  elapsedSince,
  remainingUntil,
  type CompactDuration,
} from '../lib/dashboardTime'

const AGO_KEY: Record<CompactDuration['unit'], string> = {
  now: 'dashboard.time.justNow',
  minutes: 'dashboard.time.minutesAgo',
  hours: 'dashboard.time.hoursAgo',
  days: 'dashboard.time.daysAgo',
}

const LEFT_KEY: Record<CompactDuration['unit'], string> = {
  now: 'dashboard.time.dueNow',
  minutes: 'dashboard.time.minutesLeft',
  hours: 'dashboard.time.hoursLeft',
  days: 'dashboard.time.daysLeft',
}

export interface QuestionAgeProps {
  questionId: string
  createdAt: string
  serverTime: string
}

export function QuestionAge({
  questionId,
  createdAt,
  serverTime,
}: QuestionAgeProps): ReactElement {
  const { t } = useTranslation()
  const { count, unit } = elapsedSince(createdAt, serverTime)
  return (
    <span
      data-testid={`question-age-${questionId}`}
      className="text-xs text-[var(--cl-ink-soft)]"
    >
      {t(AGO_KEY[unit], { count })}
    </span>
  )
}

export interface FeedbackReleasedAgeProps {
  submissionId: string
  releasedAt: string
  serverTime: string
}

/**
 * FeedbackReleasedAge renders "released N ago" for a graded submission (AC12) —
 * the calmer recent-feedback treatment (UX-DR22): muted, never red, serverTime-
 * driven like the rest (D16).
 */
export function FeedbackReleasedAge({
  submissionId,
  releasedAt,
  serverTime,
}: FeedbackReleasedAgeProps): ReactElement {
  const { t } = useTranslation()
  const { count, unit } = elapsedSince(releasedAt, serverTime)
  return (
    <span
      data-testid={`feedback-released-${submissionId}`}
      className="text-xs text-[var(--cl-ink-soft)]"
    >
      {t(AGO_KEY[unit], { count })}
    </span>
  )
}

export interface DueCountdownProps {
  assignmentId: string
  deadlineAt: string
  serverTime: string
}

export function DueCountdown({
  assignmentId,
  deadlineAt,
  serverTime,
}: DueCountdownProps): ReactElement {
  const { t } = useTranslation()
  const { count, unit, overdue } = remainingUntil(deadlineAt, serverTime)
  return (
    <span
      data-testid={`due-countdown-${assignmentId}`}
      className={`font-mono text-xs ${
        overdue ? 'text-[var(--cl-red)]' : 'text-[var(--cl-ink-soft)]'
      }`}
    >
      {overdue ? t('dashboard.time.overdue') : t(LEFT_KEY[unit], { count })}
    </span>
  )
}
