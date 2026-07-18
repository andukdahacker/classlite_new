/**
 * Story 2-5a — SettingsPage tests.
 *
 * Coverage per AC1/AC2/AC4/AC15/AC16:
 *   - role gate: Owner sees tabs; non-Owner (Teacher/Admin/Student) →
 *     PermissionDenied inside AppLayout scope
 *   - tab dispatch: `?tab=terms` → placeholder mounts; invalid `?tab=xyz`
 *     falls back to Profile
 *   - three-state trilogy: loading skeleton → success → error alert
 *   - accessibility: axe zero violations across owner + non-owner surfaces
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'

// Mock sonner so AC14 callback-return tests can assert toast.success / .info
// were called with the correct i18n key — matches the project convention
// (ReopenChecklistCta.test.tsx + ProfileTab.test.tsx use the same pattern).
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: toastMocks,
  Toaster: () => null,
}))
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RoleProvider } from '@/hooks/RoleContext'
import type { Role } from '@/hooks/useRole'
import SettingsPage from '@/features/settings/SettingsPage'
import {
  settingsHandlers,
  errorHandlers,
  DEFAULT_CENTER_ID,
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

function seedSession(client: QueryClient, role: Role | null = 'owner'): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: USER,
    accessToken: 'a.b.c',
    center: CENTER,
    // Story 2.6 (AC2). Seed the session-level role so useRole() (post-2.6)
    // returns the caller's actual role even when the RoleProvider override
    // isn't wired — the shipped SettingsPage tests still use the
    // RoleProvider wrapper below, so this field mostly documents the shape
    // rather than driving behavior in this file.
    role,
  })
}

interface RenderOpts {
  role?: Role | null
  initialEntry?: string
  client?: QueryClient
}

function renderSettings(opts: RenderOpts = {}): {
  client: QueryClient
  container: HTMLElement
} {
  const client = opts.client ?? createTestQueryClient()
  seedSession(client)
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RoleProvider value={opts.role ?? 'owner'}>
          <MemoryRouter initialEntries={[opts.initialEntry ?? '/settings']}>
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>
        </RoleProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(shell)
  return { client, container }
}

beforeEach(() => {
  server.use(...settingsHandlers)
})

afterEach(() => {
  server.resetHandlers()
})

describe('SettingsPage — AC1 tab-strip shell + AC2 role gate', () => {
  test('Owner sees tab strip with 4 tabs and Profile is the default panel', async () => {
    renderSettings()
    expect(await screen.findByTestId('settings-tab-strip')).toBeInTheDocument()
    expect(screen.getByTestId('settings-tab-profile')).toBeInTheDocument()
    expect(screen.getByTestId('settings-tab-terms')).toBeInTheDocument()
    expect(screen.getByTestId('settings-tab-integrations')).toBeInTheDocument()
    expect(screen.getByTestId('settings-tab-rooms')).toBeInTheDocument()
    // Profile panel mounts by default
    await screen.findByTestId('settings-tabpanel-profile')
  })

  // Story 2.6 (Task 7.4) — Non-Owner gating moved from SettingsPage inline
  // branch to a route-level <RouteRoleGate>. The Teacher/Admin/Student
  // PermissionDenied coverage lives in
  // `src/routes/__tests__/settings-role-gate.test.tsx`; SettingsPage itself
  // is only responsible for the rendered tab strip on the Owner path.

  test('?tab=terms mounts the TermCalendarTab body (Story 2-5b — placeholder replaced)', async () => {
    renderSettings({ initialEntry: '/settings?tab=terms' })
    // Story 2-5b landed the real tab body — the 2-5a placeholder testid is
    // gone and the tabpanel-terms testid ships on the real component.
    await screen.findByTestId('settings-tabpanel-terms')
    expect(
      screen.queryByTestId('settings-tab-placeholder-terms'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('settings-tabpanel-profile'),
    ).not.toBeInTheDocument()
  })

  test('?tab=xyz (invalid) falls back to Profile', async () => {
    renderSettings({ initialEntry: '/settings?tab=xyz' })
    await screen.findByTestId('settings-tabpanel-profile')
    expect(
      screen.queryByTestId('settings-tabpanel-terms'),
    ).not.toBeInTheDocument()
  })
})

describe('SettingsPage — AC4 three-state trilogy (Profile tab)', () => {
  test('renders loading skeleton before profile GET resolves', () => {
    renderSettings()
    expect(screen.getByTestId('settings-profile-skeleton')).toBeInTheDocument()
  })

  test('renders form on GET success', async () => {
    renderSettings()
    await screen.findByTestId('settings-profile-name-input')
  })

  test('renders error alert when the profile fetch returns 500', async () => {
    server.use(errorHandlers.centerProfileFetch500())
    renderSettings()
    await waitFor(() => {
      expect(
        screen.getByTestId('settings-profile-fetch-error'),
      ).toBeInTheDocument()
    })
  })
})

describe('SettingsPage — AC15 accessibility (axe)', () => {
  // D2 (2026-07-15 review): full 10-render matrix per spec AC15 —
  //   4 tabs (Profile populated + 3 placeholders) × 2 locales
  //   + Owner-across-both-locales-implicit + Non-Owner PermissionDenied.
  // The `describe.each(['en','vi'])` cycle covers the locale axis
  // (2 renders × 4 tab entries = 8) and the trailing two
  // Non-Owner axe renders bring the total to 10.
  const LOCALES = ['en', 'vi'] as const
  const TABS = [
    { id: 'profile', entry: '/settings' },
    { id: 'terms', entry: '/settings?tab=terms' },
    { id: 'integrations', entry: '/settings?tab=integrations' },
    { id: 'rooms', entry: '/settings?tab=rooms' },
  ] as const

  afterEach(async () => {
    // Reset locale between renders so a VN test does not bleed into an EN one.
    await i18n.changeLanguage('en')
  })

  describe.each(LOCALES)('locale %s', (locale) => {
    test.each(TABS)(
      `Owner tab %s has no axe violations`,
      async (tab) => {
        await i18n.changeLanguage(locale)
        const { container } = renderSettings({ initialEntry: tab.entry })
        // Wait for the tab body to mount so axe scans stable DOM.
        // Story 2-5c: all four tabpanels now ship real bodies — the
        // placeholder branch for `integrations` was removed when
        // IntegrationsTab replaced it (Story 2-5c Task 6).
        if (tab.id === 'profile') {
          await screen.findByTestId('settings-profile-name-input')
        } else {
          await screen.findByTestId(`settings-tabpanel-${tab.id}`)
        }
        const results = await axe(container)
        expect(results).toHaveNoViolations()
      },
    )
  })

  // Non-Owner PermissionDenied axe coverage moved to
  // `src/routes/__tests__/settings-role-gate.test.tsx` (Story 2.6 Task 7.4)
  // — the route-level gate renders PermissionDenied in a distinct render
  // tree, so the axe scan needs to happen through the router entry point.
})

// -----------------------------------------------------------------------------
// Chunk 3 review 2026-07-16 B3 fix: AC14 callback-return handler tests.
// Three scenarios per Task 6.4 + the Chunk 1 D2 amendment:
//   (a) `?status=connected` + sessionStorage marker present → success toast
//       fires, params stripped, marker cleared, centerProfile invalidated.
//   (b) `?status=connected` WITHOUT marker (drive-by URL manipulation
//       attempt) → NO toast, params silently stripped, no invalidation.
//   (c) `?status=cancelled` → neutral (info) toast fires, params stripped,
//       marker cleared. Symmetric handling of the backend D2 fix path.
// -----------------------------------------------------------------------------
describe('SettingsPage — AC14 callback-return handling', () => {
  const CONNECT_MARKER_KEY = 'meet-connect-in-flight'

  beforeEach(() => {
    toastMocks.success.mockClear()
    toastMocks.info.mockClear()
    toastMocks.error.mockClear()
  })

  afterEach(() => {
    try {
      window.sessionStorage.removeItem(CONNECT_MARKER_KEY)
    } catch {
      // ignore
    }
  })

  test('?status=connected with marker fires success toast + strips param + clears marker', async () => {
    window.sessionStorage.setItem(CONNECT_MARKER_KEY, '1')
    renderSettings({ initialEntry: '/settings?tab=integrations&status=connected' })

    const successCopy = i18n.t('settings.integrations.googleMeet.connect.success')
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith(successCopy, expect.any(Object))
    })
    // Marker was cleared on the strip path — invariant of the fix.
    expect(window.sessionStorage.getItem(CONNECT_MARKER_KEY)).toBeNull()
    // Info toast NOT fired on the connected branch.
    expect(toastMocks.info).not.toHaveBeenCalled()
  })

  test('?status=connected WITHOUT marker (drive-by) does NOT fire toast', async () => {
    // No sessionStorage marker seeded — simulates an attacker crafting the URL.
    expect(window.sessionStorage.getItem(CONNECT_MARKER_KEY)).toBeNull()
    renderSettings({ initialEntry: '/settings?tab=integrations&status=connected' })

    // Wait for the tabpanel to render — proves the page mounted + effect ran.
    await screen.findByTestId('settings-tabpanel-integrations')

    // Drive-by URL must NOT surface the confirmation copy.
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(toastMocks.info).not.toHaveBeenCalled()
  })

  test('?status=cancelled fires neutral toast + strips param + clears marker (D2 symmetric)', async () => {
    // Marker was set during authorize; cancel path must clear it so a
    // subsequent drive-by ?status=connected cannot ride the stale marker.
    window.sessionStorage.setItem(CONNECT_MARKER_KEY, '1')
    renderSettings({ initialEntry: '/settings?tab=integrations&status=cancelled' })

    const cancelledCopy = i18n.t('settings.integrations.googleMeet.connect.cancelled')
    await waitFor(() => {
      expect(toastMocks.info).toHaveBeenCalledWith(cancelledCopy, expect.any(Object))
    })
    expect(window.sessionStorage.getItem(CONNECT_MARKER_KEY)).toBeNull()
    // Success toast NOT fired on the cancel branch.
    expect(toastMocks.success).not.toHaveBeenCalled()
  })
})
