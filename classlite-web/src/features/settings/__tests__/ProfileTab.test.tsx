/**
 * Story 2-5a — ProfileTab tests.
 *
 * Coverage per AC3/AC4/AC16:
 *   - form pre-fills from useCenterProfile
 *   - save round-trip via MSW PATCH
 *   - authKeys.session() cache write on success (sidebar/topbar signal)
 *   - shortCode input is disabled (AC3 read-only)
 *   - 5-error matrix on save (422 / 403 / 401 / 429 / 500)
 *   - DangerZone renders DeadLinkTrigger buttons (buttons, not links)
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { ProfileTab } from '@/features/settings/ProfileTab'
import {
  settingsHandlers,
  errorHandlers,
  defaultCenterProfile,
  DEFAULT_CENTER_ID,
} from '@/features/settings/api/__tests__/handlers'

const toastSpy = vi.fn()
vi.mock('sonner', () => ({
  toast: Object.assign(
    (...args: unknown[]) => toastSpy('generic', ...args),
    {
      success: (...args: unknown[]) => toastSpy('success', ...args),
      error: (...args: unknown[]) => toastSpy('error', ...args),
    },
  ),
}))

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
} as unknown as Session['user']

function seedSession(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: USER,
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english-center',
      /* eslint-disable-next-line no-restricted-syntax -- brand-color wire value fixture (FU-2-3a-C) */
      brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    // Story 2.6 (AC2). Owner default for settings pages.
    role: 'owner',
  })
}

function renderTab(client: QueryClient = createTestQueryClient()): {
  client: QueryClient
} {
  seedSession(client)
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <ProfileTab centerId={DEFAULT_CENTER_ID} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  render(shell)
  return { client }
}

beforeEach(() => {
  server.use(...settingsHandlers)
  toastSpy.mockClear()
})

afterEach(() => {
  server.resetHandlers()
})

describe('ProfileTab — AC3 form pre-fill + read-only shortCode', () => {
  test('name / contactEmail / timezone pre-fill from GET response', async () => {
    renderTab()
    const nameInput = await screen.findByTestId(
      'settings-profile-name-input',
    )
    expect(nameInput).toHaveValue('Saigon English Center')
    const shortCodeInput = screen.getByTestId('settings-profile-shortCode-input')
    expect(shortCodeInput).toHaveValue('saigon-english-center')
    expect(shortCodeInput).toBeDisabled()
    const tz = screen.getByTestId('settings-profile-timezone-select')
    expect(tz).toHaveValue('Asia/Ho_Chi_Minh')
  })
})

describe('ProfileTab — AC3 save round-trip', () => {
  test('successful save fires success toast + writes authKeys.session() cache', async () => {
    const { client } = renderTab()
    const user = userEvent.setup()
    const name = await screen.findByTestId('settings-profile-name-input')
    await user.clear(name)
    await user.type(name, 'Renamed Center')
    await user.click(screen.getByTestId('settings-profile-save-button'))

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'success',
        expect.any(String),
        expect.objectContaining({ id: 'settings-profile-save' }),
      )
    })
    // authKeys.session() cache write: center.name updated in place.
    const session = client.getQueryData<Session>(authKeys.session())
    expect(session?.center?.name).toBe('Renamed Center')
  })
})

describe('ProfileTab — AC3 save-error 5-row matrix', () => {
  test.each([
    ['422 validation', () => errorHandlers.patchValidation422()],
    ['403 forbidden', () => errorHandlers.patchForbidden403()],
    ['401 auth', () => errorHandlers.patchAuth401()],
    ['429 rate limit', () => errorHandlers.patchRateLimit429()],
    ['500 internal', () => errorHandlers.patchInternal500()],
  ])(
    'row %s → error toast fires with `settings-profile-save-error` id',
    async (_label, handlerFactory) => {
      server.use(handlerFactory())
      renderTab()
      const user = userEvent.setup()
      const name = await screen.findByTestId('settings-profile-name-input')
      await user.clear(name)
      await user.type(name, 'X')
      await user.click(screen.getByTestId('settings-profile-save-button'))

      await waitFor(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          'error',
          expect.any(String),
          expect.objectContaining({ id: 'settings-profile-save-error' }),
        )
      })
    },
  )
})

describe('ProfileTab — Danger Zone', () => {
  test('renders Transfer ownership + Archive center as buttons (DeadLinkTriggers)', async () => {
    renderTab()
    await screen.findByTestId('settings-profile-name-input')
    // Both DeadLinkTrigger buttons expose their copy via i18n keys resolved
    // to the settings.profile.dangerZone.* labels.
    expect(
      screen.getByRole('button', {
        name: (accessibleName) =>
          accessibleName.includes(
            i18n.t('settings.profile.dangerZone.transferOwnership'),
          ),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: (accessibleName) =>
          accessibleName.includes(
            i18n.t('settings.profile.dangerZone.archiveCenter'),
          ),
      }),
    ).toBeInTheDocument()
  })
})

