/**
 * LoginPage — ≥10 tests per Story 1-8 AC4.
 *
 * Uses `createTestQueryClient()` per Murat #1, MSW per TEST-FE-1, and
 * MemoryRouter for the in-app navigation contract.
 */
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import LoginPage from '@/features/auth/LoginPage'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { Toaster } from '@/components/ui/sonner'

// Read-only probe so the test can assert MemoryRouter's URL state
// without going through window.location (MemoryRouter doesn't update it).
function UrlProbe() {
  const [searchParams] = useSearchParams()
  return (
    <span data-testid="url-error-param">
      {searchParams.get('error') ?? ''}
    </span>
  )
}

function renderLogin({
  client = createTestQueryClient(),
  initialEntries = ['/login'],
}: {
  client?: QueryClient
  initialEntries?: string[]
} = {}) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <Toaster />
          <Routes>
            <Route
              path="/login"
              element={
                <>
                  <UrlProbe />
                  <LoginPage />
                </>
              }
            />
            <Route path="/dashboard" element={<p>dashboard reached</p>} />
            <Route path="/forgot-password" element={<p>forgot</p>} />
            <Route path="/register" element={<p>register</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(ui)
  return { client, container }
}

async function expandEmailForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('collapsible-email-trigger'))
}

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
})

describe('LoginPage (Story 1-8 AC4)', () => {
  test('renders H1 from t("auth.login.title") — preserves the 1-7c bilingual smoke contract', () => {
    renderLogin()
    expect(screen.getByTestId('login-heading').textContent).toBe(
      i18n.t('auth.login.title'),
    )
  })

  test('Google button is the dominant action and renders before the collapsible trigger', () => {
    renderLogin()
    const region = screen.getByRole('region', {
      name: i18n.t('auth.login.title'),
    })
    const google = region.querySelector('[data-testid="google-oauth-cta"]')
    const trigger = region.querySelector(
      '[data-testid="collapsible-email-trigger"]',
    )
    expect(google).not.toBeNull()
    expect(trigger).not.toBeNull()
    // DOCUMENT_POSITION_FOLLOWING means `trigger` comes after `google`.
    const positionBit = 0x04
    expect(
      google!.compareDocumentPosition(trigger!) & positionBit,
    ).not.toBe(0)
  })

  test('the "or" divider is hidden when collapsed and visible when expanded', async () => {
    const user = userEvent.setup()
    renderLogin()
    expect(screen.queryByTestId('email-form-divider')).toBeNull()
    await expandEmailForm(user)
    expect(screen.getByTestId('email-form-divider')).toBeTruthy()
  })

  test('happy path: mutation isPending disables both Google and Submit buttons (mutation-trilogy pinned test)', async () => {
    server.use(
      http.post('/api/auth/login', async () => {
        await new Promise((r) => setTimeout(r, 80))
        return HttpResponse.json({
          data: {
            accessToken: 'jwt',
            user: {
              id: 'u',
              email: 'a@a.com',
              fullName: 'A',
              emailVerified: true,
            },
          },
        })
      }),
    )
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'p')
    await user.click(screen.getByTestId('login-submit'))
    await waitFor(() => {
      expect(
        (screen.getByTestId('login-submit') as HTMLButtonElement).disabled,
      ).toBe(true)
      expect(
        screen.getByTestId('google-oauth-cta').getAttribute('aria-disabled'),
      ).toBe('true')
    })
  })

  test('happy path: mutation isSuccess writes session cache and navigates to /dashboard with replace (pinned test)', async () => {
    const user = userEvent.setup()
    const { client } = renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'alice@example.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    await screen.findByText('dashboard reached')
    const cached = client.getQueryData(authKeys.session()) as {
      user: { email: string }
      accessToken: string | null
    }
    expect(cached.user.email).toBe('alice@example.com')
    expect(cached.accessToken).toBe('msw.jwt.signature')
  })

  test('401 INVALID_CREDENTIALS: isError renders form-level Alert with invalidCredentials copy (pinned test)', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'wrong',
              details: null,
            },
          },
          { status: 401 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'bad@example.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    const alert = await screen.findByTestId('login-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.login.error.invalidCredentials'))
  })

  test('429 ACCOUNT_LOCKED with Retry-After:900 renders accountLocked copy with {{minutes: 15}} interpolation', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'ACCOUNT_LOCKED',
              message: 'locked',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '900' } },
        ),
      ),
    )
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    const alert = await screen.findByTestId('login-form-error')
    expect(alert.textContent).toBe(
      i18n.t('auth.login.error.accountLocked', { minutes: 15 }),
    )
  })

  test('429 RATE_LIMIT_EXCEEDED renders rateLimited copy', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'too many',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    )
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    const alert = await screen.findByTestId('login-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.login.error.rateLimited'))
  })

  test('generic error: 5xx surface renders generic copy', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL',
              message: 'oops',
              details: null,
            },
          },
          { status: 500 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    const alert = await screen.findByTestId('login-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.login.error.generic'))
  })

  test('rememberMe checkbox state survives a typed email keystroke (form-state contract)', async () => {
    const user = userEvent.setup()
    renderLogin()
    await expandEmailForm(user)
    const checkbox = screen.getByRole('checkbox', {
      name: i18n.t('auth.login.rememberMe'),
    })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    await user.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  test('renders oauthGeneric Alert when /login?error=foo lands AND clears the query param (D3 pinned test)', async () => {
    renderLogin({ initialEntries: ['/login?error=csrf_invalid'] })
    // 1. The form-level alert renders with the oauthGeneric copy.
    const alert = await screen.findByTestId('login-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.login.error.oauthGeneric'))
    // 2. The ?error= search param has been cleared via setSearchParams
    //    replace — without this, a refresh would re-trigger the alert.
    await waitFor(() => {
      expect(screen.getByTestId('url-error-param').textContent).toBe('')
    })
  })

  test('does NOT render the oauthGeneric Alert on a clean /login landing (negative pin)', () => {
    renderLogin({ initialEntries: ['/login'] })
    expect(screen.queryByTestId('login-form-error')).toBeNull()
  })

  test('vitest-axe returns zero violations on collapsed state', async () => {
    const { container } = renderLogin()
    return expect(await axe(container)).toHaveNoViolations()
  })
})

