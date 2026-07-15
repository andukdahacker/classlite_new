/**
 * Story 2-5b — TermCalendarTab tests (ATDD red-phase, 2026-07-15).
 *
 * Coverage per AC1/AC3/AC4/AC5/AC11/AC15:
 *   - three-state trilogy: loading skeleton → success → error alert
 *   - Terms + Holidays sections both render inside the same tab body
 *   - state pill derives client-side from startDate/endDate vs Date.now()
 *   - uniform Edit button on every row (Sally-S6 REJECTED)
 *   - empty state — encouraging tone per AC3 pinned copy
 *   - CRUD via shipped shadcn <Dialog> — create + edit paths
 *   - delete via <AlertDialog> confirmation
 *   - axe zero violations across the tab body (contribution to AC15)
 *
 * Red signal (2026-07-15 expected): TS2307 on
 *   `Cannot find module '@/features/settings/TermCalendarTab'`.
 * Amelia flips green by landing `TermCalendarTab.tsx` (story Task 6) plus
 * the useTerms/useMutateTerm/useHolidays/useMutateHoliday hooks (story
 * Task 6.4-6.6). MSW handlers already extended in `handlers.ts`.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RoleProvider } from '@/hooks/RoleContext'
// Story 2-5b — GREEN CONTRACT: TermCalendarTab.tsx lands in Task 6.
// Consumer here receives centerId as a prop (parent SettingsPage owns the
// session read) — mirrors how ProfileTab is wired in Story 2-5a.
import { TermCalendarTab } from '@/features/settings/TermCalendarTab'
import {
  DEFAULT_CENTER_ID,
  defaultTerms,
  defaultHolidays,
  errorHandlers,
  settingsHandlers2_5b,
} from '@/features/settings/api/__tests__/handlers'

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
} as unknown as Session['user']

/* eslint-disable no-restricted-syntax -- brand-color wire value fixture (FU-2-3a-C) */
const CENTER: NonNullable<Session['center']> = {
  id: DEFAULT_CENTER_ID,
  name: 'Saigon English Center',
  shortCode: 'saigon-english-center',
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}
/* eslint-enable no-restricted-syntax */

function seedSession(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: USER,
    accessToken: 'a.b.c',
    center: CENTER,
  })
}

function renderTermTab(client?: QueryClient): {
  client: QueryClient
  container: HTMLElement
} {
  const qc = client ?? createTestQueryClient()
  seedSession(qc)
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <RoleProvider value="owner">
          <MemoryRouter initialEntries={['/settings?tab=terms']}>
            <TermCalendarTab centerId={DEFAULT_CENTER_ID} />
          </MemoryRouter>
        </RoleProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(shell)
  return { client: qc, container }
}

beforeEach(() => {
  server.use(...settingsHandlers2_5b)
})

afterEach(() => {
  server.resetHandlers()
})

