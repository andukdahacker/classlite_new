// Story 8-4b, Task 5 (AC1, AC2) — the palette wired into AppLayout: the global
// ⌘K/Ctrl+K listener opens it from anywhere, the topbar SearchPill click opens
// it, and Escape closes it + returns focus to the trigger. Mirrors the shipped
// AppLayout.test harness (RoleProvider + createMemoryRouter) plus the
// QueryClientProvider + I18nextProvider the palette's useSearch/i18n need.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import AppLayout from '@/components/shared/AppLayout'
import { __resetWarnTrackingForTests } from '@/components/shared/AppLayout-warn-tracking'
import { RoleProvider } from '@/hooks/RoleContext'
import type { Role } from '@/hooks/useRole'
import { useUIStore } from '@/stores/uiStore'
import { useLanguageStore } from '@/stores/languageStore'
import { createTestQueryClient } from '@/lib/query-client'
import { queryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'

function renderShell(role: Role = 'owner') {
  const client = createTestQueryClient()
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: () => (
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <RoleProvider value={role}>
                <AppLayout />
              </RoleProvider>
            </I18nextProvider>
          </QueryClientProvider>
        ),
        children: [{ index: true, element: <div data-testid="route-child">child</div> }],
      },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

function pressCmdK(): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    )
  })
}

beforeEach(() => {
  useUIStore.getState().reset()
  useLanguageStore.getState().reset()
  __resetWarnTrackingForTests()
  queryClient.removeQueries({ queryKey: authKeys.session() })
})

afterEach(() => server.resetHandlers())

describe('SearchPalette ↔ AppLayout wiring (AC1, AC2)', () => {
  test('⌘K opens the palette from anywhere (global listener)', async () => {
    renderShell()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    pressCmdK()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('a second ⌘K toggles the palette closed', async () => {
    renderShell()
    pressCmdK()
    await screen.findByRole('dialog')
    pressCmdK()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('clicking the topbar SearchPill opens the palette (AC2)', async () => {
    renderShell()
    await userEvent.click(screen.getByTestId('search-pill'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('Escape closes the palette and returns focus to the SearchPill trigger', async () => {
    renderShell()
    const pill = screen.getByTestId('search-pill')
    await userEvent.click(pill)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(pill))
  })

  test('the guest shell (no role) does NOT mount the palette', () => {
    renderShell(null as unknown as Role)
    pressCmdK()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