describe('LoginPage Story 1-9a — three-part amendment', () => {
  test('renders verified banner when /login?verified=1 lands', async () => {
    renderLogin({ initialEntries: ['/login?verified=1'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.verified'))
  })

  test('clears the ?verified=1 query param after mount', async () => {
    renderLogin({ initialEntries: ['/login?verified=1'] })
    await screen.findByTestId('login-form-banner')
    await waitFor(() => {
      expect(screen.getByTestId('url-error-param').textContent).toBe('')
    })
  })

  test('redirects to /dashboard with replace:true when already authenticated on mount (Layer A)', async () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), {
      user: {
        id: 'u1',
        email: 'a@b.co',
        fullName: 'A',
        emailVerified: true,
      },
      accessToken: 'jwt',
    })
    renderLogin({ client })
    await screen.findByText(/dashboard reached/i)
  })

  test('does NOT render the verified banner when already authenticated (collision: success vs already-auth)', async () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), {
      user: {
        id: 'u1',
        email: 'a@b.co',
        fullName: 'A',
        emailVerified: true,
      },
      accessToken: 'jwt',
    })
    renderLogin({ client, initialEntries: ['/login?verified=1'] })
    // Either we never paint the banner OR we redirect away before
    // the user can read it. Either way: the banner element is absent
    // by the time the test asserts.
    await screen.findByText(/dashboard reached/i)
    expect(screen.queryByTestId('login-form-banner')).toBeNull()
  })

  test('verified banner does NOT collide with OAuth error: success wins when BOTH ?verified=1 and ?error= land together', async () => {
    renderLogin({ initialEntries: ['/login?verified=1&error=csrf_invalid'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.verified'))
    expect(screen.queryByTestId('login-form-error')).toBeNull()
  })

  test('S4 — does NOT redirect to /dashboard during boot-probe in-flight (isLoading guard via subscribeBootProbe)', async () => {
    // Layer A guard contract: `if (isLoading) return` short-circuits
    // the redirect while the boot-probe is in flight, so a returning
    // user doesn't see a flash of the login form before hydration.
    //
    // We assert the isLoading-true window directly: kick off
    // runBootProbe with a stalled /refresh; mount LoginPage with the
    // session ALREADY in the test cache. Without the isLoading guard,
    // the redirect would fire on first render. With the guard, the
    // login form stays until isLoading flips false — proven by the
    // 100ms quiet window.
    const { runBootProbe } = await import('@/lib/auth-refresh')
    let resolveRefresh!: () => void
    const refreshFinished = new Promise<void>((r) => {
      resolveRefresh = r
    })
    server.use(
      http.post('/api/auth/refresh', async () => {
        await refreshFinished
        return HttpResponse.json(
          {
            data: {
              accessToken: 'jwt',
              user: {
                id: 'u1',
                email: 'a@b.co',
                fullName: 'A',
                emailVerified: true,
              },
            },
          },
          { status: 200 },
        )
      }),
    )
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), {
      user: {
        id: 'u1',
        email: 'a@b.co',
        fullName: 'A',
        emailVerified: true,
      },
      accessToken: 'jwt',
    })
    void runBootProbe()
    renderLogin({ client })
    // Quiet window: during isLoading=true, the redirect is suppressed
    // even though isAuthenticated is true via the seeded cache.
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText(/dashboard reached/i)).toBeNull()
    // Resolve the probe — useAuth's bootProbeInFlight subscription
    // flips isLoading to false, the Layer A effect re-fires with
    // isLoading=false AND isAuthenticated=true, navigate runs.
    resolveRefresh()
    await screen.findByText(/dashboard reached/i)
  })
})
