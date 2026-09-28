// Story 8-4b, Task 4 — the SearchPalette state machine (D10) + AC4 debounce
// collapse. RED-FIRST for AC4: `@/features/search/SearchPalette` does not exist
// yet (TS2307). Real QueryClient + MSW at the HTTP boundary (TEST-FE-1) — the
// real useSearch/useDebouncedValue run.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'
import { SearchPalette } from '@/features/search/SearchPalette'
import { SEARCH_DEBOUNCE_MS } from '@/features/search/api/useSearch'
import {
  CATEGORY_KEYS,
  emptyResults,
  emptyResultsHandlers,
  populatedResultsHandlers,
  search500Handlers,
} from '@/features/search/api/__tests__/handlers'

const SERVER_TIME = '2026-09-28T10:00:00.000Z'

function renderPalette(open = true): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SearchPalette open={open} onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

describe('SearchPalette — idle / type-more (AC14)', () => {
  test('just-opened with no query shows the idle prompt, not a spinner or "no results"', () => {
    server.use(...emptyResultsHandlers)
    renderPalette()
    expect(screen.getByTestId('search-idle')).toBeInTheDocument()
    expect(screen.queryByTestId('search-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument()
  })

  test('a sub-threshold query stays idle and issues no request (spy-proven)', async () => {
    const spy = vi.fn()
    server.use(
      http.get('/api/search', () => {
        spy()
        return HttpResponse.json({ data: emptyResults, meta: { serverTime: SERVER_TIME } })
      }),
    )
    renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'ab')
    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 50))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('search-idle')).toBeInTheDocument()
  })
})

describe('SearchPalette — debounce collapses a burst to ONE request (AC4)', () => {
  test('a fast N-char burst issues exactly one GET for the FINAL value', async () => {
    const spy = vi.fn<(q: string | null) => void>()
    server.use(
      http.get('/api/search', ({ request }) => {
        spy(new URL(request.url).searchParams.get('q'))
        return HttpResponse.json({ data: emptyResults, meta: { serverTime: SERVER_TIME } })
      }),
    )
    // delay:null → all keystrokes land in one tick, so only the FINAL value ever
    // clears the debounce window (no per-keystroke intermediate request).
    const user = userEvent.setup({ delay: null })
    renderPalette()
    await user.type(screen.getByRole('combobox'), 'nguy')
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith('nguy')
  })
})

describe('SearchPalette — results grouping (AC7)', () => {
  test('renders one CommandGroup per non-empty category in server order', async () => {
    server.use(...populatedResultsHandlers)
    renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'nguy')
    await screen.findByTestId('search-group-classes')
    const groups = screen.getAllByTestId(/^search-group-/)
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual(
      CATEGORY_KEYS.map((k) => `search-group-${k}`),
    )
  })
})

describe('SearchPalette — empty state (AC12)', () => {
  test('q≥3 with every category empty renders the calm-recovery empty state', async () => {
    server.use(...emptyResultsHandlers)
    renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'zzz')
    expect(await screen.findByTestId('search-empty')).toBeInTheDocument()
    // The interpolated query echoes back (calm recovery, never "No data found").
    expect(within(screen.getByTestId('search-empty')).getByText(/zzz/)).toBeInTheDocument()
    expect(screen.queryByTestId('search-idle')).not.toBeInTheDocument()
  })
})

describe('SearchPalette — no stale "no matches" flash (code review 2026-09-28)', () => {
  test('after an empty result, an in-flight new query shows loading — never "No matches for {newQuery}"', async () => {
    // Reproduces the keepPreviousData/state-machine bug: the prior query resolved
    // EMPTY, so keepPreviousData holds an empty payload while the NEW query is in
    // flight. Without reconciling on isPlaceholderData the palette echoes
    // "No matches for '{newQuery}'" before the new results even arrive.
    let call = 0
    let releaseSecond: () => void = () => {}
    const secondPending = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    server.use(
      http.get('/api/search', async () => {
        call += 1
        if (call > 1) await secondPending
        return HttpResponse.json({
          data: emptyResults,
          meta: { serverTime: SERVER_TIME },
        })
      }),
    )
    renderPalette()
    const combobox = screen.getByRole('combobox')
    await userEvent.type(combobox, 'zzz')
    await screen.findByTestId('search-empty') // first query resolves empty

    // Type more → the second query fires and is held pending.
    await userEvent.type(combobox, 'q')
    // During the pending window: loading skeleton, NOT a stale empty echo.
    await screen.findByTestId('search-skeleton')
    expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument()

    releaseSecond()
    // Once the (also-empty) second query resolves, the empty state returns.
    await screen.findByTestId('search-empty')
  })
})

describe('SearchPalette — error + retry (AC13, TEST-FE-2)', () => {
  test('a 500 renders a human error + a Retry that re-fires the current query', async () => {
    server.use(...search500Handlers)
    renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'nguy')
    const errorBox = await screen.findByTestId('search-error')
    expect(within(errorBox).queryByText('500')).not.toBeInTheDocument()
    // Recover: swap to a healthy handler, click retry, results appear.
    server.use(...populatedResultsHandlers)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('search.error.retry') }))
    await waitFor(() => expect(screen.getByTestId('search-group-classes')).toBeInTheDocument())
  })
})
