// Story 8-4b, Task 6 (AC15, AC16, D9; R-3) — accessibility + keyboard nav.
// RED-FIRST for the dialog-name association (AC16): the cmdk `CommandDialog`
// renders its sr-only <DialogTitle> as a SIBLING of <DialogContent>. If the
// aria-labelledby association is broken, `getByRole('dialog', { name })` fails
// to resolve EVEN THOUGH axe passes — so the name query, not axe, is the proof.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { RoleProvider } from '@/hooks/RoleContext'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'
import { SearchPalette } from '@/features/search/SearchPalette'
import {
  CLASS_ID,
  populatedResultsHandlers,
} from '@/features/search/api/__tests__/handlers'

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

function renderPalette(onOpenChange: (open: boolean) => void = () => {}): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RoleProvider value="owner">
          <MemoryRouter initialEntries={['/dashboard']}>
            <LocationProbe />
            <SearchPalette open onOpenChange={onOpenChange} />
          </MemoryRouter>
        </RoleProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

describe('SearchPalette — dialog name + combobox (AC16, R-3)', () => {
  test('the dialog is queryable BY its accessible name (aria-labelledby association)', () => {
    renderPalette()
    // Resolves ONLY if the sr-only sibling title is aria-labelledby-associated.
    expect(
      screen.getByRole('dialog', { name: i18n.t('search.dialog.title') }),
    ).toBeInTheDocument()
  })

  test('the input exposes role="combobox" + aria-expanded', () => {
    renderPalette()
    const combobox = screen.getByRole('combobox')
    expect(combobox).toBeInTheDocument()
    expect(combobox).toHaveAttribute('aria-expanded')
  })

  test('vitest-axe reports zero violations over the POPULATED results (FLOOR)', async () => {
    // Code review 2026-09-28: must audit the rendered result rows, not the idle
    // prompt. Type a query and wait for the CommandGroups before scanning —
    // otherwise the populated handlers are dead setup and result-row a11y is unscanned.
    server.use(...populatedResultsHandlers)
    const client = createTestQueryClient()
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <RoleProvider value="owner">
            <MemoryRouter>
              <SearchPalette open onOpenChange={() => {}} />
            </MemoryRouter>
          </RoleProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await userEvent.type(screen.getByRole('combobox'), 'nguy')
    await screen.findByTestId('search-group-classes')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('SearchPalette — result-count live region (AC16, D9)', () => {
  test('announces the interpolated result count via aria-live="polite"', async () => {
    server.use(...populatedResultsHandlers)
    renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'nguy')
    await screen.findByTestId('search-group-classes')
    const live = screen.getByTestId('search-live-count')
    expect(live).toHaveAttribute('aria-live', 'polite')
    // 5 categories × 1 item = 5 results (i18n-interpolated).
    expect(live).toHaveTextContent(i18n.t('search.results.count', { count: 5 }))
  })
})

describe('SearchPalette — keyboard flow (AC15, TEST-UX-2)', () => {
  test('↓ moves a VISIBLE highlight; Enter selects (navigates + closes)', async () => {
    server.use(...populatedResultsHandlers)
    const onOpenChange = vi.fn()
    renderPalette(onOpenChange)
    const combobox = screen.getByRole('combobox')
    await userEvent.type(combobox, 'nguy')
    await screen.findByTestId('search-group-classes')

    // cmdk selects the first item; the highlight is a real attribute, not colour-only.
    await waitFor(() => expect(document.querySelector('[data-selected="true"]')).not.toBeNull())
    const firstSelected = document.querySelector('[data-selected="true"]')
    expect(firstSelected).toHaveAttribute('data-testid', `search-item-class-${CLASS_ID}`)

    // ArrowDown moves the highlight OFF the first item (negative control).
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-selected="true"]')
          ?.getAttribute('data-testid'),
      ).not.toBe(`search-item-class-${CLASS_ID}`),
    )

    // Re-highlight the class row and Enter-select it → navigate + close.
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(`/classes/${CLASS_ID}`))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
