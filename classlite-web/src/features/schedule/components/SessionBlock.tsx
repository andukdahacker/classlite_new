/**
 * SessionBlock — Story 3.4 (AC6). A single session rendered as a <button> with
 * a full aria-label ("{class} · {topic} · {day} {start}–{end} · {recurring?}").
 * Tint = classColor ?? var(--cl-accent) (the sanctioned raw-hex exception).
 * Cancelled sessions carry a "Cancelled — " aria prefix + a non-color pill
 * (survives colorblindness + SR), visually distinct from past/dimmed.
 */
import { type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionWire } from '../api/useSessions'
import { formatSessionTime, formatSessionTimeRange } from '../lib/formatSessionTime'

interface SessionBlockProps {
  session: SessionWire
  locale: string
  onSelect: (session: SessionWire) => void
  style?: CSSProperties
  tabIndex?: number
  isPast?: boolean
  compact?: boolean
}

const ACCENT_FALLBACK = 'var(--cl-accent)'

export function SessionBlock({
  session,
  locale,
  onSelect,
  style,
  tabIndex,
  isPast = false,
  compact = false,
}: SessionBlockProps): ReactElement {
  const { t } = useTranslation()
  const cancelled = session.status === 'cancelled'
  const recurring = session.recurrenceGroupId != null

  const ariaLabel = [
    cancelled ? t('schedule.block.cancelledPrefix') : '',
    session.className,
    session.topic ?? '',
    formatSessionTimeRange(session.startsAt, session.endsAt, locale),
    recurring ? t('schedule.block.recurring') : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      data-testid="session-block"
      data-cancelled={cancelled || undefined}
      data-past={isPast || undefined}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onClick={() => onSelect(session)}
      style={{ backgroundColor: session.classColor ?? ACCENT_FALLBACK, ...style }}
      className={`flex w-full flex-col overflow-hidden rounded px-1.5 py-1 text-left text-xs text-white ${
        cancelled ? 'opacity-70 ring-1 ring-inset ring-white/60' : ''
      } ${isPast && !cancelled ? 'opacity-50' : ''}`}
    >
      <span className="font-medium">{formatSessionTime(session.startsAt, locale)}</span>
      <span className="truncate">{session.className}</span>
      {!compact && session.topic && <span className="truncate opacity-90">{session.topic}</span>}
      {cancelled && (
        <span className="mt-0.5 inline-flex w-fit items-center rounded bg-white/90 px-1 text-[10px] font-semibold uppercase text-red-700">
          {t('schedule.block.cancelledPill')}
        </span>
      )}
    </button>
  )
}
