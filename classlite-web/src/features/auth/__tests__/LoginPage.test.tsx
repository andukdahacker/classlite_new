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
//
// Emits each banner-signal query param into its own testid so callers
// can assert against the specific param without inviting vacuous passes
// — the prior single `url-error-param` made the `?reset=1` clear test
// pass even when only the `error` branch of the URL-clear effect ran
// ([Review][Patch] P6 — code-review 2026-06-26).
function UrlProbe() {
  const [searchParams] = useSearchParams()
  return (
    <>
      <span data-testid="url-error-param">
        {searchParams.get('error') ?? ''}
      </span>
      <span data-testid="url-verified-param">
        {searchParams.get('verified') ?? ''}
      </span>
      <span data-testid="url-reset-param">
        {searchParams.get('reset') ?? ''}
      </span>
      <span data-testid="url-invited-param">
        {searchParams.get('invited') ?? ''}
      </span>
      <span data-testid="url-session-expired-param">
        {searchParams.get('session_expired') ?? ''}
      </span>
      <span data-testid="url-next-param">
        {searchParams.get('next') ?? ''}
      </span>
    </>
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
            <Route
              path="/classes/:id"
              element={<p data-testid="test-route-classes">classes reached</p>}
            />
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
  // Story 1-9d: LoginPage rehydrates lockoutUntilMs from localStorage on
  // mount. Any test that triggers 429 ACCOUNT_LOCKED writes to storage;
  // clear between every case so lockout state doesn't bleed across tests.
  window.localStorage.clear()
})

