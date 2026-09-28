import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from '@/components/ui/command'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useRole } from '@/hooks/useRole'
import { SearchResultsList } from '@/features/search/components/SearchResultsList'
import {
  isSearchable,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_QUERY_LENGTH,
  useSearch,
  type SearchResultItem,
} from '@/features/search/api/useSearch'
import {
  CATEGORY_ORDER,
  resultHref,
  seeAllHref,
  type SearchCategoryKey,
} from '@/features/search/lib/resultHref'

export interface SearchPaletteProps {
  /** Whether the palette is open (owned by `useCommandPalette`). */
  open: boolean
  /** Fired on Escape / backdrop / a re-press close. */
  onOpenChange: (open: boolean) => void
}

const SKELETON_ROW_COUNT = 4

/**
 * SearchPalette — the ⌘K/Ctrl+K command-palette overlay (Story 8-4b) over the
 * DONE 8-4a `GET /api/search` contract. Scope is 100% server-enforced; this
 * renders whatever comes back and NEVER re-derives scope (R-1).
 *
 * The body is gated on `open` so its query state (raw query + `useSearch`) mounts
 * FRESH each open — the last query is never recalled on reopen (privacy on shared
 * machines; recent-search history is FU-8-4-RECENTS, explicitly out of scope).
 */
export function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const { t } = useTranslation()
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('search.dialog.title')}
      description={t('search.dialog.description')}
      className="max-w-xl"
    >
      {open && <SearchPaletteBody onClose={() => onOpenChange(false)} />}
    </CommandDialog>
  )
}

function SearchPaletteBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = useRole()
  const [rawQuery, setRawQuery] = useState('')
  const debouncedQuery = useDebouncedValue(rawQuery, SEARCH_DEBOUNCE_MS)
  // Trim once for the network read AND the on-screen echoes so a padded query
  // never fragments the cache or shows quotes wrapped around spaces (code review
  // 2026-09-28). `useSearch` also trims defensively.
  const trimmedQuery = debouncedQuery.trim()
  const query = useSearch(trimmedQuery)

  const searchable = isSearchable(trimmedQuery)
  const data = query.data
  const allEmpty =
    data != null && CATEGORY_ORDER.every((key) => data[key].items.length === 0)
  // `keepPreviousData` keeps `data` non-null across a query change, so it can hold
  // the PRIOR query's payload while the current one is in flight. Reconcile the
  // state machine with `isPlaceholderData` so we never echo "No matches for
  // '{newQuery}'" from a stale-empty placeholder (code review 2026-09-28).
  const isStalePlaceholder = query.isPlaceholderData
  const hasCurrentData = data != null && !isStalePlaceholder

  // State machine (D10): idle (below floor) → error → results → empty → loading.
  const showIdle = !searchable
  const showError = searchable && query.isError
  // Prior non-empty results stay visible during a refetch (anti-flash, intended).
  const showResults = searchable && !query.isError && data != null && !allEmpty
  // Empty ONLY for the CURRENT query's payload — never a stale-empty placeholder.
  const showEmpty = searchable && !query.isError && hasCurrentData && allEmpty
  // Loading when there is nothing to show yet: no data, OR a stale-empty
  // placeholder (prior query had no matches, so there is nothing to hold).
  const showLoading =
    searchable &&
    !query.isError &&
    (data == null || (isStalePlaceholder && allEmpty))

  const resultCount = showResults
    ? CATEGORY_ORDER.reduce((sum, key) => sum + data[key].items.length, 0)
    : 0

  // The combobox popup is "expanded" whenever the list shows query-driven content
  // (skeleton / error+retry / "no matches" / results) — NOT only on results, or a
  // screen reader hears "collapsed" over a populated listbox (code review 2026-09-28).
  const popupExpanded = showResults || showLoading || showEmpty || showError

  // A nullish href = no reachable destination for this role (e.g. a student's
  // class result — no student class route exists yet, FU-8-4-STUDENT-ROUTES) or a
  // drift-produced out-of-union type. No-op the selection so the palette stays
  // open instead of navigating to a would-be-denied or `undefined` route.
  function go(href: string | null | undefined): void {
    if (href === null || href === undefined) return
    navigate(href)
    onClose()
  }

  return (
    <Command shouldFilter={false}>
      <CommandInput
        value={rawQuery}
        onValueChange={setRawQuery}
        role="combobox"
        aria-expanded={popupExpanded}
        aria-controls="search-result-list"
        placeholder={t('search.input.placeholder')}
      />
      <CommandList id="search-result-list" aria-busy={query.isFetching || undefined}>
        {showIdle && (
          <div
            data-testid="search-idle"
            className="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {t('search.idle.prompt', { min: SEARCH_MIN_QUERY_LENGTH })}
          </div>
        )}

        {showLoading && (
          <div data-testid="search-skeleton" className="space-y-2 p-2">
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded-md bg-muted"
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {showError && (
          <div
            role="alert"
            data-testid="search-error"
            className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm"
          >
            <span>{t('search.error.message')}</span>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('search.error.retry')}
            </button>
          </div>
        )}

        {showEmpty && (
          <div
            role="status"
            data-testid="search-empty"
            className="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {t('search.empty', { query: trimmedQuery })}
          </div>
        )}

        {showResults && (
          <SearchResultsList
            results={data}
            query={trimmedQuery}
            onSelectItem={(item: SearchResultItem) => go(resultHref(item, role))}
            onSelectSeeAll={(category: SearchCategoryKey) =>
              go(seeAllHref(category, role))
            }
          />
        )}
      </CommandList>

      {/* Result-count announcement for screen readers (D9). */}
      <div className="sr-only" aria-live="polite" data-testid="search-live-count">
        {showResults ? t('search.results.count', { count: resultCount }) : ''}
      </div>
    </Command>
  )
}