describe('TermCalendarTab — AC4 three-state trilogy', () => {
  test('renders skeleton rows while loading (Loading state)', () => {
    renderTermTab()
    // Skeleton rows mirror row height — expect >= 3 skeleton nodes per AC4.
    const skeletons = screen.getAllByTestId(/^term-row-skeleton/)
    expect(skeletons.length).toBeGreaterThanOrEqual(3)
  })

  test('renders Terms + Holidays sections after load (Success state)', async () => {
    renderTermTab()
    // Two sections must be present per AC1.
    expect(
      await screen.findByTestId('settings-tabpanel-terms'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('term-calendar-section-terms'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('term-calendar-section-holidays'),
    ).toBeInTheDocument()
    // Fixture rows visible.
    for (const t of defaultTerms) {
      expect(await screen.findByText(t.name)).toBeInTheDocument()
    }
    for (const h of defaultHolidays) {
      expect(screen.getByText(h.name)).toBeInTheDocument()
    }
  })

  test('renders inline error alert with retry when GET /api/terms fails (Error state)', async () => {
    server.use(errorHandlers.listTerms500())
    renderTermTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // Retry action per AC4 — a button, not a link, inside the alert.
    expect(
      within(alert).getByRole('button', {
        name: i18n.t('settings.error.tryAgain'),
      }),
    ).toBeInTheDocument()
  })
})

describe('TermCalendarTab — AC1 uniform Edit button + state pill', () => {
  test('every term row exposes an Edit button (Sally-S6 REJECTED — uniform Edit)', async () => {
    renderTermTab()
    // Wait for real data to render (regex excludes the skeleton rows so we
// don't catch the loading state).
await screen.findByText(defaultTerms[0].name)
const rows = screen.getAllByTestId(/^term-row-(?!skeleton)/)
    // All rows have an Edit button.
    for (const row of rows) {
      expect(
        within(row).getByRole('button', {
          name: i18n.t('settings.terms.row.editCta'),
        }),
      ).toBeInTheDocument()
    }
  })

  // Added /bmad-code-review 2-5b Round 1 P16 (2026-07-15): AC1 uniform Edit
  // was asserted for term rows but not for holidays. Sally-S6 REJECTED
  // pinned uniformity across BOTH sections, so this closes the coverage
  // gap without introducing a matrix — one holiday row proves the wiring.
  test('every holiday row exposes an Edit button (Sally-S6 REJECTED — uniform Edit across sections)', async () => {
    renderTermTab()
    await screen.findByText(defaultHolidays[0].name)
    const rows = screen.getAllByTestId(/^holiday-row-(?!skeleton)/)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(
        within(row).getByRole('button', {
          name: i18n.t('settings.holidays.row.editCta'),
        }),
      ).toBeInTheDocument()
    }
  })

  test('state pill derives client-side from startDate/endDate vs current time', async () => {
    renderTermTab()
    // Fixture: Fall 2026 (past by 2026-07-15 test-clock) OR Upcoming.
    // Assert the pill EXISTS on the row — the actual label depends on Date.now();
    // component MUST expose a data attribute so the pill class is testable
    // deterministically without freezing wall-clock.
    await screen.findByText(defaultTerms[0].name)
    const row = screen.getAllByTestId(/^term-row-(?!skeleton)/)[0]
    const pill = within(row).getByTestId('term-state-pill')
    expect(pill).toBeInTheDocument()
    // Pill must carry one of the 3 canonical states in data-state.
    const state = pill.getAttribute('data-state')
    expect(['current', 'upcoming', 'past']).toContain(state)
  })
})

describe('TermCalendarTab — AC3 empty state (encouraging tone)', () => {
  test('when GET /api/terms returns [], render the Sally-S9 pinned empty copy + primary CTA', async () => {
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/terms', () =>
        HttpResponse.json({
          data: [],
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
      http.get('/api/holidays', () =>
        HttpResponse.json({
          data: [],
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
    )
    renderTermTab()
    // Headline + body + primary CTA from AC3 pinned copy.
    expect(
      await screen.findByText(i18n.t('settings.terms.empty.headline')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.terms.empty.body')),
    ).toBeInTheDocument()
    // Both the section header Add CTA and the empty state CTA share the same
    // copy per AC3 pinned wording — assert at least one exists in the DOM.
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('settings.terms.empty.cta'),
      }).length,
    ).toBeGreaterThan(0)
    // Holidays empty copy renders too (co-visible on first-visit per AC3).
    expect(
      screen.getByText(i18n.t('settings.holidays.empty.headline')),
    ).toBeInTheDocument()
  })
})

describe('TermCalendarTab — AC5 CRUD via shadcn Dialog', () => {
  test('Add term button opens Dialog with name/start/end inputs', async () => {
    const user = userEvent.setup()
    renderTermTab()
    await screen.findByTestId('settings-tabpanel-terms')
    await user.click(
      screen.getByRole('button', { name: i18n.t('settings.terms.addCta') }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.terms.form.name.label'),
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.terms.form.startDate.label'),
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.terms.form.endDate.label'),
      ),
    ).toBeInTheDocument()
  })

  test('validation error on empty name surfaces as inline field error (RHF + Zod)', async () => {
    const user = userEvent.setup()
    renderTermTab()
    await screen.findByTestId('settings-tabpanel-terms')
    await user.click(
      screen.getByRole('button', { name: i18n.t('settings.terms.addCta') }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', {
        name: i18n.t('settings.terms.form.saveCta'),
      }),
    )
    // Zod error message rendered inline (NOT as alert / toast).
    expect(
      await within(dialog).findByText(
        i18n.t('settings.terms.form.name.errors.required'),
      ),
    ).toBeInTheDocument()
  })

  test('Edit term dialog pre-fills current values', async () => {
    const user = userEvent.setup()
    renderTermTab()
    // Wait for real data to render (regex excludes the skeleton rows so we
// don't catch the loading state).
await screen.findByText(defaultTerms[0].name)
const rows = screen.getAllByTestId(/^term-row-(?!skeleton)/)
    await user.click(
      within(rows[0]).getByRole('button', {
        name: i18n.t('settings.terms.row.editCta'),
      }),
    )
    const dialog = await screen.findByRole('dialog')
    // The dialog's name input echoes the row's fixture name.
    const nameInput = within(dialog).getByLabelText(
      i18n.t('settings.terms.form.name.label'),
    ) as HTMLInputElement
    expect(nameInput.value).toBe(defaultTerms[0].name)
  })

  test('delete term surfaces AlertDialog with confirm/cancel', async () => {
    const user = userEvent.setup()
    renderTermTab()
    // Wait for real data to render (regex excludes the skeleton rows so we
// don't catch the loading state).
await screen.findByText(defaultTerms[0].name)
const rows = screen.getAllByTestId(/^term-row-(?!skeleton)/)
    await user.click(
      within(rows[0]).getByRole('button', {
        name: i18n.t('settings.terms.row.deleteCta'),
      }),
    )
    const alertDialog = await screen.findByRole('alertdialog')
    expect(
      within(alertDialog).getByText(
        i18n.t('settings.terms.delete.confirmHeadline'),
      ),
    ).toBeInTheDocument()
    expect(
      within(alertDialog).getByRole('button', {
        name: i18n.t('settings.terms.delete.confirmCta'),
      }),
    ).toBeInTheDocument()
    expect(
      within(alertDialog).getByRole('button', {
        name: i18n.t('settings.terms.delete.cancelCta'),
      }),
    ).toBeInTheDocument()
  })
})

describe('TermCalendarTab — AC15 axe zero violations', () => {
  test('en locale — no accessibility violations on loaded tab', async () => {
    await i18n.changeLanguage('en')
    const { container } = renderTermTab()
    await screen.findByTestId('settings-tabpanel-terms')
    // Wait for the fixture rows to land so axe sees the real DOM.
    await waitFor(() =>
      expect(screen.getAllByTestId(/^term-row-/).length).toBeGreaterThan(0),
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('vi locale — no accessibility violations on loaded tab', async () => {
    await i18n.changeLanguage('vi')
    const { container } = renderTermTab()
    await screen.findByTestId('settings-tabpanel-terms')
    await waitFor(() =>
      expect(screen.getAllByTestId(/^term-row-/).length).toBeGreaterThan(0),
    )
    expect(await axe(container)).toHaveNoViolations()
    await i18n.changeLanguage('en')
  })
})
