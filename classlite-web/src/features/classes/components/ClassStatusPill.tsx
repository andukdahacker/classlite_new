/**
 * ClassStatusPill — Story 3.1 (AC7/AC8). The pill IS the lifecycle transition
 * control: it renders the current status with a semantic-token color and, when
 * interactive, a caret + DropdownMenu offering ONLY the legal next states
 * (the current state is absent, so the AC4 same-state 422 is unreachable from
 * the UI). The client transition map mirrors the server's authoritative map;
 * the server remains the source of truth.
 *
 * Colors per UX §5.6: upcoming→blue, active→green, paused→amber, ended→red.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ClassStatus } from '../api/useClasses'
import { CLIENT_TRANSITIONS } from '../lib/classTransitions'

const STATUS_TONE: Record<ClassStatus, string> = {
  upcoming: 'bg-[color:var(--cl-tint-blue)] text-[color:var(--cl-accent)]',
  active: 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]',
  paused: 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
  ended: 'bg-[color:var(--cl-tint-red)] text-[color:var(--cl-red)]',
}

const PILL_BASE =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium'

interface ClassStatusPillProps {
  status: ClassStatus
  /** When provided, the pill becomes a transition trigger. */
  onTransition?: (next: ClassStatus) => void
  disabled?: boolean
}

export function ClassStatusPill({
  status,
  onTransition,
  disabled = false,
}: ClassStatusPillProps): ReactElement {
  const { t } = useTranslation()
  const label = t(`classes.status.${status}`)
  const nextStates = CLIENT_TRANSITIONS[status]
  const interactive = Boolean(onTransition) && nextStates.length > 0 && !disabled

  if (!interactive) {
    return (
      <span className={`${PILL_BASE} ${STATUS_TONE[status]}`} data-testid={`class-status-pill-${status}`}>
        {label}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${PILL_BASE} ${STATUS_TONE[status]} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]`}
        aria-label={t('classes.transition.trigger', { status: label })}
        data-testid={`class-status-pill-${status}`}
      >
        {label}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {nextStates.map((next) => (
          <DropdownMenuItem
            key={next}
            onSelect={() => onTransition?.(next)}
            data-testid={`class-status-option-${next}`}
          >
            {t(`classes.status.${next}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
