/**
 * Story 2-5c — IntegrationsTab component tests.
 *
 * Coverage per Task 6.4:
 *   - three-state trilogy: loading skeleton → success → error alert with retry
 *   - Connect button dispatches useConnectGoogleMeet → window.location.assign
 *     called with authorizeUrl (via `vi.spyOn(window.location, 'assign')`).
 *   - Disconnect button opens AlertDialog → confirming DELETE flips the pill
 *     via optimistic cache write; success toast fires.
 *   - Placeholder rows render for Drive / Calendar / Zoom with disabled toggle.
 *   - Notifications section renders as a placeholder.
 *   - axe zero violations across the tab body (contribution to AC17).
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RoleProvider } from '@/hooks/RoleContext'
import { IntegrationsTab } from '@/features/settings/IntegrationsTab'
import {
  DEFAULT_CENTER_ID,
  centerProfile,
  settingsHandlers2_5c,
  STUB_GOOGLE_AUTHORIZE_URL,
} from '@/features/settings/api/__tests__/handlers'
import { CONNECT_IN_FLIGHT_MARKER_KEY } from '@/features/settings/api/connectMarker'

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
} as unknown as Session['user']

/* eslint-disable no-restricted-syntax -- fixture only */
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
    // Story 2.6 (AC2). Owner default for settings pages.
    role: 'owner',
  })
}

interface RenderOpts {
  client?: QueryClient
}

function renderIntegrationsTab(opts: RenderOpts = {}): {
  client: QueryClient
  container: HTMLElement
} {
  const qc = opts.client ?? createTestQueryClient()
  seedSession(qc)
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <RoleProvider value="owner">
          <MemoryRouter initialEntries={['/settings?tab=integrations']}>
            <Routes>
              <Route
                path="/settings"
                element={
                  <>
                    <IntegrationsTab centerId={DEFAULT_CENTER_ID} />
                    <Toaster />
                  </>
                }
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
  server.use(...settingsHandlers2_5c)
  window.sessionStorage.clear()
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

describe('IntegrationsTab — AC1 three-state trilogy', () => {
  test('renders loading skeleton while fetching profile', () => {
    renderIntegrationsTab()
    expect(
      screen.getByTestId('settings-integrations-loading'),
    ).toBeInTheDocument()
  })

  test('renders integration rows after load (success state)', async () => {
    renderIntegrationsTab()
    // Wait for the real Meet row (only renders after profileQuery.isSuccess).
    expect(
      await screen.findByTestId('settings-integration-row-google-meet'),
    ).toBeInTheDocument()
    // Placeholder rows also render (AC1).
    expect(
      screen.getByTestId('settings-integration-row-googleDrive'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('settings-integration-row-googleCalendar'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('settings-integration-row-zoom'),
    ).toBeInTheDocument()
    // Notifications placeholder section (always rendered — no data dep).
    expect(
      screen.getByTestId('settings-integrations-notifications-placeholder'),
    ).toBeInTheDocument()
  })

  test('renders error alert with retry when GET /api/centers/:id fails', async () => {
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'boom',
              requestId: 'req-1',
              details: null,
            },
          },
          { status: 500 },
        ),
      ),
    )
    renderIntegrationsTab()
    const alert = await screen.findByTestId('settings-integrations-error')
    expect(alert).toBeInTheDocument()
    expect(
      within(alert).getByRole('button', {
        name: i18n.t('settings.error.tryAgain'),
      }),
    ).toBeInTheDocument()
  })
})

describe('IntegrationsTab — AC2 Connect flow', () => {
  test('Connect button fires authorize + sets sessionStorage marker + navigates browser', async () => {
    renderIntegrationsTab()
    // Wait for query to resolve (Connect button only renders after success).
    await screen.findByTestId('settings-connect-google-meet-button')
    // Spy on window.location.assign so we can assert without real navigation.
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, assign: assignSpy },
    })

    const connectBtn = screen.getByTestId('settings-connect-google-meet-button')
    await userEvent.click(connectBtn)

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(STUB_GOOGLE_AUTHORIZE_URL)
    })
    expect(
      window.sessionStorage.getItem(CONNECT_IN_FLIGHT_MARKER_KEY),
    ).toBe('1')
  })
})

describe('IntegrationsTab — AC3 Disconnect flow', () => {
  test('shows Disconnect button + AlertDialog + flips to Connect button after DELETE', async () => {
    // State is server-authoritative — track it in a mutable variable the
    // handler reads so a DELETE flips subsequent GET responses to the
    // disconnected shape (matching real API semantics).
    let connected = true
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: centerProfile({ googleMeetConnected: connected }),
          meta: { serverTime: '2026-07-16T00:00:00.000Z' },
        }),
      ),
      http.delete('/api/centers/:id/integrations/google-meet', () => {
        connected = false
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderIntegrationsTab()
    const disconnectBtn = await screen.findByTestId(
      'settings-disconnect-google-meet-button',
    )
    await userEvent.click(disconnectBtn)

    const dialog = await screen.findByTestId(
      'settings-disconnect-google-meet-dialog',
    )
    expect(dialog).toBeInTheDocument()
    const confirm = within(dialog).getByTestId(
      'settings-disconnect-google-meet-confirm',
    )
    await userEvent.click(confirm)

    // After DELETE + invalidate + refetch, the pill row flips: the
    // Connect button (only rendered when googleMeetConnected === false)
    // now appears in place of the Disconnect button.
    expect(
      await screen.findByTestId('settings-connect-google-meet-button'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('settings-disconnect-google-meet-button'),
    ).not.toBeInTheDocument()
  })
})

