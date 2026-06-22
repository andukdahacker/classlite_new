import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { MoreHorizontalIcon } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * BreadcrumbBar — `s06` breadcrumb chrome.
 *
 * Domain wrapper around 1d-2's `Breadcrumb` primitive. Carries two
 * carry-over fixes from 1d-2 close-out (deferred-work.md 2026-06-17):
 *
 *   - The primitive's `BreadcrumbEllipsis` ships a hardcoded English
 *     `aria-label="More"` via the `sr-only` span. We render an
 *     i18n-keyed ellipsis here instead of composing it from the
 *     primitive.
 *   - The primitive's `BreadcrumbPage` renders `role="link"
 *     aria-disabled="true"` on the current item. We render the current
 *     item as a plain `<span aria-current="page">` instead — semantics
 *     match WAI-ARIA breadcrumb pattern without the spurious link role.
 *
 * Overflow strategy (1d-3 code-review D3): when `items.length >
 * truncateAt` the middle segments collapse into an interactive
 * `DropdownMenu` whose trigger is the more-icon and whose items are the
 * skipped middle segments (Link entries that navigate when clicked).
 * First + last items always render visibly. Default `truncateAt = 4`.
 * The previous decorative-icon implementation lost the skipped segments
 * entirely — keyboard and pointer users had no way to reach them.
 */
export interface BreadcrumbBarProps {
  items: ReadonlyArray<{ label: string; href?: string }>
  /** When item count exceeds this, middle segments collapse to an ellipsis menu. Default 4. */
  truncateAt?: number
}

export function BreadcrumbBar({ items, truncateAt = 4 }: BreadcrumbBarProps) {
  const { t } = useTranslation()
  if (items.length === 0) {
    // An empty `<Breadcrumb>` would render an unlabeled, structurally
    // empty navigation landmark. Skip the whole landmark instead.
    return null
  }
  const shouldTruncate = items.length > truncateAt
  const skippedMiddle = shouldTruncate ? items.slice(1, -1) : []
  const visibleItems = shouldTruncate
    ? [items[0], items[items.length - 1]]
    : items
  const moreLabel = t('topbar.breadcrumb.more')

  return (
    <Breadcrumb aria-label={t('topbar.breadcrumb.label')}>
      <BreadcrumbList>
        {visibleItems.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === visibleItems.length - 1
          const insertEllipsisMenu = shouldTruncate && isFirst
          return (
            <Fragment key={`${item.href ?? 'no-href'}|${item.label}|${index}`}>
              <BreadcrumbItem>
                {isLast ? (
                  <span
                    aria-current="page"
                    data-testid="breadcrumb-current"
                    className="font-normal text-foreground"
                  >
                    {item.label}
                  </span>
                ) : item.href ? (
                  <BreadcrumbLink render={<Link to={item.href}>{item.label}</Link>} />
                ) : (
                  <span>{item.label}</span>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator /> : null}
              {insertEllipsisMenu ? (
                <>
                  <BreadcrumbItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={moreLabel}
                        data-testid="breadcrumb-more-trigger"
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MoreHorizontalIcon aria-hidden="true" className="size-4" />
                        <span className="sr-only">{moreLabel}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {skippedMiddle.map((skipped, skippedIndex) =>
                          skipped.href ? (
                            <DropdownMenuItem
                              key={`${skipped.href}-${skippedIndex}`}
                              render={<Link to={skipped.href}>{skipped.label}</Link>}
                            />
                          ) : (
                            <DropdownMenuItem
                              key={`${skipped.label}-${skippedIndex}`}
                              disabled
                            >
                              {skipped.label}
                            </DropdownMenuItem>
                          ),
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              ) : null}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
