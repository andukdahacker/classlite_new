/**
 * InviteAcceptancePage — Story 1-9c AC4 / AC5 pinned contracts.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test.
 * Navigate assertion uses MemoryRouter + sibling Route pattern from
 * VerifyEmailPage.test.tsx — NOT vi.mock('react-router').
 *
 * TEST-FE-6 ratchet: every terminal-state test asserts the OTHER seven
 * terminal regions + `invite-form` are absent from the DOM.
 *
 * Privacy ratchet (Amelia party-mode 2026-06-26): for each of the seven
 * terminal regions with a footer back-to-login link, click the link inside
 * a MemoryRouter + sibling Route<UrlProbe> and assert the resulting URL
 * does NOT carry `?invited=true` (closes the leak where a future dev
 * wires `?invited=true` to error footers "for consistency").
 */
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import InviteAcceptancePage from '@/features/auth/InviteAcceptancePage'
import { createTestQueryClient } from '@/lib/query-client'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

const TOKEN = 'abc123'

const TERMINAL_TESTIDS = [
  'invite-not-found',
  'invite-expired',
  'invite-already-accepted',
  'invite-email-mismatch',
  'invite-password-not-allowed',
  'invite-email-already-registered',
  'invite-invalid-token',
] as const

function assertOnlyRegion(present: string) {
  for (const id of TERMINAL_TESTIDS) {
    if (id === present) {
      expect(screen.queryByTestId(id)).not.toBeNull()
    } else {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  }
  if (present !== 'invite-form') {
    expect(screen.queryByTestId('invite-form')).toBeNull()
  } else {
    expect(screen.queryByTestId('invite-form')).not.toBeNull()
  }
}

function LoginUrlProbe() {
  const location = useLocation()
  const [params] = useSearchParams()
  return (
    <>
      <span data-testid="login-pathname">{location.pathname}</span>
      <span data-testid="login-invited-param">
        {params.get('invited') ?? ''}
      </span>
    </>
  )
}

interface RenderOpts {
  initialEntries?: string[]
  client?: QueryClient
}

function renderPage({
  initialEntries = [`/invite/${TOKEN}`],
  client = createTestQueryClient(),
}: RenderOpts = {}) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/invite/:token" element={<InviteAcceptancePage />} />
            <Route
              path="/invite"
              element={<InviteAcceptancePage />}
            />
            <Route path="/login" element={<LoginUrlProbe />} />
            <Route
              path="/dashboard"
              element={<p data-testid="dashboard-reached">dashboard</p>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...render(ui), client }
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InviteAcceptancePage — initial paint + form contract (AC4)', () => {
  test('renders form on initial paint when token is in URL', async () => {
    renderPage()
    expect(await screen.findByTestId('invite-form')).not.toBeNull()
    assertOnlyRegion('invite-form')
  })

  test('Google CTA carries the inviteToken in href (non-empty token + <a>, not RR <Link>)', async () => {
    renderPage()
    await screen.findByTestId('invite-form')
    // Vacuous-pass guard — Murat 1-9c party-mode tightening
    expect(TOKEN.length).toBeGreaterThan(0)
    const cta = screen.getByTestId('google-oauth-cta')
    expect(cta.tagName.toLowerCase()).toBe('a')
    // RR <Link> sets data-discover; a plain <a> does not.
    expect(cta.getAttribute('data-discover')).toBeNull()
    const href = (cta as HTMLAnchorElement).getAttribute('href') ?? ''
    expect(href.endsWith(`/api/auth/google?inviteToken=${TOKEN}`)).toBe(true)
  })
})

describe('InviteAcceptancePage — invalid-token state (AC4)', () => {
  test('renders invalid-token state when path token is whitespace-only + zero MSW request count', async () => {
    let requestCount = 0
    server.use(
      http.post('/api/auth/accept-invite', () => {
        requestCount += 1
        return HttpResponse.json({ data: {} }, { status: 200 })
      }),
    )
    // `/invite/%20%20` decodes to two spaces — page short-circuits to invalidToken.
    renderPage({ initialEntries: ['/invite/%20%20'] })
    await screen.findByTestId('invite-invalid-token')
    assertOnlyRegion('invite-invalid-token')
    expect(requestCount).toBe(0)
  })

  test('Google CTA is NOT rendered when token is empty/whitespace-only', async () => {
    renderPage({ initialEntries: ['/invite/%20%20'] })
    await screen.findByTestId('invite-invalid-token')
    expect(screen.queryByTestId('google-oauth-cta')).toBeNull()
  })
})

