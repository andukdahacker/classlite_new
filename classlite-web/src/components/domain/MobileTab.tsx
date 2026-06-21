import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * MobileTab — single bottom-tab cell (`s74–s86`). Icon + label + optional
 * red-dot / numeric badge. Touch-target ≥44×44px per TEST-UX-4 (1D-P1-105..108).
 */
export interface MobileTabProps {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  active?: boolean
  /**
   * Unread indicator. `number > 0` renders a numeric badge ("1"…"9+");
   * `true` renders a red dot; `false` / undefined renders nothing.
   */
  hasUnread?: boolean | number
  testIdSlug: string
  onActivate?: (href: string) => void
}

function slugFromKey(labelKey: string): string {
  const tail = labelKey.split('.').pop() ?? labelKey
  return tail.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function renderUnreadBadge(unread: boolean | number | undefined) {
  if (!unread) return null
  if (unread === true) {
    return (
      <span
        aria-hidden="true"
        className="absolute top-1.5 right-3 size-2 rounded-full bg-destructive"
      />
    )
  }
  const text = unread >= 10 ? '9+' : String(unread)
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[10px] leading-none text-destructive-foreground"
    >
      {text}
    </span>
  )
}

export function MobileTab({
  labelKey,
  icon,
  href,
  active,
  hasUnread,
  testIdSlug,
  onActivate,
}: MobileTabProps) {
  const { t } = useTranslation()
  const label = t(labelKey)
  const unreadCount = typeof hasUnread === 'number' ? hasUnread : undefined
  const ariaLabel = unreadCount && unreadCount > 0
    ? t('sidebar.nav.unreadAria', { item: label, count: unreadCount })
    : label
  const slug = testIdSlug || slugFromKey(labelKey)

  return (
    <Link
      to={href}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      data-testid={`mobile-tab-${slug}`}
      onClick={() => onActivate?.(href)}
      className={cn(
        'relative flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-2 py-1 text-xs',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span aria-hidden="true" className="flex size-5 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {renderUnreadBadge(hasUnread)}
    </Link>
  )
}
