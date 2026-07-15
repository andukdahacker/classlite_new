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
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'
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

function seedSession(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: USER,
    accessToken: 'a.b.c',
    center: CENTER,
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

  test('Teacher role → PermissionDenied inside AppLayout (tab strip absent)', () => {
    renderSettings({ role: 'teacher' })
    expect(screen.getByTestId('settings-permission-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-tab-strip')).not.toBeInTheDocument()
  })

  test('Admin role → PermissionDenied (Owner-only per v1 AC2)', () => {
    renderSettings({ role: 'admin' })
    expect(screen.getByTestId('settings-permission-denied')).toBeInTheDocument()
  })

  test('Student role → PermissionDenied', () => {
    renderSettings({ role: 'student' })
    expect(screen.getByTestId('settings-permission-denied')).toBeInTheDocument()
  })

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
        // Story 2-5b: terms + rooms tabpanels now ship real bodies, not
        // placeholders — only `integrations` still ships as a placeholder
        // pending Story 2-5c.
        if (tab.id === 'profile') {
          await screen.findByTestId('settings-profile-name-input')
        } else if (tab.id === 'integrations') {
          await screen.findByTestId(
            'settings-tab-placeholder-integrations',
          )
        } else {
          await screen.findByTestId(`settings-tabpanel-${tab.id}`)
        }
        const results = await axe(container)
        expect(results).toHaveNoViolations()
      },
    )
  })

  test('Non-Owner (teacher) PermissionDenied has no axe violations (EN)', async () => {
    const { container } = renderSettings({ role: 'teacher' })
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('Non-Owner (teacher) PermissionDenied has no axe violations (VN)', async () => {
    await i18n.changeLanguage('vi')
    const { container } = renderSettings({ role: 'teacher' })
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
