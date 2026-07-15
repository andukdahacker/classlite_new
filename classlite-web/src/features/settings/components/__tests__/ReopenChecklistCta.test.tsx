/**
 * Story 2-5a — ReopenChecklistCta tests (AC5 + AC6).
 *
 * Gate: renders only when useChecklistState(userId).state.snoozedUntil is
 * non-null. Click: fires clearSnooze() + Sentry breadcrumb + toast + NO nav.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

const toastSpy = vi.fn()
vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}))

// P15 (2026-07-15 review): spy on react-router's useNavigate so the AC5
// "does NOT navigate" invariant is asserted at the test level, not just
// by proof-by-inspection of the component's imports.
const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigateSpy }
})

import { ReopenChecklistCta } from '@/features/settings/components/ReopenChecklistCta'

const USER_ID = 'user-a-uuid'
const KEY = `classlite_finish_setup_v1_${USER_ID}`

function renderCta(userId: string | null): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ReopenChecklistCta userId={userId} />
    </I18nextProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  addBreadcrumbSpy.mockClear()
  toastSpy.mockClear()
  navigateSpy.mockClear()
})

describe('ReopenChecklistCta — AC5 gate', () => {
  test('does NOT render when snoozedUntil is null (no key)', () => {
    renderCta(USER_ID)
    expect(
      screen.queryByTestId('settings-reopen-checklist-cta'),
    ).not.toBeInTheDocument()
  })

  test('does NOT render when userId is null (anonymous / boot-probe)', () => {
    renderCta(null)
    expect(
      screen.queryByTestId('settings-reopen-checklist-cta'),
    ).not.toBeInTheDocument()
  })

  test('renders when snoozedUntil is a future timestamp', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ snoozedUntil: Date.now() + 3600 * 1000 }),
    )
    renderCta(USER_ID)
    expect(
      screen.getByTestId('settings-reopen-checklist-cta'),
    ).toBeInTheDocument()
  })
})

describe('ReopenChecklistCta — AC6 click flow', () => {
  test('click clears snooze + fires breadcrumb + fires toast', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ snoozedUntil: Date.now() + 3600 * 1000 }),
    )
    renderCta(USER_ID)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('settings-reopen-checklist-cta'))

    // localStorage key removed → next render would hide the CTA.
    expect(window.localStorage.getItem(KEY)).toBeNull()

    // Sentry breadcrumb — surface-specific message (distinct from the hook's own).
    const surfaceCall = addBreadcrumbSpy.mock.calls.find(
      (call) =>
        (call[0] as { message?: string }).message ===
        'checklist-reopened-from-settings',
    )
    expect(surfaceCall).toBeDefined()

    // Toast fired with the fixed id (queue-of-one).
    expect(toastSpy).toHaveBeenCalled()
    const toastArgs = toastSpy.mock.calls[0]
    expect(toastArgs[1]).toMatchObject({ id: 'settings-reopen-checklist' })

    // P15 (2026-07-15 review) — AC5 subpoint 4 + AC16 pinned assertion:
    // clicking the reopen CTA MUST NOT navigate. User stays on Settings.
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
