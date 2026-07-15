/**
 * Story 2-5b — RoomsTab tests (ATDD red-phase, 2026-07-15).
 *
 * Coverage per AC2/AC3/AC4/AC5/AC6/AC11/AC15:
 *   - three-state trilogy: loading skeleton → success → error alert
 *   - synthetic "Online · Google Meet" row visible only when
 *     google_meet_connected === true; disappears when disconnected (Sally-S7 +
 *     John ACCEPT). Its Settings button navigates to `?tab=integrations`.
 *   - CRUD via shipped shadcn <Dialog> + <AlertDialog> for delete confirm
 *   - AC6 — UNIQUE(center_id, LOWER(name)) 409 renders as INLINE field error
 *     on `name` input, NOT a toast
 *   - empty state per AC3 pinned copy
 *   - axe zero violations across the tab body (contribution to AC15)
 *
 * Red signal (2026-07-15 expected): TS2307 on
 *   `Cannot find module '@/features/settings/RoomsTab'`.
 * Amelia flips green by landing `RoomsTab.tsx` (story Task 6) plus
 * `useRooms` / `useMutateRoom` hooks.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RoleProvider } from '@/hooks/RoleContext'
// Story 2-5b — GREEN CONTRACT: RoomsTab.tsx lands in Task 6.
import { RoomsTab } from '@/features/settings/RoomsTab'
import {
  DEFAULT_CENTER_ID,
  defaultRooms,
  errorHandlers,
  settingsHandlers2_5b,
  defaultCenterProfile,
  centerProfile,
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

interface RenderOpts {
  client?: QueryClient
  initialEntry?: string
}

function renderRoomsTab(opts: RenderOpts = {}): {
  client: QueryClient
  container: HTMLElement
} {
  const qc = opts.client ?? createTestQueryClient()
  seedSession(qc)
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <RoleProvider value="owner">
          <MemoryRouter
            initialEntries={[opts.initialEntry ?? '/settings?tab=rooms']}
          >
            <Routes>
              <Route
                path="/settings"
                element={<RoomsTab centerId={DEFAULT_CENTER_ID} />}
              />
            </Routes>
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

describe('RoomsTab — AC4 three-state trilogy', () => {
  test('renders skeleton rows while loading', () => {
    renderRoomsTab()
    const skeletons = screen.getAllByTestId(/^room-row-skeleton/)
    expect(skeletons.length).toBeGreaterThanOrEqual(3)
  })

  test('renders room rows after load (Success state)', async () => {
    renderRoomsTab()
    expect(
      await screen.findByTestId('settings-tabpanel-rooms'),
    ).toBeInTheDocument()
    for (const r of defaultRooms) {
      expect(await screen.findByText(r.name)).toBeInTheDocument()
    }
  })

  test('renders inline error alert with retry when GET /api/rooms fails', async () => {
    server.use(errorHandlers.listRooms500())
    renderRoomsTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(
      within(alert).getByRole('button', {
        name: i18n.t('settings.error.tryAgain'),
      }),
    ).toBeInTheDocument()
  })
})

describe('RoomsTab — AC2 synthetic Online · Google Meet row', () => {
  test('when googleMeetConnected === true → synthetic row visible with Settings CTA', async () => {
    // Override the profile handler to flip googleMeetConnected → true.
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: centerProfile({ googleMeetConnected: true }),
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
    )
    renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    const meetRow = await screen.findByTestId('room-row-synthetic-meet')
    expect(meetRow).toBeInTheDocument()
    expect(
      within(meetRow).getByText(i18n.t('settings.rooms.synthetic.meet.name')),
    ).toBeInTheDocument()
    // Settings CTA navigates to ?tab=integrations (2-5c-shipped tab).
    expect(
      within(meetRow).getByRole('link', {
        name: i18n.t('settings.rooms.synthetic.meet.settingsCta'),
      }),
    ).toHaveAttribute('href', expect.stringMatching(/tab=integrations/))
  })

  // Added /bmad-code-review 2-5b Round 1 P10 (2026-07-15): an online-only
  // center (0 physical rooms, Meet connected) previously saw the "No
  // physical rooms yet" empty state with the Meet row hidden inside the
  // empty-branch's dead sibling. The Meet row now renders outside the
  // empty/list decision so it's ALWAYS visible when connected.
  test('when googleMeetConnected === true AND zero physical rooms → synthetic Meet row still visible', async () => {
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/rooms', () =>
        HttpResponse.json({
          data: [],
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: centerProfile({ googleMeetConnected: true }),
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
    )
    renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    // Empty state for physical rooms — still present.
    expect(
      await screen.findByText(i18n.t('settings.rooms.empty.headline')),
    ).toBeInTheDocument()
    // AND the Meet row appears — the online-only center sees its
    // integration status honestly.
    expect(
      await screen.findByTestId('room-row-synthetic-meet'),
    ).toBeInTheDocument()
  })

  test('when googleMeetConnected === false → synthetic row absent from DOM (Sally-S7 + John ACCEPT)', async () => {
    // Default handler returns googleMeetConnected: false, so no override needed.
    expect(defaultCenterProfile.googleMeetConnected).toBe(false)
    renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    // Must be ABSENT from the DOM, not merely visually hidden (TEST-FE-6
    // discipline — hidden data is a security concern).
    await waitFor(() =>
      expect(
        screen.queryByTestId('room-row-synthetic-meet'),
      ).not.toBeInTheDocument(),
    )
  })
})

describe('RoomsTab — AC3 empty state (encouraging tone)', () => {
  test('when GET /api/rooms returns [], render the Sally-S9 pinned empty copy + primary CTA', async () => {
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/rooms', () =>
        HttpResponse.json({
          data: [],
          meta: { serverTime: '2026-07-14T00:00:00Z' },
        }),
      ),
    )
    renderRoomsTab()
    expect(
      await screen.findByText(i18n.t('settings.rooms.empty.headline')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.rooms.empty.body')),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('settings.rooms.empty.cta'),
      }).length,
    ).toBeGreaterThan(0)
  })
})

describe('RoomsTab — AC5 CRUD via shadcn Dialog', () => {
  test('Add room button opens Dialog with name/description/capacity', async () => {
    const user = userEvent.setup()
    renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    await user.click(
      screen.getByRole('button', { name: i18n.t('settings.rooms.addCta') }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.rooms.form.name.label'),
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.rooms.form.description.label'),
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByLabelText(
        i18n.t('settings.rooms.form.capacity.label'),
      ),
    ).toBeInTheDocument()
  })

  test('capacity outside 1..500 surfaces inline Zod error', async () => {
    const user = userEvent.setup()
    renderRoomsTab()
    await user.click(
      screen.getByRole('button', { name: i18n.t('settings.rooms.addCta') }),
    )
    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByLabelText(
      i18n.t('settings.rooms.form.name.label'),
    )
    const capacityInput = within(dialog).getByLabelText(
      i18n.t('settings.rooms.form.capacity.label'),
    )
    await user.type(nameInput, 'New Room')
    await user.clear(capacityInput)
    await user.type(capacityInput, '9999')
    await user.click(
      within(dialog).getByRole('button', {
        name: i18n.t('settings.rooms.form.saveCta'),
      }),
    )
    // waitFor honors RHF's re-render cycle after the resolver validates.
    await waitFor(
      () => {
        // Any of Zod's capacity paths produces the same range copy; asserting
        // via role="alert" scopes the search to the FormField's inline error
        // so we don't collide with the dialog-level role="dialog".
        const alerts = within(dialog).getAllByRole('alert')
        const hasRangeError = alerts.some((a) =>
          a.textContent?.includes(
            i18n.t('settings.rooms.form.capacity.errors.range'),
          ),
        )
        expect(hasRangeError).toBe(true)
      },
      { timeout: 3000 },
    )
  })

  test('delete room opens AlertDialog with confirm + cancel', async () => {
    const user = userEvent.setup()
    renderRoomsTab()
    const rows = await screen.findAllByTestId(/^room-row-(?!skeleton|synthetic)/)
    await user.click(
      within(rows[0]).getByRole('button', {
        name: i18n.t('settings.rooms.row.deleteCta'),
      }),
    )
    const alertDialog = await screen.findByRole('alertdialog')
    expect(
      within(alertDialog).getByRole('button', {
        name: i18n.t('settings.rooms.delete.confirmCta'),
      }),
    ).toBeInTheDocument()
    expect(
      within(alertDialog).getByRole('button', {
        name: i18n.t('settings.rooms.delete.cancelCta'),
      }),
    ).toBeInTheDocument()
  })
})

describe('RoomsTab — AC6 UNIQUE conflict → inline field error, NOT toast', () => {
  test('POST /api/rooms 409 ROOM_NAME_TAKEN → error surfaces on name input, no toast', async () => {
    const user = userEvent.setup()
    server.use(errorHandlers.roomNameTaken409())
    renderRoomsTab()
    await user.click(
      screen.getByRole('button', { name: i18n.t('settings.rooms.addCta') }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText(i18n.t('settings.rooms.form.name.label')),
      'Room A',
    )
    // Capacity defaults to 20 — clear first so type() replaces (not appends).
    const capacityInput = within(dialog).getByLabelText(
      i18n.t('settings.rooms.form.capacity.label'),
    )
    await user.clear(capacityInput)
    await user.type(capacityInput, '20')
    await user.click(
      within(dialog).getByRole('button', {
        name: i18n.t('settings.rooms.form.saveCta'),
      }),
    )
    // Assertion 1 — the inline field error copy surfaces near the name input.
    // waitFor gives RHF a re-render cycle after setError fires from onError.
    await waitFor(
      () => {
        expect(
          within(dialog).getByText(
            i18n.t('settings.rooms.form.name.errors.taken'),
          ),
        ).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
    // Assertion 2 — NO toast (no `role="status"` announcement for this 409).
    // AC6 pins this behavior: it's a validation feedback, not a system notice.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('RoomsTab — AC15 axe zero violations', () => {
  test('en locale — no accessibility violations on loaded tab', async () => {
    await i18n.changeLanguage('en')
    const { container } = renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^room-row-(?!skeleton)/).length,
      ).toBeGreaterThan(0),
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('vi locale — no accessibility violations on loaded tab', async () => {
    await i18n.changeLanguage('vi')
    const { container } = renderRoomsTab()
    await screen.findByTestId('settings-tabpanel-rooms')
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^room-row-(?!skeleton)/).length,
      ).toBeGreaterThan(0),
    )
    expect(await axe(container)).toHaveNoViolations()
    await i18n.changeLanguage('en')
  })
})
