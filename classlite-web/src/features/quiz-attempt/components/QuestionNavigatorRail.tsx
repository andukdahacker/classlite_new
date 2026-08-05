/**
 * QuestionNavigatorRail — Story 5.2b Task 7 (AC7/AC8, Sally-I5). A numbered dot
 * per question — done / current / flagged / pending — where clicking a dot jumps
 * to that question (the caller moves focus to its first input). Each dot is a
 * real button (keyboard-reachable); the current dot carries `aria-current`.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface NavigatorItem {
  handle: string
  /** 1-based global question number. */
  number: number
}

export interface QuestionNavigatorRailProps {
  items: NavigatorItem[]
  answered: ReadonlySet<string>
  flagged: ReadonlySet<string>
  currentHandle: string | null
  onJump: (handle: string) => void
}

type DotState = 'current' | 'flagged' | 'done' | 'pending'

function dotState(
  handle: string,
  current: string | null,
  answered: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
): DotState {
  if (handle === current) return 'current'
  if (flagged.has(handle)) return 'flagged'
  if (answered.has(handle)) return 'done'
  return 'pending'
}

export function QuestionNavigatorRail({
  items,
  answered,
  flagged,
  currentHandle,
  onJump,
}: QuestionNavigatorRailProps) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('attempt.nav.title')} data-testid="navigator-rail">
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const state = dotState(item.handle, currentHandle, answered, flagged)
          const isCurrent = state === 'current'
          const isFlagged = flagged.has(item.handle)
          return (
            <li key={item.handle}>
              <button
                type="button"
                onClick={() => onJump(item.handle)}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={t('attempt.nav.jumpTo', { number: item.number })}
                data-testid={`nav-dot-${item.handle}`}
                data-state={state}
                className={cn(
                  // size-11 = 44px — meets the ≥44×44 touch target (AC21/TEST-UX-4).
                  'relative flex size-11 items-center justify-center rounded-[var(--cl-radius-sm)] border text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-accent)]',
                  state === 'current' &&
                    'border-[var(--cl-accent)] bg-[var(--cl-accent)] text-[var(--cl-surface)]',
                  state === 'done' &&
                    'border-[var(--cl-success)] bg-[var(--cl-success)]/15 text-[var(--cl-ink)]',
                  state === 'pending' &&
                    'border-[var(--cl-line)] bg-[var(--cl-surface)] text-[var(--cl-ink-soft)]',
                  state === 'flagged' &&
                    'border-[var(--cl-amber)] bg-[var(--cl-amber)]/15 text-[var(--cl-ink)]',
                )}
              >
                {item.number}
                {isFlagged && !isCurrent ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 text-[var(--cl-amber)]"
                  >
                    ⚑
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
