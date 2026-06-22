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
 * AND focus reveal (WCAG 2.1.1 — two independent reveal paths).
 *
 * Accessible-name discipline (1d-3 review P23): the trigger has an
 * `aria-label` (which carries the badge announcement) and the Tooltip
 * primitive owns the hover/focus reveal — so we deliberately do NOT add
 * a native `title` attribute. Three sources of accessible name (label +
 * title + tooltip content) caused some AT to read "Inbox 3 unread,
 * Inbox" out loud.
 *
 * Disabled state (1d-3 review P3): when `disabled` is set we render a
 * non-link `<span role="link" aria-disabled="true" tabIndex={-1}>` so
 * keyboard Enter / Space cannot fire React Router navigation. The
 * previous `<Link aria-disabled="true">` blocked mouse via
 * `pointer-events-none` but still navigated on keyboard activation.
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
  const testId = `sidebar-nav-${slug}`

  const baseClassName =
    'group/nav-item flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'
  const stateClassName = active
    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

  const rowContents = (
    <>
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span aria-hidden="true" className="min-w-0 flex-1 truncate">
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
    </>
  )

  // Disabled — render an inert `<span>` so keyboard activation cannot
  // navigate. `role="link"` keeps the AT semantic; `aria-disabled` +
  // `tabIndex={-1}` drop it out of the tab order entirely. Tooltip
  // still wraps for label reveal.
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="link"
              aria-current={active ? 'page' : undefined}
              aria-label={ariaLabel}
              aria-disabled="true"
              tabIndex={-1}
              data-testid={testId}
              className={cn(baseClassName, stateClassName, 'opacity-50')}
            />
          }
        >
          {rowContents}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={href}
            aria-current={active ? 'page' : undefined}
            aria-label={ariaLabel}
            data-testid={testId}
            className={cn(baseClassName, stateClassName)}
          />
        }
      >
        {rowContents}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
