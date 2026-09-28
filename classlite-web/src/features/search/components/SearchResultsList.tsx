import { useTranslation } from 'react-i18next'
import {
  ClipboardList,
  Dumbbell,
  FileText,
  GraduationCap,
  User,
  type LucideIcon,
} from 'lucide-react'
import { CommandGroup, CommandItem } from '@/components/ui/command'
import type {
  SearchResultItem,
  SearchResults,
} from '@/features/search/api/useSearch'
import { CATEGORY_ORDER, type SearchCategoryKey } from '@/features/search/lib/resultHref'

/**
 * SearchResultsList — the R-1 STRUCTURAL passthrough renderer (Story 8-4b, D5).
 *
 * It emits the server payload VERBATIM: one `CommandGroup` per NON-EMPTY
 * category in the fixed `CATEGORY_ORDER`, each item in server order (the backend
 * already ranked by `similarity DESC`, so cmdk's own filter is disabled upstream
 * via `shouldFilter={false}`). Per category with `hasMore`, a "See all" doorway
 * row (D12) into the existing list view.
 *
 * The props type has NO `role` field ON PURPOSE — scope is a SERVER guarantee
 * (R-1), so a client-side scope filter is UNEXPRESSIBLE here. `role` enters only
 * through `resultHref`/`seeAllHref`, which the parent invokes inside the select
 * callbacks. Adding a role prop (or any `.filter`/`.slice`/reorder) reddens the
 * passthrough-order test (AC11).
 */
export interface SearchResultsListProps {
  /** The server payload, rendered verbatim. */
  results: SearchResults
  /** The current query — only for the "See all for '{q}'" doorway label. */
  query: string
  /** Called with the selected item; the parent composes the deep-link + closes. */
  onSelectItem: (item: SearchResultItem) => void
  /** Called with the category key of a selected "See all" doorway. */
  onSelectSeeAll: (category: SearchCategoryKey) => void
}

const ICON_BY_TYPE: Record<SearchResultItem['type'], LucideIcon> = {
  class: GraduationCap,
  student: User,
  exercise: Dumbbell,
  assignment: ClipboardList,
  file: FileText,
}

export function SearchResultsList({
  results,
  query,
  onSelectItem,
  onSelectSeeAll,
}: SearchResultsListProps) {
  const { t } = useTranslation()

  return (
    <>
      {CATEGORY_ORDER.map((key) => {
        const category = results[key]
        if (category.items.length === 0) return null
        return (
          <CommandGroup
            key={key}
            data-testid={`search-group-${key}`}
            heading={t(`search.category.${key}`)}
          >
            {category.items.map((item) => {
              // Fallback guards a drift-produced out-of-union `type` from
              // rendering `undefined` as an element (crashes the list). Not
              // reachable under the frozen 5-type contract (code review 2026-09-28).
              const Icon = ICON_BY_TYPE[item.type] ?? FileText
              const value = `${item.type}:${item.id}`
              return (
                <CommandItem
                  key={value}
                  value={value}
                  data-value={value}
                  data-testid={`search-item-${item.type}-${item.id}`}
                  onSelect={() => onSelectItem(item)}
                >
                  <Icon aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.title}</span>
                    {item.subtitle !== null && (
                      <span
                        data-testid="search-subtitle"
                        className="truncate text-xs text-muted-foreground"
                      >
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                </CommandItem>
              )
            })}
            {category.hasMore && (
              <CommandItem
                key={`seeall:${key}`}
                value={`seeall:${key}`}
                data-testid={`search-seeall-${key}`}
                className="text-sm text-muted-foreground"
                onSelect={() => onSelectSeeAll(key)}
              >
                {t('search.seeAll', { query })}
              </CommandItem>
            )}
          </CommandGroup>
        )
      })}
    </>
  )
}
