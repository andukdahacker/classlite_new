// Story 8-4b, Task 4 — the R-1 STRUCTURAL passthrough renderer. RED-FIRST (AC11):
// `@/features/search/components/SearchResultsList` does not exist yet (TS2307).
//
// AC11 (the vacuous "render a students category for a student" test was KILLED):
// the renderer emits the payload VERBATIM. rendered categories === the payload's
// non-empty keys IN SERVER ORDER, and per-category item count === items.length,
// element-by-element. Any `.filter`/`.slice`/reorder/role-branch a future dev
// slips in drops a count or reorders → RED.
//
// STRUCTURAL backing (Winston/Murat): the renderer's props type has NO `role`
// field — a scope filter is unexpressible. `role` lives only in resultHref
// (tested in resultHref.test.ts). This file passes NO role and never could.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { Command, CommandList } from '@/components/ui/command'
import { SearchResultsList } from '@/features/search/components/SearchResultsList'
import {
  CATEGORY_KEYS,
  hasMoreResults,
  nullSubtitleResults,
  populatedResults,
} from '@/features/search/api/__tests__/handlers'
import type { SearchResults } from '@/features/search/api/useSearch'

function renderList(
  results: SearchResults,
  handlers: {
    onSelectItem?: (item: unknown) => void
    onSelectSeeAll?: (category: unknown) => void
  } = {},
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <Command shouldFilter={false}>
        <CommandList>
          <SearchResultsList
            results={results}
            query="nguy"
            onSelectItem={handlers.onSelectItem ?? (() => {})}
            onSelectSeeAll={handlers.onSelectSeeAll ?? (() => {})}
          />
        </CommandList>
      </Command>
    </I18nextProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('SearchResultsList — verbatim passthrough in server order (AC11)', () => {
  test('renders one group per NON-EMPTY category, in the fixed server order', () => {
    renderList(populatedResults)
    const groups = screen.getAllByTestId(/^search-group-/)
    const renderedOrder = groups.map((g) => g.getAttribute('data-testid'))
    // populatedResults has all 5 categories non-empty → all 5 render, in order.
    expect(renderedOrder).toEqual(CATEGORY_KEYS.map((k) => `search-group-${k}`))
  })

  test('per-category rendered item count === payload items.length, element-by-element', () => {
    renderList(populatedResults)
    for (const key of CATEGORY_KEYS) {
      const group = screen.getByTestId(`search-group-${key}`)
      const rows = within(group).getAllByTestId(/^search-item-/)
      expect(rows).toHaveLength(populatedResults[key].items.length)
      // Element-by-element: the i-th rendered row is the i-th payload item.
      populatedResults[key].items.forEach((item, i) => {
        expect(rows[i]).toHaveAttribute('data-testid', `search-item-${item.type}-${item.id}`)
      })
    }
  })

  test('an EMPTY category is omitted (AC7) — not rendered as a blank group', () => {
    // hasMoreResults has ONLY classes populated; the other four are empty.
    renderList(hasMoreResults)
    const groups = screen.getAllByTestId(/^search-group-/)
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual(['search-group-classes'])
    expect(screen.queryByTestId('search-group-students')).not.toBeInTheDocument()
  })
})

describe('SearchResultsList — item anatomy (AC8, D11)', () => {
  test('each item shows a per-type icon, title, and subtitle', () => {
    renderList(populatedResults)
    const classRow = screen.getByTestId(
      `search-item-class-${populatedResults.classes.items[0].id}`,
    )
    expect(within(classRow).getByText('IELTS Foundation A')).toBeInTheDocument()
    expect(within(classRow).getByText('Writing · active')).toBeInTheDocument()
    // A per-type icon (lucide renders an <svg>).
    expect(classRow.querySelector('svg')).toBeInTheDocument()
  })

  test('a null subtitle renders NO subtitle line (never the string "null")', () => {
    renderList(nullSubtitleResults)
    const row = screen.getByTestId(
      `search-item-exercise-${nullSubtitleResults.exercises.items[0].id}`,
    )
    expect(within(row).getByText('Untitled drill')).toBeInTheDocument()
    expect(within(row).queryByText('null')).not.toBeInTheDocument()
    expect(within(row).queryByTestId('search-subtitle')).not.toBeInTheDocument()
  })

  test('CommandItem value is `${type}:${id}` (stable/unique)', () => {
    renderList(populatedResults)
    const item = populatedResults.students.items[0]
    const row = screen.getByTestId(`search-item-student-${item.id}`)
    expect(row).toHaveAttribute('data-value', `${item.type}:${item.id}`)
  })
})

describe('SearchResultsList — the "See all" doorway (AC10, D12)', () => {
  test('a hasMore category renders an actionable "See all" row', () => {
    renderList(hasMoreResults)
    expect(screen.getByTestId('search-seeall-classes')).toBeInTheDocument()
  })

  test('a hasMore:false category renders NO doorway', () => {
    renderList(populatedResults) // every category hasMore:false
    expect(screen.queryByTestId(/^search-seeall-/)).not.toBeInTheDocument()
  })

  test('selecting the doorway invokes onSelectSeeAll with the category key', async () => {
    const onSelectSeeAll = vi.fn()
    renderList(hasMoreResults, { onSelectSeeAll })
    await userEvent.click(screen.getByTestId('search-seeall-classes'))
    expect(onSelectSeeAll).toHaveBeenCalledWith('classes')
  })

  test('selecting an item invokes onSelectItem with that item', async () => {
    const onSelectItem = vi.fn()
    renderList(populatedResults, { onSelectItem })
    await userEvent.click(
      screen.getByTestId(`search-item-class-${populatedResults.classes.items[0].id}`),
    )
    expect(onSelectItem).toHaveBeenCalledWith(populatedResults.classes.items[0])
  })
})