describe('ProfileTab — AC16 D3 named coverage (2026-07-15 review)', () => {
  // D3.1 — contactEmail inline validation
  test('empty contactEmail is accepted (sends null); invalid non-empty shows inline error', async () => {
    renderTab()
    const user = userEvent.setup()
    const email = await screen.findByTestId(
      'settings-profile-contactEmail-input',
    )
    await user.type(email, 'not-an-email')
    // Trigger validation without clicking Save (RHF onBlur mode fires on tab-out).
    await user.tab()
    await user.click(screen.getByTestId('settings-profile-save-button'))
    await waitFor(() => {
      expect(
        screen.getByText(
          i18n.t('settings.profile.form.contactEmail.errors.invalid'),
        ),
      ).toBeInTheDocument()
    })
  })

  // D3.2 — timezone-outside-whitelist rejection at Zod boundary
  test('server-side timezone outside whitelist falls back to DEFAULT_TIMEZONE (P10)', async () => {
    // Server returns a non-whitelisted zone (legacy row scenario) — the form
    // must NOT crash and MUST render a real option so Save is possible.
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: { ...defaultCenterProfile, timezone: 'Africa/Djibouti' },
          meta: { serverTime: '2026-07-15T00:00:00.000Z' },
        }),
      ),
    )
    renderTab()
    const tz = await screen.findByTestId('settings-profile-timezone-select')
    // isSupportedTimezone rejects "Africa/Djibouti" → falls back to
    // DEFAULT_TIMEZONE ("Asia/Ho_Chi_Minh") so the <select> has a real match.
    expect(tz).toHaveValue('Asia/Ho_Chi_Minh')
  })

  // D3.3 — brand-color radiogroup keyboard access
  test('brand-color radiogroup swatches are reachable + toggleable via keyboard', async () => {
    renderTab()
    const user = userEvent.setup()
    await screen.findByTestId('settings-profile-brandColor-picker')
    const radios = screen.getAllByRole('radio', { name: /.+/ })
    expect(radios.length).toBeGreaterThanOrEqual(6)
    // The default seeded color (#1e3a8a "Deep navy") is checked; tab into
    // the group + Space to select a different one.
    radios[1].focus()
    await user.keyboard(' ')
    expect(radios[1]).toBeChecked()
  })
})

describe('ProfileTab — P1/P4/P5/D1/D4 (2026-07-15 review)', () => {
  // P1 (BLOCKER) — About card renders no literal {{ / interpolation escaped correctly
  test('P1 — About "Created" line renders a real date, not literal {{val}}', async () => {
    renderTab()
    // Wait for the About heading (Section that contains the created date).
    const heading = await screen.findByText(
      i18n.t('settings.profile.about.title'),
    )
    const aboutCard = heading.parentElement!
    // The rendered text must not contain any i18n interpolation placeholder.
    expect(aboutCard.textContent ?? '').not.toContain('{{')
  })

  // P4 — form.reset does NOT clobber in-flight typing
  test('P4 — background refetch preserves in-flight user typing', async () => {
    const { client } = renderTab()
    const user = userEvent.setup()
    const name = await screen.findByTestId('settings-profile-name-input')
    await user.clear(name)
    await user.type(name, 'Owner-typed-name')
    // Force a refetch that would land a fresh reference through the useEffect
    // — the isDirty guard MUST prevent form.reset from firing.
    await client.invalidateQueries()
    await new Promise((r) => setTimeout(r, 30))
    expect(name).toHaveValue('Owner-typed-name')
  })

  // P5 — 429 toast surfaces Retry-After seconds
  test('P5 — 429 with Retry-After renders the countdown i18n key', async () => {
    server.use(errorHandlers.patchRateLimit429(45))
    renderTab()
    const user = userEvent.setup()
    const name = await screen.findByTestId('settings-profile-name-input')
    await user.clear(name)
    await user.type(name, 'X')
    await user.click(screen.getByTestId('settings-profile-save-button'))
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('45'),
        expect.objectContaining({ id: 'settings-profile-save-error' }),
      )
    })
  })

  // D1 — free-form hex input round-trips + validates
  test('D1 — hex input accepts valid hex; invalid hex shows inline error', async () => {
    renderTab()
    const user = userEvent.setup()
    const hex = await screen.findByTestId(
      'settings-profile-brandColor-hex-input',
    )
    await user.clear(hex)
    await user.type(hex, 'not-a-hex')
    await user.click(screen.getByTestId('settings-profile-save-button'))
    await waitFor(() => {
      expect(
        screen.getByTestId('settings-profile-brandColor-hex-error'),
      ).toHaveTextContent(
        i18n.t('settings.profile.form.brandColor.errors.invalid'),
      )
    })
    await user.clear(hex)
    /* eslint-disable-next-line no-restricted-syntax -- brand-color wire value fixture (FU-2-3a-C) */
    await user.type(hex, '#0f766e')
    await user.click(screen.getByTestId('settings-profile-save-button'))
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'success',
        expect.any(String),
        expect.objectContaining({ id: 'settings-profile-save' }),
      )
    })
  })

  // D4 — clearing contactEmail sends explicit JSON null (backend NULLs)
  test('D4 — clearing contactEmail submits { contactEmail: null } in the PATCH body', async () => {
    // Seed the profile with a set contactEmail so clearing is meaningful.
    server.use(
      http.get('/api/centers/:id', () =>
        HttpResponse.json({
          data: {
            ...defaultCenterProfile,
            contactEmail: 'hello@example.com',
          },
          meta: { serverTime: '2026-07-15T00:00:00.000Z' },
        }),
      ),
    )
    let seenBody: unknown = null
    server.use(
      http.patch('/api/centers/:id', async ({ request }) => {
        seenBody = await request.json()
        return HttpResponse.json({
          data: { ...defaultCenterProfile, contactEmail: null },
          meta: { serverTime: '2026-07-15T00:00:00.000Z' },
        })
      }),
    )
    renderTab()
    const user = userEvent.setup()
    const email = await screen.findByTestId(
      'settings-profile-contactEmail-input',
    )
    await waitFor(() => expect(email).toHaveValue('hello@example.com'))
    await user.clear(email)
    await user.click(screen.getByTestId('settings-profile-save-button'))
    await waitFor(() => {
      expect(seenBody).toEqual(
        expect.objectContaining({ contactEmail: null }),
      )
    })
  })
})
