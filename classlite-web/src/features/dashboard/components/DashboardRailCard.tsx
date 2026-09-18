/**
 * DashboardRailCard — the generic `{count, items}` rail shell shared by the
 * teacher + student dashboards (Story 8-1b, D11). The headline shows the rail's
 * TRUE total (`block.count`, server-capped items ≤5), a "View all →" footer
 * routes OUT to the owning management surface (read-only glance — no inline
 * action), and an empty rail shows an informational, glance-only empty state
 * (`data-testid="rail-empty"`) with NO management CTA (AC7 / AC14, UX-1).
 *
 * The footer is a real `<a>` (routes out via React Router `<Link>`); it is
 * suppressed when the rail is empty so an empty glance never surfaces a CTA.
 */
import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'

export interface DashboardRailCardProps {
  /** Rail root testid, e.g. `rail-needs-grading` (drives the assert-absence spine). */
  testId: string
  /** Resolved rail title (caller owns i18n). */
  title: string
  /** The rail's true total — `block.count`, NOT `items.length`. */
  count: number
  /** Route-out target for the "View all →" footer. */
  viewAllHref: string
  /** Resolved "View all →" label. */
  viewAllLabel: string
  /** True when `items` is empty — renders the glance-only empty state. */
  isEmpty: boolean
  /** Resolved encouraging/informational empty copy. */
  emptyMessage: string
  /** The ≤5 rendered rows. */
  children?: ReactNode
}

export function DashboardRailCard({
  testId,
  title,
  count,
  viewAllHref,
  viewAllLabel,
  isEmpty,
  emptyMessage,
  children,
}: DashboardRailCardProps): ReactElement {
  return (
    <Card data-testid={testId} className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <h3 className="text-sm font-semibold text-[var(--cl-ink)]">{title}</h3>
        <span
          className="font-mono text-2xl leading-none text-[var(--cl-ink)]"
          aria-label={`${count}`}
        >
          {count}
        </span>
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <p
            data-testid="rail-empty"
            className="py-6 text-center text-sm text-[var(--cl-ink-soft)]"
          >
            {emptyMessage}
          </p>
        ) : (
          <ul className="space-y-2">{children}</ul>
        )}
      </CardContent>
      {isEmpty ? null : (
        <CardFooter>
          <Link
            to={viewAllHref}
            className="text-sm font-medium text-[var(--cl-accent)] hover:underline"
          >
            {viewAllLabel}
          </Link>
        </CardFooter>
      )}
    </Card>
  )
}
