import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * SidebarNavItem — `s06` sidebar row.
 *
 * Pure layout: icon + label + optional unread badge. No role-conditional
 * branches (UX-3). Active state derived by the consumer (route match);
 * `aria-current="page"` set when `active` is true. Badge aria-label is
 * i18n-templated via `sidebar.nav.unreadAria` so screen readers announce
 * count + item name. Vietnamese long labels truncate visually at 220px
 * while the full label is preserved via `aria-label` + Tooltip on hover
 * AND focus + native `title` attribute (WCAG 2.1.1 — three independent
 * reveal paths so no user class is stranded).
 */
export interface SidebarNavItemProps {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /** Active state derived by the consumer (route match). */
  active?: boolean
  /** Unread/notification count. Renders the `Badge` primitive when > 0. */
  badgeCount?: number
  disabled?: boolean
}

function slugFromKey(labelKey: string): string {
  const tail = labelKey.split('.').pop() ?? labelKey
  return tail
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase()
}

export function SidebarNavItem({
  labelKey,
  icon,
  href,
  active,
  badgeCount,
  disabled,
}: SidebarNavItemProps) {
  const { t } = useTranslation()
  const label = t(labelKey)
  const hasBadge = typeof badgeCount === 'number' && badgeCount > 0
  const ariaLabel = hasBadge
    ? t('sidebar.nav.unreadAria', { item: label, count: badgeCount })
    : label
  const slug = slugFromKey(labelKey)

  const content = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={href}
            aria-current={active ? 'page' : undefined}
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            title={label}
            data-testid={`sidebar-nav-${slug}`}
            className={cn(
              'group/nav-item flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              disabled && 'pointer-events-none opacity-50',
            )}
          />
        }
      >
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span
          aria-hidden="true"
          className="min-w-0 flex-1 truncate"
        >
          {label}
        </span>
        {hasBadge ? (
          <Badge
            variant="secondary"
            aria-hidden="true"
            className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground"
          >
            {badgeCount}
          </Badge>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return content
}