afterEach(() => {
  locationStub.restore()
  vi.restoreAllMocks()
  window.localStorage.clear()
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

  test('429 ACCOUNT_LOCKED with Retry-After:900 transitions LoginPage to lockout mode (Story 1-9d AC1)', async () => {
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
    // Lockout region IN DOM; form UNMOUNTED; submit button NOT present
    // (Murat ATDD ratchet — verbatim from Story 1-9d AC1).
    await screen.findByTestId('login-lockout')
    expect(screen.queryByTestId('login-form')).toBeNull()
    expect(screen.queryByTestId('login-submit')).toBeNull()
    // localStorage envelope persisted; lockoutUntilMs ≈ Date.now() + 900_000 (±2s).
    const raw = window.localStorage.getItem('classlite_login_lockout_until')
    expect(raw).not.toBeNull()
    const envelope = JSON.parse(raw!) as { lockoutUntilMs: number; version: 1 }
    expect(envelope.version).toBe(1)
    const expected = Date.now() + 900_000
    expect(Math.abs(envelope.lockoutUntilMs - expected)).toBeLessThan(2_000)
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
      // Same vacuous-pass fix as the `?reset=1` test below
      // ([Review][Patch] P6 — code-review 2026-06-26).
      expect(screen.getByTestId('url-verified-param').textContent).toBe('')
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

  // ===== Story 1-9b — `?reset=1` banner contracts (+4 tests per AC7) =====

  test('renders reset banner with checkmark glyph when /login?reset=1 lands', async () => {
    renderLogin({ initialEntries: ['/login?reset=1'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.reset'))
    // Inline checkmark SVG is the visual signal of "success completed" —
    // aria-hidden so screen readers read the alert copy only.
    const svg = banner.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('clears the ?reset=1 query param after mount', async () => {
    renderLogin({ initialEntries: ['/login?reset=1'] })
    await screen.findByTestId('login-form-banner')
    await waitFor(() => {
      // Probe the `reset` param directly — the prior assertion against
      // `url-error-param` was vacuous (the URL never set `?error=`)
      // ([Review][Patch] P6 — code-review 2026-06-26).
      expect(screen.getByTestId('url-reset-param').textContent).toBe('')
    })
  })

  test('prefers reset banner over verified banner when both ?verified=1&reset=1 land together (priority: reset > verified)', async () => {
    renderLogin({ initialEntries: ['/login?verified=1&reset=1'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.reset'))
  })

  // ===== Story 1-9c — `?invited=true` banner contracts (+4 tests per AC6) =====

  test('renders invited banner with checkmark glyph when /login?invited=true lands', async () => {
    renderLogin({ initialEntries: ['/login?invited=true'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.invited'))
    // Inline checkmark SVG with aria-hidden — same shape as the reset
    // banner so axe-zero stays clean.
    const svg = banner.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('clears the ?invited=true query param after mount', async () => {
    renderLogin({ initialEntries: ['/login?invited=true'] })
    await screen.findByTestId('login-form-banner')
    await waitFor(() => {
      expect(screen.getByTestId('url-invited-param').textContent).toBe('')
    })
  })

  test('prefers invited banner over reset banner when both ?invited=true&reset=1 land (priority: invited > reset)', async () => {
    renderLogin({ initialEntries: ['/login?invited=true&reset=1'] })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.invited'))
  })

  test('prefers invited banner over oauth-error when both ?invited=true&error=invite_email_mismatch land (Winston priority-escalation collision)', async () => {
    renderLogin({
      initialEntries: ['/login?invited=true&error=invite_email_mismatch'],
    })
    const banner = await screen.findByTestId('login-form-banner')
    expect(banner.textContent).toBe(i18n.t('auth.login.banner.invited'))
    // The swallowed oauth-error param MUST be wiped alongside `invited`
    // — closes the ratchet against future priority-chain flips silently
    // suppressing oauth-error.
    await waitFor(() => {
      expect(screen.getByTestId('url-error-param').textContent).toBe('')
      expect(screen.getByTestId('url-invited-param').textContent).toBe('')
    })
  })

  test('session cache is invalidated on ?reset=1 landing (Murat addition — closes stale-sibling-tab flash)', async () => {
    const client = createTestQueryClient()
    // Pre-seed a stale session from a sibling tab (the user reset
    // their password elsewhere; the backend wiped refresh tokens but
    // this tab still has the cached LoginResult in memory).
    client.setQueryData(authKeys.session(), {
      user: {
        id: 'u1',
        email: 'a@b.co',
        fullName: 'A',
        emailVerified: true,
      },
      accessToken: 'stale',
    })
    renderLogin({ client, initialEntries: ['/login?reset=1'] })
    // The wipe lives in a post-commit `useEffect` (moved out of the
    // lazy initializer to keep render pure — [Review][Patch] P3 /
    // [Review][Patch] P4 from code-review 2026-06-26 — guarded on
    // `!isAuthenticated && !isLoading` so an already signed-in user
    // doesn't get their session yanked). useAuth's next read sees
    // `undefined` once the effect commits.
    await waitFor(() => {
      expect(client.getQueryData(authKeys.session())).toBeUndefined()
    })
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

describe('LoginPage Story 1-9d — Auth Error & Recovery States', () => {
  // ===== AC1 — Lockout state (mode replacement + localStorage rehydrate) =====

  test('AC1: 429 ACCOUNT_LOCKED with missing Retry-After falls back to 900s', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'ACCOUNT_LOCKED', message: 'locked', details: null } },
          { status: 429 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    await screen.findByTestId('login-lockout')
    const raw = window.localStorage.getItem('classlite_login_lockout_until')
    expect(raw).not.toBeNull()
    const envelope = JSON.parse(raw!) as { lockoutUntilMs: number }
    const expected = Date.now() + 900_000
    expect(Math.abs(envelope.lockoutUntilMs - expected)).toBeLessThan(2_000)
  })

  test('AC1: lockout state rehydrates from localStorage on mount (zero MSW calls)', async () => {
    window.localStorage.setItem(
      'classlite_login_lockout_until',
      JSON.stringify({ lockoutUntilMs: Date.now() + 30_000, version: 1 }),
    )
    let postCount = 0
    server.use(
      http.post('/api/auth/login', () => {
        postCount++
        return HttpResponse.json({}, { status: 200 })
      }),
    )
    renderLogin()
    await screen.findByTestId('login-lockout')
    expect(postCount).toBe(0)
  })

  test('AC1: password reset CTA inside lockout region routes to /forgot-password', async () => {
    window.localStorage.setItem(
      'classlite_login_lockout_until',
      JSON.stringify({ lockoutUntilMs: Date.now() + 30_000, version: 1 }),
    )
    renderLogin()
    const cta = await screen.findByTestId('login-lockout-reset-cta')
    expect(cta.getAttribute('href')).toBe('/forgot-password')
  })

  test('AC1: Google OAuth button remains MOUNTED during lockout', async () => {
    window.localStorage.setItem(
      'classlite_login_lockout_until',
      JSON.stringify({ lockoutUntilMs: Date.now() + 30_000, version: 1 }),
    )
    renderLogin()
    await screen.findByTestId('login-lockout')
    expect(screen.getByTestId('google-oauth-cta')).toBeTruthy()
  })

  test('AC1: lockout heading receives focus on mount (Sally a11y pin)', async () => {
    window.localStorage.setItem(
      'classlite_login_lockout_until',
      JSON.stringify({ lockoutUntilMs: Date.now() + 30_000, version: 1 }),
    )
    renderLogin()
    const heading = await screen.findByTestId('login-lockout-heading')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading)
    })
  })

  test('AC1: Murat ATDD ratchet — submit button NOT mounted during lockout', async () => {
    window.localStorage.setItem(
      'classlite_login_lockout_until',
      JSON.stringify({ lockoutUntilMs: Date.now() + 30_000, version: 1 }),
    )
    renderLogin()
    await screen.findByTestId('login-lockout')
    expect(screen.queryByTestId('login-submit')).toBeNull()
    expect(screen.queryByTestId('login-form')).toBeNull()
  })

  // ===== AC2 — OAuth Email Mismatch =====

  test('AC2: ?error=invite_email_mismatch transitions LoginPage to oauthMismatch mode', async () => {
    renderLogin({ initialEntries: ['/login?error=invite_email_mismatch'] })
    await screen.findByTestId('login-oauth-mismatch')
    expect(screen.queryByTestId('login-form')).toBeNull()
    expect(screen.queryByTestId('login-form-banner')).toBeNull()
    expect(screen.queryByTestId('login-form-error')).toBeNull()
    // Mode × Banner negative coverage matrix (Murat M4 STRONG pin)
    expect(screen.queryByTestId('login-lockout')).toBeNull()
    expect(screen.queryByTestId('login-workspace-blocked')).toBeNull()
    expect(screen.queryByTestId('login-submit')).toBeNull()
  })

  test('AC2: OAuth mismatch retry CTA threads prompt=select_account', async () => {
    renderLogin({ initialEntries: ['/login?error=invite_email_mismatch'] })
    const cta = await screen.findByTestId('login-oauth-mismatch-retry-cta')
    const href = cta.getAttribute('href') ?? ''
    expect(href).toContain('prompt=select_account')
  })

  test('AC2: OAuth mismatch screen does NOT render a register CTA (Sally STRONG ratchet)', async () => {
    renderLogin({ initialEntries: ['/login?error=invite_email_mismatch'] })
    await screen.findByTestId('login-oauth-mismatch')
    expect(
      screen.queryByTestId('login-oauth-mismatch-register-cta'),
    ).toBeNull()
  })

  test('AC2: OAuth mismatch heading receives focus on mount', async () => {
    renderLogin({ initialEntries: ['/login?error=invite_email_mismatch'] })
    const heading = await screen.findByTestId('login-oauth-mismatch-heading')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading)
    })
  })

  test('AC2: Murat M6 DOM-wide privacy ratchet — no email / query-param echo', async () => {
    const { container } = renderLogin({
      initialEntries: [
        '/login?error=invite_email_mismatch&invitedEmail=leak%40example.com&oauthEmail=leak2%40example.com',
      ],
    })
    await screen.findByTestId('login-oauth-mismatch')
    const text = container.textContent ?? ''
    expect(text).not.toContain('@')
    expect(text).not.toContain('leak@example.com')
    expect(text).not.toContain('leak2@example.com')
    expect(text).not.toContain('invitedEmail=leak')
  })

  // ===== AC3 — Workspace Blocked (forked body) =====

  test('AC3: ?error=google_userinfo_failed renders userinfo-failed body copy', async () => {
    renderLogin({ initialEntries: ['/login?error=google_userinfo_failed'] })
    await screen.findByTestId('login-workspace-blocked')
    expect(screen.queryByTestId('login-form')).toBeNull()
    const body = screen.getByTestId('login-workspace-blocked-body')
    expect(body.textContent).toBe(
      i18n.t('auth.login.workspaceBlocked.bodyUserinfoFailed'),
    )
    // Mode × Banner negative coverage matrix
    expect(screen.queryByTestId('login-lockout')).toBeNull()
    expect(screen.queryByTestId('login-oauth-mismatch')).toBeNull()
    expect(screen.queryByTestId('login-submit')).toBeNull()
  })

  test('AC3: ?error=google_email_unverified renders email-unverified body copy (distinct from userinfo)', async () => {
    renderLogin({ initialEntries: ['/login?error=google_email_unverified'] })
    await screen.findByTestId('login-workspace-blocked')
    const body = screen.getByTestId('login-workspace-blocked-body')
    expect(body.textContent).toBe(
      i18n.t('auth.login.workspaceBlocked.bodyEmailUnverified'),
    )
    expect(body.textContent).not.toBe(
      i18n.t('auth.login.workspaceBlocked.bodyUserinfoFailed'),
    )
  })

  test('AC3: workspace blocked retry CTA threads prompt=select_account', async () => {
    renderLogin({ initialEntries: ['/login?error=google_userinfo_failed'] })
    const cta = await screen.findByTestId('login-workspace-blocked-retry-cta')
    expect(cta.getAttribute('href') ?? '').toContain('prompt=select_account')
  })

  test('AC3: workspace blocked heading receives focus on mount', async () => {
    renderLogin({ initialEntries: ['/login?error=google_userinfo_failed'] })
    const heading = await screen.findByTestId('login-workspace-blocked-heading')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading)
    })
  })

  test('AC3: Murat M6 query-param echo privacy ratchet', async () => {
    const { container } = renderLogin({
      initialEntries: ['/login?error=google_userinfo_failed&hint=leak%40example.com'],
    })
    await screen.findByTestId('login-workspace-blocked')
    const text = container.textContent ?? ''
    expect(text).not.toContain('@')
    expect(text).not.toContain('hint=leak')
  })

  // ===== AC4 — Session Expiry + next= consumer =====

  test('AC4: session-expired banner + form both mounted', async () => {
    renderLogin({ initialEntries: ['/login?session_expired=1'] })
    await screen.findByTestId('login-form-banner')
    // Form region is still mounted (banner is acknowledgment, not replacement).
    // We open the form to verify the form-tree mounts cleanly alongside.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    expect(screen.getByTestId('login-form')).toBeTruthy()
    // Mode × Banner negative coverage matrix
    expect(screen.queryByTestId('login-lockout')).toBeNull()
    expect(screen.queryByTestId('login-oauth-mismatch')).toBeNull()
    expect(screen.queryByTestId('login-workspace-blocked')).toBeNull()
  })

  test('AC4: session-expired banner does NOT steal focus from form (Sally a11y pin)', async () => {
    renderLogin({ initialEntries: ['/login?session_expired=1'] })
    await screen.findByTestId('login-form-banner')
    // Focus stays on document body or first focusable; banner.heading is NOT focused.
    const banner = screen.getByTestId('login-form-banner')
    expect(document.activeElement).not.toBe(banner)
  })

  test('AC4: session-expired data-loss hint copy renders', async () => {
    renderLogin({ initialEntries: ['/login?session_expired=1'] })
    const hint = await screen.findByTestId('login-session-expired-data-loss')
    expect(hint.textContent).toBe(
      i18n.t('auth.login.banner.sessionExpiredDataLossHint'),
    )
  })

  test('AC4: URL-clear effect drops session_expired but PRESERVES next= (Amelia A6 pin)', async () => {
    renderLogin({
      initialEntries: ['/login?session_expired=1&next=%2Fclasses%2F42'],
    })
    await screen.findByTestId('login-form-banner')
    await waitFor(() => {
      expect(screen.getByTestId('url-session-expired-param').textContent).toBe('')
      expect(screen.getByTestId('url-next-param').textContent).toBe(
        '/classes/42',
      )
    })
  })

  test('AC4: successful login navigates to whitelisted next= via password submit (site b)', async () => {
    const user = userEvent.setup()
    renderLogin({
      initialEntries: ['/login?session_expired=1&next=%2Fclasses%2F42'],
    })
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    await screen.findByTestId('test-route-classes')
  })

  test('AC4: rejected next= falls back to /dashboard (open-redirect ratchet)', async () => {
    const user = userEvent.setup()
    renderLogin({
      initialEntries: ['/login?session_expired=1&next=%2F%2Fevil.example.com'],
    })
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      'a@a.com',
    )
    await user.type(screen.getByLabelText(i18n.t('auth.common.password')), 'pw')
    await user.click(screen.getByTestId('login-submit'))
    await screen.findByText(/dashboard reached/i)
  })

  test('AC4: already-auth navigate respects next= (site c — Winston W2 / Murat M3)', async () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.session(), {
      user: { id: 'u1', email: 'a@b.co', fullName: 'A', emailVerified: true },
      accessToken: 'jwt',
    })
    renderLogin({
      client,
      initialEntries: ['/login?session_expired=1&next=%2Fclasses%2F42'],
    })
    await screen.findByTestId('test-route-classes')
  })

  test('AC4: Murat M5 cookie-clear StrictMode spy — exactly ONE invocation', async () => {
    // Spy on `document.cookie` setter; StrictMode would double-invoke effects
    // in dev mode, so without the useRef latch the cookie would be set twice.
    const setSpy = vi.fn()
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    )
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set: setSpy,
      get: () => '',
    })
    try {
      const { StrictMode } = await import('react')
      const client = createTestQueryClient()
      const ui: ReactNode = (
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/login?session_expired=1']}>
              <Toaster />
              <Routes>
                <Route
                  path="/login"
                  element={
                    <StrictMode>
                      <UrlProbe />
                      <LoginPage />
                    </StrictMode>
                  }
                />
                <Route
                  path="/dashboard"
                  element={<p>dashboard reached</p>}
                />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>
      )
      const { rerender } = render(ui)
      await screen.findByTestId('login-form-banner')
      // Exactly ONE cookie-set call — NOT 2 from StrictMode double-invoke.
      const matchingCalls = setSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].startsWith('logged_in='),
      )
      expect(matchingCalls.length).toBe(1)
      // Re-render with same searchParams; setter call count unchanged.
      rerender(ui)
      const matchingCallsAfter = setSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].startsWith('logged_in='),
      )
      expect(matchingCallsAfter.length).toBe(1)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Document.prototype, 'cookie', originalDescriptor)
      }
    }
  })
})
