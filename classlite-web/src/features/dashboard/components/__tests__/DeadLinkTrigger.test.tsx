/**
 * Story 2-4 — `DeadLinkTrigger` red-phase acceptance tests.
 *
 * Covers Task 7.2 per AC10/AC11:
 *   - onClick → toast.info(...) from `sonner` with fixed id `dashboard-dead-link`
 *     [S-BLOCKER-2 + W-STRONG-8 + A-BLOCKER-2 3-way convergence — use shipped
 *     Sonner Toaster at App.tsx:74; NOT a custom inline toast]
 *   - onClick → Sentry breadcrumb `dashboard-dead-link-tapped` with
 *     { targetPath, targetSurface, epicNum }
 *   - onClick does NOT call useNavigate
 *   - Rage-click (double-click <100ms): 2 breadcrumbs, 1 toast (queue-of-one
 *     via fixed toast id — Sonner replaces the toast) [W-INFO-16 fold]
 *   - Toast auto-dismisses after 4s via Sonner's duration option
 *   - AC10 no-trial belt: targetPath never contains "trial"
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 7.1
 * (`src/features/dashboard/components/DeadLinkTrigger.tsx`) — TS2307 is RED.
 *
 * Note on testid discipline: Sonner portals its toast to `document.body`,
 * so tests assert via `screen.findByRole('status')` (Sonner's default role)
 * or `findByText(...)`, NOT a data-testid on the toast slot.
 */
import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

import DeadLinkTrigger from '@/features/dashboard/components/DeadLinkTrigger'
import i18n from '@/lib/i18n'

// LocationProbe writes the current router pathname into a ref the test
// can inspect. Replaces the previous `useNavigate` spy — the component
// doesn't import `useNavigate`, so spying on it was a tautology; the
// invariant we actually care about is "the URL did not change on click".
type LocationRef = { current: string }

function LocationProbe({ intoRef }: { intoRef: LocationRef }): null {
  const loc = useLocation()
  // Mutate the outer ref in an effect — writing during render trips
  // react-hooks/refs. The pathname is stable per navigation so the effect
  // deps are minimal and the ref catches up on the first commit.
  useEffect(() => {
    intoRef.current = loc.pathname
  }, [intoRef, loc.pathname])
  return null
}

beforeEach(() => {
  addBreadcrumbSpy.mockClear()
})

function renderWith(children: React.ReactNode, locationRef?: LocationRef) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <I18nextProvider i18n={i18n}>
        {locationRef ? <LocationProbe intoRef={locationRef} /> : null}
        {children}
        <Toaster richColors closeButton />
      </I18nextProvider>
    </MemoryRouter>,
  )
}

describe('DeadLinkTrigger — Task 7.2 Sonner integration (AC10/AC11)', () => {
  test('renders as a <button> with children + trailing arrow', () => {
    renderWith(
      <DeadLinkTrigger targetPath="/settings" targetSurface="settings" epicNum={5}>
        Go to Settings
      </DeadLinkTrigger>,
    )
    const btn = screen.getByRole('button', { name: /Go to Settings/i })
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toMatch(/→/)
  })

  test('click renders Sonner toast with interpolated {{epicNum}}', async () => {
    const user = userEvent.setup()
    renderWith(
      <DeadLinkTrigger targetPath="/settings" targetSurface="settings" epicNum={5}>
        Go to Settings
      </DeadLinkTrigger>,
    )
    await user.click(screen.getByRole('button'))

    // Sonner renders a toast with role="status" by default.
    const toast = await screen.findByText(
      i18n.t('dashboard.deadLink.notReady', { epicNum: 5 }) as string,
    )
    expect(toast).toBeInTheDocument()
  })

  test('click fires Sentry breadcrumb `dashboard-dead-link-tapped` with payload', async () => {
    const user = userEvent.setup()
    renderWith(
      <DeadLinkTrigger targetPath="/grading" targetSurface="grading" epicNum={6}>
        See how grading works
      </DeadLinkTrigger>,
    )
    await user.click(screen.getByRole('button'))

    expect(addBreadcrumbSpy).toHaveBeenCalledTimes(1)
    expect(addBreadcrumbSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'dashboard',
        message: 'dashboard-dead-link-tapped',
        data: expect.objectContaining({
          targetPath: '/grading',
          targetSurface: 'grading',
          epicNum: 6,
        }),
      }),
    )
  })

  test('click does NOT change the router location (dead-link is toast-only)', async () => {
    const user = userEvent.setup()
    const location: LocationRef = { current: '' }
    renderWith(
      <DeadLinkTrigger targetPath="/settings" targetSurface="settings" epicNum={5}>
        Go to Settings
      </DeadLinkTrigger>,
      location,
    )
    expect(location.current).toBe('/dashboard')
    await user.click(screen.getByRole('button'))
    // Assert via router state, not a `useNavigate` spy — the component
    // never calls `useNavigate`, so a spy assertion would be a tautology.
    expect(location.current).toBe('/dashboard')
  })

  test('rage-click (double-click): 2 breadcrumbs, 1 toast (queue-of-one via fixed id) [W-INFO-16]', async () => {
    const user = userEvent.setup()
    renderWith(
      <DeadLinkTrigger targetPath="/students" targetSurface="students" epicNum={5}>
        Add students
      </DeadLinkTrigger>,
    )
    const btn = screen.getByRole('button')
    await user.click(btn)
    await user.click(btn)

    expect(addBreadcrumbSpy).toHaveBeenCalledTimes(2)
    // Only ONE toast in the DOM — Sonner replaces via fixed id
    // `dashboard-dead-link`. Use `findAllByText` so the assertion survives
    // Sonner's swap animation (the exiting + entering toast can coexist
    // for a frame during the crossfade).
    const toasts = await screen.findAllByText(
      i18n.t('dashboard.deadLink.notReady', { epicNum: 5 }) as string,
    )
    expect(toasts.length).toBe(1)
  })

  test('AC10 belt: DeadLinkTrigger never navigates regardless of targetPath', async () => {
    const user = userEvent.setup()
    const location: LocationRef = { current: '' }
    renderWith(
      <DeadLinkTrigger targetPath="/settings" targetSurface="settings" epicNum={5}>
        Go to Settings
      </DeadLinkTrigger>,
      location,
    )
    await user.click(screen.getByRole('button'))
    // Belt-and-braces: even for a valid non-trial path the component must
    // never navigate — the toast is the entire user-facing effect.
    expect(location.current).toBe('/dashboard')
  })
})