describe('InviteAcceptancePage — happy submit (AC4)', () => {
  test('submits {inviteToken, fullName, password} on 200 + navigates to /dashboard', async () => {
    let receivedBody: unknown = null
    server.use(
      http.post('/api/auth/accept-invite', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json(
          {
            data: {
              accessToken: 'msw.invite.jwt',
              user: {
                id: 'u-1',
                email: 'linh@example.com',
                fullName: 'Linh Nguyen',
                emailVerified: true,
              },
              center: {
                id: '00000000-0000-0000-0000-000000000001',
                name: 'MSW Center',
              },
              role: 'teacher',
            },
          },
          {
            status: 200,
            headers: {
              'Set-Cookie':
                'refresh_token=msw-invite-refresh-token; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
            },
          },
        )
      }),
    )
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh Nguyen')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
    await screen.findByTestId('dashboard-reached')
    expect(receivedBody).toEqual({
      inviteToken: TOKEN,
      fullName: 'Linh Nguyen',
      password: 'goodPass123',
    })
  })

  test('submit disabled while mutation pending', async () => {
    let resolvePending: (value: unknown) => void = () => undefined
    server.use(
      http.post('/api/auth/accept-invite', () =>
        new Promise<unknown>((resolve) => {
          resolvePending = resolve
        }).then(() =>
          HttpResponse.json(
            {
              data: {
                accessToken: 'jwt',
                user: {
                  id: 'u-1',
                  email: 'linh@example.com',
                  fullName: 'Linh',
                  emailVerified: true,
                },
                center: { id: 'c-1', name: 'C' },
                role: 'teacher',
              },
            },
            { status: 200 },
          ),
        ),
      ),
    )
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
    await waitFor(() => {
      expect(
        (screen.getByTestId('invite-submit') as HTMLButtonElement).disabled,
      ).toBe(true)
    })
    // Release the pending response to clean up after the assertion.
    resolvePending(null)
  })
})

describe('InviteAcceptancePage — form validation (AC4)', () => {
  test('empty submit shows fullNameRequired error + zero MSW count', async () => {
    let requestCount = 0
    server.use(
      http.post('/api/auth/accept-invite', () => {
        requestCount += 1
        return HttpResponse.json({ data: {} }, { status: 200 })
      }),
    )
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.click(screen.getByTestId('invite-submit'))
    await screen.findByText(i18n.t('auth.invite.error.fullNameRequired'))
    expect(requestCount).toBe(0)
  })

  test('short password submit shows passwordMin error + zero MSW count', async () => {
    let requestCount = 0
    server.use(
      http.post('/api/auth/accept-invite', () => {
        requestCount += 1
        return HttpResponse.json({ data: {} }, { status: 200 })
      }),
    )
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'short')
    await user.click(screen.getByTestId('invite-submit'))
    await screen.findByText(i18n.t('auth.common.validation.passwordMin'))
    expect(requestCount).toBe(0)
  })
})

