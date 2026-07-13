/**
 * SaveAndFinishLaterLink test — Round 1 Chunk 3 code review R1-C3-P1 fold.
 *
 * Covers the Round 1 Chunk 2 folds baked into the shared component +
 * `useSaveAndFinishLater` hook:
 *
 *  - **R1-C2-P1** — `leaving` state prevents double-click (button becomes
 *    `disabled` after first click and stays that way through resolution).
 *  - **R1-C2-P2** — Flush failure emits a Sentry breadcrumb (`category:
 *    'onboarding'`, `message: 'save-and-finish-later flush failed'`,
 *    `data: { page }`) and STILL navigates (spec AC4 try/finally intent).
 *  - **R1-C2-P3** — `primaryPending=true` disables the button (concurrent
 *    mutation guard — parent form-submit shouldn't race the affordance).
 *  - **R1-C2-P5** — `tone='amber'` swaps to `text-slate-700` (WCAG AA on
 *    amber-50/100 fill) vs default `text-slate-500` on white surfaces.
 *  - Layout wrapper split — `layout='right'` (default) wraps in
 *    `flex justify-end`; `layout='inline'` renders bare button.
 *
 * MSW mock seam is not used here — `flush` is a plain function prop, so
 * we pass mocks directly. The Sentry breadcrumb is spied via `vi.mock`.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { SaveAndFinishLaterLink } from '@/features/onboarding/components/SaveAndFinishLaterLink'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

beforeEach(() => {
  addBreadcrumbSpy.mockClear()
})

interface RenderOpts {
  flush?: () => Promise<void>
  primaryPending?: boolean
  tone?: 'slate' | 'amber'
  layout?: 'right' | 'inline'
  page?: string
}

function renderLink(opts: RenderOpts = {}) {
  const {
    flush = () => Promise.resolve(),
    primaryPending = false,
    tone,
    layout,
    page = 'TestPage',
  } = opts
  const queryClient = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/setup/spawn']}>
          <Routes>
            <Route
              path="/setup/spawn"
              element={
                <SaveAndFinishLaterLink
                  page={page}
                  flush={flush}
                  primaryPending={primaryPending}
                  tone={tone}
                  layout={layout}
                />
              }
            />
            <Route
              path="/dashboard"
              element={<div>DASHBOARD_PLACEHOLDER</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('SaveAndFinishLaterLink', () => {
  test('renders the button with the i18n label', async () => {
    renderLink()
    const button = await screen.findByRole('button', {
      name: /save and finish later/i,
    })
    expect(button).toBeInTheDocument()
    expect(button).toBeEnabled()
  })

  test('happy path — flush + navigate to /dashboard', async () => {
    const flush = vi.fn(() => Promise.resolve())
    renderLink({ flush })

    await userEvent.click(
      screen.getByRole('button', { name: /save and finish later/i }),
    )

    await screen.findByText(/DASHBOARD_PLACEHOLDER/i)
    expect(flush).toHaveBeenCalledTimes(1)
    // No breadcrumb on success
    expect(addBreadcrumbSpy).not.toHaveBeenCalled()
  })

  test('R1-C2-P1 — leaving state prevents double-click firing flush twice', async () => {
    const resolveFlushRef: { current: (() => void) | null } = { current: null }
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlushRef.current = resolve
        }),
    )
    renderLink({ flush })

    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })

    // First click starts flush (does not resolve yet)
    await userEvent.click(button)

    // Second + third clicks while flush is in-flight must no-op
    await userEvent.click(button)
    await userEvent.click(button)

    expect(flush).toHaveBeenCalledTimes(1)

    // Allow the flush to resolve so the navigate fires and cleanup happens
    resolveFlushRef.current?.()
    await screen.findByText(/DASHBOARD_PLACEHOLDER/i)
  })

  test('R1-C2-P3 — primaryPending=true disables the button (concurrent-mutation guard)', async () => {
    renderLink({ primaryPending: true })
    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    expect(button).toBeDisabled()
  })

  test('R1-C2-P2 — flush rejection emits Sentry breadcrumb with page + still navigates', async () => {
    const flush = vi.fn(() => Promise.reject(new Error('boom')))
    renderLink({ flush, page: 'TestPage' })

    await userEvent.click(
      screen.getByRole('button', { name: /save and finish later/i }),
    )

    // Navigate STILL happens (spec AC4 try/finally guarantee)
    await screen.findByText(/DASHBOARD_PLACEHOLDER/i)

    await waitFor(() => {
      expect(addBreadcrumbSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'onboarding',
          message: 'save-and-finish-later flush failed',
          level: 'warning',
          data: { page: 'TestPage' },
        }),
      )
    })
  })

  test('R1-C2-P5 — tone="amber" uses text-slate-700 (WCAG AA on amber card)', () => {
    renderLink({ tone: 'amber' })
    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    expect(button.className).toMatch(/text-slate-700/)
  })

  test('R1-C2-P5 — default tone (slate) uses text-slate-500 on white surface', () => {
    renderLink()
    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    expect(button.className).toMatch(/text-slate-500/)
  })

  test('layout="right" (default) wraps in flex justify-end', () => {
    renderLink()
    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    // Button's parent wrapper should be a div with flex justify-end
    const wrapper = button.parentElement
    expect(wrapper?.className).toMatch(/flex/)
    expect(wrapper?.className).toMatch(/justify-end/)
  })

  test('layout="inline" renders bare button (no wrapper div)', () => {
    // Wrap in a marker to prove the button IS the direct child rendered
    const { container } = renderLink({ layout: 'inline' })
    const button = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    // Container's route element is the button itself; the button's parent
    // is the Route element (Routes wrapper), NOT a wrapper div with flex.
    // Simplest observable: no ancestor div carries `flex justify-end`
    // between the Route and the button.
    expect(button.parentElement?.className ?? '').not.toMatch(/flex justify-end/)
    // Silence unused
    void container
  })
})
