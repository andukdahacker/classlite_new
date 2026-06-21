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
 * Overflow strategy: when `items.length > truncateAt` the middle
 * segments collapse to a single ellipsis. First + last items always
 * render. Default `truncateAt = 4`.
 */
export interface BreadcrumbBarProps {
  items: ReadonlyArray<{ label: string; href?: string }>
  /** When item count exceeds this, middle segments collapse to ellipsis. Default 4. */
  truncateAt?: number
}

export function BreadcrumbBar({ items, truncateAt = 4 }: BreadcrumbBarProps) {
  const { t } = useTranslation()
  const shouldTruncate = items.length > truncateAt
  const visibleItems = shouldTruncate
    ? [items[0], items[items.length - 1]]
    : items

  return (
    <Breadcrumb aria-label={t('topbar.breadcrumb.label')}>
      <BreadcrumbList>
        {visibleItems.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === visibleItems.length - 1
          const insertEllipsis = shouldTruncate && isFirst
          return (
            <Fragment key={`${item.label}-${index}`}>
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
              {insertEllipsis ? (
                <>
                  <BreadcrumbItem>
                    <span
                      role="presentation"
                      aria-hidden="true"
                      className="flex size-5 items-center justify-center"
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </span>
                    <span className="sr-only">{t('topbar.breadcrumb.more')}</span>
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