describe('InviteAcceptancePage — ?c= ribbon (Sally party-mode AC4)', () => {
  test('renders titleWithCenter H1 when sanitized centerName is present', async () => {
    renderPage({ initialEntries: [`/invite/${TOKEN}?c=IELTS%20Academy`] })
    const heading = await screen.findByTestId('invite-heading')
    expect(heading.textContent).toBe(
      i18n.t('auth.invite.titleWithCenter', { centerName: 'IELTS Academy' }),
    )
  })

  test('falls back to title H1 when ?c is absent', async () => {
    renderPage()
    const heading = await screen.findByTestId('invite-heading')
    expect(heading.textContent).toBe(i18n.t('auth.invite.title'))
  })

  test('falls back to title H1 when ?c is whitespace-only OR fails sanitization (XSS attempt)', async () => {
    const { unmount } = renderPage({
      initialEntries: [`/invite/${TOKEN}?c=%20%20`],
    })
    const heading = await screen.findByTestId('invite-heading')
    expect(heading.textContent).toBe(i18n.t('auth.invite.title'))
    unmount()

    renderPage({
      initialEntries: [
        `/invite/${TOKEN}?c=%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
      ],
    })
    const heading2 = await screen.findByTestId('invite-heading')
    expect(heading2.textContent).toBe(i18n.t('auth.invite.title'))
  })
})

describe('InviteAcceptancePage — CollapsibleEmailForm a11y (Sally party-mode AC4)', () => {
  test('focus moves to fullName input on expand', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId('invite-fullname-input'),
      )
    })
  })

  test('aria-live region announces "Email form expanded" after expand', async () => {
    renderPage()
    // Region is INSIDE CollapsibleContent — absent from DOM while collapsed.
    expect(screen.queryByTestId('invite-aria-live')).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await waitFor(() => {
      const live = screen.getByTestId('invite-aria-live')
      expect(live.textContent).toBe(
        i18n.t('auth.invite.emailFormExpandedAnnouncement'),
      )
    })
  })
})

describe('InviteAcceptancePage — terminal error states (AC5)', () => {
  async function submitForm() {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
  }

  test('404 INVITE_NOT_FOUND swaps to terminal notFound region (TEST-FE-6)', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_NOT_FOUND',
              message: 'gone',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-not-found')
    assertOnlyRegion('invite-not-found')
  })

  test('410 INVITE_EXPIRED with details renders centerName + inviterEmail + mailto CTA', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_EXPIRED',
              message: 'expired',
              details: {
                centerName: 'IELTS Academy',
                inviterEmail: 'linh@example.com',
              },
            },
          },
          { status: 410 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-expired')
    assertOnlyRegion('invite-expired')
    const cta = screen.getByTestId('invite-expired-contact-cta')
    expect((cta as HTMLAnchorElement).getAttribute('href')).toBe(
      'mailto:linh@example.com',
    )
  })

  test('409 INVITE_ALREADY_ACCEPTED renders centerName + sign-in CTA', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_ALREADY_ACCEPTED',
              message: 'taken',
              details: { centerName: 'IELTS Academy' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-already-accepted')
    assertOnlyRegion('invite-already-accepted')
    expect(
      screen.getByTestId('invite-already-accepted-cta').getAttribute('href'),
    ).toBe('/login')
  })

  test('409 INVITE_EMAIL_MISMATCH renders emailMismatch + does NOT leak invited/oauth emails (Murat ratchet)', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_EMAIL_MISMATCH',
              message: 'mismatch',
              details: {
                invitedEmail: 'leak-invited@example.com',
                oauthEmail: 'leak-oauth@example.com',
              },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { container } = renderPage()
    await submitForm()
    await screen.findByTestId('invite-email-mismatch')
    assertOnlyRegion('invite-email-mismatch')
    expect(screen.queryByText('leak-invited@example.com')).toBeNull()
    expect(screen.queryByText('leak-oauth@example.com')).toBeNull()
    expect(container.textContent).not.toContain('leak-invited@example.com')
    expect(container.textContent).not.toContain('leak-oauth@example.com')
  })

  test('409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER renders passwordNotAllowed + Google CTA re-rendered', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER',
              message: 'oauth-only',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-password-not-allowed')
    assertOnlyRegion('invite-password-not-allowed')
    expect(screen.queryByTestId('google-oauth-cta')).not.toBeNull()
  })

  test('409 EMAIL_ALREADY_REGISTERED renders emailAlreadyRegistered + sign-in CTA', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'dup',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-email-already-registered')
    assertOnlyRegion('invite-email-already-registered')
    expect(
      screen
        .getByTestId('invite-email-already-registered-cta')
        .getAttribute('href'),
    ).toBe('/login')
  })

  test('400 INVALID_INVITE_TOKEN swaps to invalidToken terminal region', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_INVITE_TOKEN',
              message: 'malformed',
              details: null,
            },
          },
          { status: 400 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-invalid-token')
    assertOnlyRegion('invite-invalid-token')
  })
})

describe('InviteAcceptancePage — non-terminal inline alerts (AC5)', () => {
  async function submitForm() {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
  }

  test('429 rate-limited shows inline alert + disables submit (countdown active)', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'slow down',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '45' } },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-error-alert')
    // Form stays mounted; terminal regions absent.
    expect(screen.queryByTestId('invite-form')).not.toBeNull()
    for (const id of TERMINAL_TESTIDS) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    await waitFor(() => {
      expect(
        (screen.getByTestId('invite-submit') as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })

  test('429 with missing Retry-After defaults to 60s', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'slow down',
              details: null,
            },
          },
          { status: 429 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    const alert = await screen.findByTestId('invite-error-alert')
    expect(alert.textContent).toContain('60')
  })

  test('429 with Retry-After: 0 clamps countdown to MIN_RATE_LIMIT_SECONDS (5s, not 0)', async () => {
    // Winston 1-9b code-review P8 pattern carried forward — a clock-drifted
    // backend emitting `Retry-After: 0` must NOT collapse the submit gate
    // to "fire again immediately." The page-level clampRateLimit floors at
    // MIN_RATE_LIMIT_SECONDS=5, and the alert text re-derives from
    // countdown.remaining so the displayed seconds reflect the floored
    // value.
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'slow down',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '0' } },
        ),
      ),
    )
    renderPage()
    await submitForm()
    const alert = await screen.findByTestId('invite-error-alert')
    // Floor is 5s — never 0, never 1, never 60 (would mean the default
    // path fired instead of the explicit clamp).
    expect(alert.textContent).toContain('5')
    expect(alert.textContent).not.toContain('60')
    expect(alert.textContent).not.toMatch(/\b0\b/)
    // Submit gate must stay disabled while countdown active.
    await waitFor(() => {
      expect(
        (screen.getByTestId('invite-submit') as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })

  test('5xx renders generic alert + form stays in input mode', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom', details: null } },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-error-alert')
    expect(screen.queryByTestId('invite-form')).not.toBeNull()
    for (const id of TERMINAL_TESTIDS) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })

  test('422 renders generic alert + form stays in input mode', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'invalid',
              details: { fields: [] },
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await submitForm()
    await screen.findByTestId('invite-error-alert')
    expect(screen.queryByTestId('invite-form')).not.toBeNull()
    for (const id of TERMINAL_TESTIDS) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })
})

describe('InviteAcceptancePage — token-change-resets-errorState (Murat ATDD specimen)', () => {
  test('navigating from a 410-expired token to a fresh token returns the form region', async () => {
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_EXPIRED',
              message: 'expired',
              details: {
                centerName: 'Old Center',
                inviterEmail: 'old@example.com',
              },
            },
          },
          { status: 410 },
        ),
      ),
    )
    const client = createTestQueryClient()
    // MemoryRouter reads `initialEntries` only at init, so a prop change
    // on rerender does NOT navigate. Forcing a remount via `key` is the
    // only way to simulate a same-tab URL-bar edit / preview re-click in
    // a memory-router test. The actual production path uses path-segment
    // changes that React Router handles natively — the test mirrors that
    // via key-based remount.
    const buildTree = (entry: string) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter key={entry} initialEntries={[entry]}>
            <Routes>
              <Route
                path="/invite/:token"
                element={<InviteAcceptancePage />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    )
    const { rerender } = render(buildTree('/invite/oldToken'))
    // First render: trigger 410 by submitting.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
    await screen.findByTestId('invite-expired')
    // Rerender with a fresh token (key change forces remount, simulates a
    // path-segment change React Router would honor in production).
    rerender(buildTree('/invite/freshToken'))
    await screen.findByTestId('invite-form')
    expect(screen.queryByTestId('invite-expired')).toBeNull()
    expect(screen.queryByTestId('invite-error-alert')).toBeNull()
  })
})

describe('InviteAcceptancePage — privacy ratchet (Amelia party-mode)', () => {
  async function landTerminal(
    setup: () => void,
    terminalId: (typeof TERMINAL_TESTIDS)[number] | 'invite-invalid-token',
  ) {
    setup()
    renderPage()
    // Submit if the terminal isn't already mount-rendered (invalidToken via empty path renders without submit)
    if (terminalId !== 'invite-invalid-token') {
      const user = userEvent.setup()
      await user.click(screen.getByTestId('collapsible-email-trigger'))
      await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
      await user.type(
        screen.getByTestId('invite-password-input'),
        'goodPass123',
      )
      await user.click(screen.getByTestId('invite-submit'))
    }
    await screen.findByTestId(terminalId)
  }

  test('footer Sign-in link from notFound terminal lands on /login (no ?invited=true)', async () => {
    await landTerminal(() => {
      server.use(
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            { error: { code: 'INVITE_NOT_FOUND', message: 'x', details: null } },
            { status: 404 },
          ),
        ),
      )
    }, 'invite-not-found')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('invite-back-link'))
    expect(screen.getByTestId('login-pathname').textContent).toBe('/login')
    expect(screen.getByTestId('login-invited-param').textContent).toBe('')
  })

  test('footer Sign-in link from invalidToken state lands on /login (no ?invited=true)', async () => {
    renderPage({ initialEntries: ['/invite/%20'] })
    await screen.findByTestId('invite-invalid-token')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('invite-back-link'))
    expect(screen.getByTestId('login-pathname').textContent).toBe('/login')
    expect(screen.getByTestId('login-invited-param').textContent).toBe('')
  })

  test('footer Sign-in link from expired terminal lands on /login (no ?invited=true)', async () => {
    await landTerminal(() => {
      server.use(
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_EXPIRED',
                message: 'expired',
                details: {
                  centerName: 'IELTS Academy',
                  inviterEmail: 'linh@example.com',
                },
              },
            },
            { status: 410 },
          ),
        ),
      )
    }, 'invite-expired')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('invite-back-link'))
    expect(screen.getByTestId('login-pathname').textContent).toBe('/login')
    expect(screen.getByTestId('login-invited-param').textContent).toBe('')
  })

  test('footer Sign-in link from emailMismatch terminal lands on /login (no ?invited=true)', async () => {
    await landTerminal(() => {
      server.use(
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_EMAIL_MISMATCH',
                message: 'mismatch',
                details: {
                  invitedEmail: 'leak-invited@example.com',
                  oauthEmail: 'leak-oauth@example.com',
                },
              },
            },
            { status: 409 },
          ),
        ),
      )
    }, 'invite-email-mismatch')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('invite-back-link'))
    expect(screen.getByTestId('login-pathname').textContent).toBe('/login')
    expect(screen.getByTestId('login-invited-param').textContent).toBe('')
  })

  test('footer Sign-in link from passwordNotAllowed terminal lands on /login (no ?invited=true)', async () => {
    await landTerminal(() => {
      server.use(
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER',
                message: 'oauth-only',
                details: null,
              },
            },
            { status: 409 },
          ),
        ),
      )
    }, 'invite-password-not-allowed')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('invite-back-link'))
    expect(screen.getByTestId('login-pathname').textContent).toBe('/login')
    expect(screen.getByTestId('login-invited-param').textContent).toBe('')
  })

  test('alreadyAccepted + emailAlreadyRegistered terminals intentionally omit the footer back-link (primary CTA already routes to /login)', async () => {
    // P13 — lock the intentional design asymmetry. Two terminal regions
    // (alreadyAccepted + emailAlreadyRegistered) deliberately have NO
    // footer `<Link to="/login" data-testid="invite-back-link">` because
    // their primary CTA already routes to /login. Without this negative
    // assertion, a future dev adding the footer "for consistency" would
    // pass green CI while breaking the design intent.
    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVITE_ALREADY_ACCEPTED',
              message: 'taken',
              details: { centerName: 'IELTS Academy' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const { unmount } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user.type(screen.getByTestId('invite-password-input'), 'goodPass123')
    await user.click(screen.getByTestId('invite-submit'))
    await screen.findByTestId('invite-already-accepted')
    expect(screen.queryByTestId('invite-back-link')).toBeNull()
    expect(
      screen.getByTestId('invite-already-accepted-cta').getAttribute('href'),
    ).toBe('/login')
    unmount()

    server.use(
      http.post('/api/auth/accept-invite', () =>
        HttpResponse.json(
          {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'dup',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderPage()
    const user2 = userEvent.setup()
    await user2.click(screen.getByTestId('collapsible-email-trigger'))
    await user2.type(screen.getByTestId('invite-fullname-input'), 'Linh')
    await user2.type(
      screen.getByTestId('invite-password-input'),
      'goodPass123',
    )
    await user2.click(screen.getByTestId('invite-submit'))
    await screen.findByTestId('invite-email-already-registered')
    expect(screen.queryByTestId('invite-back-link')).toBeNull()
    expect(
      screen
        .getByTestId('invite-email-already-registered-cta')
        .getAttribute('href'),
    ).toBe('/login')
  })
})