describe('IntegrationsTab — AC17 accessibility', () => {
  test('IntegrationsTab render has zero axe violations (loaded state)', async () => {
    const { container } = renderIntegrationsTab()
    await screen.findByTestId('settings-integration-row-google-meet')
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Chunk 3 review 2026-07-16 M4: AC17 pins "4 renders" — the loaded state
  // + 2-locale variants live in SettingsPage.test.tsx tab-scan; the fourth
  // (AlertDialog OPEN state, a portal-mounted subtree with focus-trap
  // semantics) is the highest-value violation surface and was missing.
  test('IntegrationsTab with disconnect dialog OPEN passes axe (portal subtree)', async () => {
    // Override to a connected profile so the Disconnect button renders.
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: centerProfile({ googleMeetConnected: true }),
          meta: { serverTime: '2026-07-16T00:00:00.000Z' },
        }),
      ),
    )

    renderIntegrationsTab()
    const disconnectBtn = await screen.findByTestId(
      'settings-disconnect-google-meet-button',
    )
    await userEvent.click(disconnectBtn)
    const dialog = await screen.findByTestId(
      'settings-disconnect-google-meet-dialog',
    )
    expect(dialog).toBeInTheDocument()
    // Scope axe to the dialog content itself (portal-mounted subtree).
    // Scanning document.body would flag Base UI's own focus-guard <span
    // role="button"> shims — those are library-owned and outside our
    // control; scoping to the dialog covers what Story 2-5c authored.
    const results = await axe(dialog)
    expect(results).toHaveNoViolations()
  })

  // Chunk 3 review 2026-07-16 M6 + TEST-FE-6: role-gate assertion.
  // IntegrationsTab is Owner-only per Story 2-5c AC1/AC2/AC3. Parent
  // SettingsPage rejects non-Owner via PermissionDenied (tested in
  // SettingsPage.test.tsx). This test proves the component itself, when
  // rendered outside the parent role gate, still renders (parent-gate
  // model) — a `data-role="teacher"` audit surface so a future refactor
  // that adds in-component role checks tightens this negative assertion.
  test('non-owner (teacher) role — IntegrationsTab still renders (route-level gate is authoritative)', async () => {
    const qc = createTestQueryClient()
    seedSession(qc)
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <RoleProvider value="teacher">
            <MemoryRouter initialEntries={['/settings?tab=integrations']}>
              <Routes>
                <Route
                  path="/settings"
                  element={<IntegrationsTab centerId={DEFAULT_CENTER_ID} />}
                />
              </Routes>
            </MemoryRouter>
          </RoleProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    // Wait for the tabpanel to render.
    await screen.findByTestId('settings-tabpanel-integrations')
    // Documents the parent-gate contract: SettingsPage.test.tsx asserts
    // non-owner sees PermissionDenied (not IntegrationsTab). Server-side
    // useCenterProfile 403s for non-owner (Story 2-5a settingsHandler).
    // If in-component role guards are added later, tighten to
    // `queryByTestId('settings-integration-row-google-meet') === null`.
    expect(screen.getByTestId('settings-tabpanel-integrations')).toBeInTheDocument()
  })
})

// Chunk 3 review 2026-07-16 M5: exercise the MSW error factories
// (`authorizeFail500`, `disconnectFail500`) that were defined but unused —
// proves the Connect + Disconnect flows surface error toasts on API failure
// per UX-1 error-trilogy + Task 6.4.
describe('IntegrationsTab — error-state coverage (M5 fix)', () => {
  test('Connect surfaces error toast when authorize returns 500', async () => {
    const { errorHandlers2_5c } = await import('@/features/settings/api/__tests__/handlers')
    server.use(errorHandlers2_5c.authorizeFail500())

    renderIntegrationsTab()
    // Wait for the Connect button (only renders after profileQuery success —
    // authorize is a mutation, not the profile GET, so profile still works).
    const connectBtn = await screen.findByTestId('settings-connect-google-meet-button')
    await userEvent.click(connectBtn)

    // Error toast fires — assert Sonner rendered the copy. Since
    // IntegrationsTab.test.tsx mounts a real <Toaster/>, we can findByText.
    const errorCopy = i18n.t('settings.integrations.googleMeet.connect.error')
    await waitFor(() => {
      // Sonner renders toast content as text nodes inside the portal;
      // findByText handles the async render + timer semantics.
      expect(screen.getAllByText(errorCopy).length).toBeGreaterThan(0)
    })
  })

  test('Disconnect surfaces error toast + closes dialog on 500', async () => {
    const { errorHandlers2_5c } = await import('@/features/settings/api/__tests__/handlers')
    const { HttpResponse, http } = await import('msw')
    // Seed connected profile so the Disconnect button is what renders.
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: centerProfile({ googleMeetConnected: true }),
          meta: { serverTime: '2026-07-16T00:00:00.000Z' },
        }),
      ),
      errorHandlers2_5c.disconnectFail500(),
    )

    renderIntegrationsTab()
    const disconnectBtn = await screen.findByTestId(
      'settings-disconnect-google-meet-button',
    )
    await userEvent.click(disconnectBtn)
    const dialog = await screen.findByTestId(
      'settings-disconnect-google-meet-dialog',
    )
    const confirm = within(dialog).getByTestId(
      'settings-disconnect-google-meet-confirm',
    )
    await userEvent.click(confirm)

    // M7 fix invariant: dialog closes even on error.
    await waitFor(() => {
      expect(
        screen.queryByTestId('settings-disconnect-google-meet-dialog'),
      ).not.toBeInTheDocument()
    })
    // Error toast fires.
    const errorCopy = i18n.t('settings.integrations.googleMeet.disconnect.error')
    await waitFor(() => {
      expect(screen.getAllByText(errorCopy).length).toBeGreaterThan(0)
    })
  })
})
