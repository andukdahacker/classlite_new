/**
 * ResetPasswordPage — Story 1-9b AC5 / AC6.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test. i18n
 * resolved via the real en locale — never hardcoded English.
 *
 * Navigate-spy pattern: MemoryRouter + sibling `<Route path="/login"
 * element={<p data-testid="login-reached" />}>` per VerifyEmailPage.test.tsx:75-96.
 *
 * Pinned contracts per AC5 + AC6:
 *   - Form mode on initial paint with valid token; expired/consumed/invalid absent.
 *   - Invalid state for missing / empty / whitespace token + zero MSW request count.
 *   - Submit fires deep-equal `{ token, newPassword }` then navigate to /login?reset=1.
 *   - Mismatch shows passwordMismatch error + does NOT submit (zero MSW count).
 *   - Stale-refine ATDD specimen — edit newPassword after both blur,
 *     submit short-circuits, mismatch visible.
 *   - Email-leak rejection ratchet — `?token=abc&email=leak@x.com` MUST NOT
 *     display the email anywhere; password fields stay empty.
 *   - Min-length / blank-only newPassword rejected client-side.
 *   - Submit disabled while pending.
 *   - PasswordStrengthBar updates as user types.
 *   - 410 RESET_TOKEN_EXPIRED → expired region; other three regions absent.
 *   - 409 RESET_TOKEN_CONSUMED → consumed region; other three regions absent.
 *   - 404 RESET_TOKEN_INVALID → invalid region; other three regions absent.
 *   - 422 / 5xx → generic alert; form stays input mode.
 */
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import ResetPasswordPage from '@/features/auth/ResetPasswordPage'
import { createTestQueryClient } from '@/lib/query-client'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

// URL-probe sibling so the email-leak ratchet test can assert
// MemoryRouter's URL state — MemoryRouter doesn't touch window.location
// ([Review][Patch] P5 — code-review 2026-06-26).
function ResetUrlProbe() {
  const [searchParams] = useSearchParams()
  return (
    <>
      <span data-testid="reset-url-email-param">
        {searchParams.get('email') ?? ''}
      </span>
      <span data-testid="reset-url-token-param">
        {searchParams.get('token') ?? ''}
      </span>
    </>
  )
}

function renderReset(
  initialEntry: string,
  client: QueryClient = createTestQueryClient(),
) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="/reset-password"
              element={
                <>
                  <ResetUrlProbe />
                  <ResetPasswordPage />
                </>
              }
            />
            <Route
              path="/login"
              element={<p data-testid="login-reached">login</p>}
            />
            <Route
              path="/forgot-password"
              element={
                <p data-testid="forgot-password-reached">forgot-password</p>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(ui)
  return { client, container }
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  values: { newPassword: string; confirmPassword: string },
  options: { blurBeforeSubmit?: boolean } = {},
) {
  await user.type(screen.getByTestId('reset-new-password'), values.newPassword)
  await user.type(
    screen.getByTestId('reset-confirm-password'),
    values.confirmPassword,
  )
  if (options.blurBeforeSubmit) {
    await user.tab()
  }
  await user.click(screen.getByTestId('reset-submit'))
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResetPasswordPage (Story 1-9b AC5 / AC6)', () => {
  test('renders form on initial paint with token in URL', () => {
    renderReset('/reset-password?token=abc123')
    expect(screen.getByTestId('reset-password-form')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-invalid')).toBeNull()
    expect(screen.queryByTestId('reset-password-expired')).toBeNull()
    expect(screen.queryByTestId('reset-password-consumed')).toBeNull()
  })

  test('renders invalid state when token query param is missing (NO network call)', async () => {
    let requestCount = 0
    server.use(
      http.post('/api/auth/reset-password', () => {
        requestCount++
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password')
    expect(screen.getByTestId('reset-password-invalid')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
    expect(requestCount).toBe(0)
  })

  test('renders invalid state when token is empty string', () => {
    renderReset('/reset-password?token=')
    expect(screen.getByTestId('reset-password-invalid')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
  })

  test('renders invalid state when token is whitespace-only', () => {
    renderReset('/reset-password?token=%20%20')
    expect(screen.getByTestId('reset-password-invalid')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
  })

  test('submits token + newPassword to API + navigates to /login?reset=1 on 200', async () => {
    const user = userEvent.setup()
    const requestBodies: unknown[] = []
    server.use(
      http.post('/api/auth/reset-password', async ({ request }) => {
        requestBodies.push(await request.json())
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    await screen.findByTestId('login-reached')
    expect(requestBodies).toEqual([
      { token: 'abc123', newPassword: 'newStrong123' },
    ])
  })

  test('confirm password mismatch shows inline field error + does NOT submit', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/reset-password', () => {
        requestCount++
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'differentPwd',
    })
    await screen.findByText(
      i18n.t('auth.resetPassword.error.passwordMismatch'),
    )
    expect(requestCount).toBe(0)
  })

  test('stale-refine ATDD specimen — editing newPassword after both fields validate re-fires the mismatch refine on submit', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/reset-password', () => {
        requestCount++
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    // First pass — both fields match, both blur, form is valid.
    await user.type(screen.getByTestId('reset-new-password'), 'Hunter2!!')
    await user.tab()
    await user.type(
      screen.getByTestId('reset-confirm-password'),
      'Hunter2!!',
    )
    await user.tab()
    // Edit newPassword (keystroke, no blur after).
    await user.type(screen.getByTestId('reset-new-password'), '3')
    await user.click(screen.getByTestId('reset-submit'))
    // Refine re-fires on the keystroke; submit short-circuits.
    await screen.findByText(
      i18n.t('auth.resetPassword.error.passwordMismatch'),
    )
    expect(requestCount).toBe(0)
  })

  test('email-leak rejection ratchet — ?email= URL param is silently ignored, password fields stay empty, email never displayed, URL stripped', async () => {
    renderReset('/reset-password?token=abc&email=leak@example.com')
    expect(screen.queryByDisplayValue('leak@example.com')).toBeNull()
    expect(
      screen.queryByText(/leak@example\.com/),
    ).toBeNull()
    const newPassword = screen.getByTestId(
      'reset-new-password',
    ) as HTMLInputElement
    const confirmPassword = screen.getByTestId(
      'reset-confirm-password',
    ) as HTMLInputElement
    expect(newPassword.value).toBe('')
    expect(confirmPassword.value).toBe('')
    // The page also strips `?email=` from the URL on mount so the
    // email doesn't leak via browser history, analytics URL fields,
    // screen-shares, or browser-session sync. Probe via the search
    // probe rendered alongside the page ([Review][Patch] P5 —
    // code-review 2026-06-26).
    await waitFor(() => {
      expect(screen.getByTestId('reset-url-email-param').textContent).toBe('')
    })
    // The token, by contrast, MUST survive — the form needs it for
    // the submit. Locking that here so a future over-eager strip
    // doesn't also remove the token.
    expect(screen.getByTestId('reset-url-token-param').textContent).toBe(
      'abc',
    )
  })

  test('password too short shows passwordMin error + does NOT submit', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/reset-password', () => {
        requestCount++
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'short',
      confirmPassword: 'short',
    })
    await screen.findByText(i18n.t('auth.common.validation.passwordMin'))
    expect(requestCount).toBe(0)
  })

  test('password all whitespace shows passwordNotBlank error + does NOT submit', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/reset-password', () => {
        requestCount++
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: '         ',
      confirmPassword: '         ',
    })
    await screen.findByText(i18n.t('auth.common.validation.passwordNotBlank'))
    expect(requestCount).toBe(0)
  })

  test('submit is disabled while mutation is pending', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return HttpResponse.json({ data: { reset: true } }, { status: 200 })
      }),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    expect(
      (screen.getByTestId('reset-submit') as HTMLButtonElement).disabled,
    ).toBe(true)
    await screen.findByTestId('login-reached')
  })

  test('PasswordStrengthBar updates as user types', async () => {
    const user = userEvent.setup()
    renderReset('/reset-password?token=abc123')
    const password = screen.getByTestId('reset-new-password')
    await user.type(password, 'a')
    // Weak: single char → score 1.
    await waitFor(() => {
      expect(
        screen.getByTestId('password-strength-announcement').textContent,
      ).toBe(i18n.t('auth.common.passwordStrength.weak'))
    })
    // Reach the 4-point "very strong" tier — needs length ≥ 12 plus all
    // three character-class probes (mixed case, digit, symbol).
    await user.type(password, 'bcDEF123!XYZ')
    await waitFor(() => {
      expect(
        screen.getByTestId('password-strength-announcement').textContent,
      ).toBe(i18n.t('auth.common.passwordStrength.veryStrong'))
    })
  })

  test('renders expired state on 410 + clicking CTA navigates to /forgot-password', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_EXPIRED',
              message: 'expired',
              details: null,
            },
          },
          { status: 410 },
        ),
      ),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    await screen.findByTestId('reset-password-expired')
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
    expect(screen.queryByTestId('reset-password-consumed')).toBeNull()
    expect(screen.queryByTestId('reset-password-invalid')).toBeNull()
    await user.click(screen.getByTestId('reset-expired-cta'))
    await screen.findByTestId('forgot-password-reached')
  })

  test('renders consumed state on 409 + login CTA navigates to /login', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_CONSUMED',
              message: 'consumed',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    await screen.findByTestId('reset-password-consumed')
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
    expect(screen.queryByTestId('reset-password-expired')).toBeNull()
    expect(screen.queryByTestId('reset-password-invalid')).toBeNull()
    await user.click(screen.getByTestId('reset-consumed-cta'))
    await screen.findByTestId('login-reached')
  })

  test('renders invalid state on 404', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_INVALID',
              message: 'invalid',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    await screen.findByTestId('reset-password-invalid')
    expect(screen.queryByTestId('reset-password-form')).toBeNull()
    expect(screen.queryByTestId('reset-password-expired')).toBeNull()
    expect(screen.queryByTestId('reset-password-consumed')).toBeNull()
  })

  test('renders generic alert on 422 + form stays on input mode', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'invalid',
              details: null,
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    const alert = await screen.findByTestId('reset-error-alert')
    expect(alert.textContent).toBe(i18n.t('auth.resetPassword.error.generic'))
    expect(screen.getByTestId('reset-password-form')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-expired')).toBeNull()
    expect(screen.queryByTestId('reset-password-consumed')).toBeNull()
    expect(screen.queryByTestId('reset-password-invalid')).toBeNull()
  })

  test('renders generic alert on 5xx + form stays on input mode', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'oops', details: null } },
          { status: 500 },
        ),
      ),
    )
    renderReset('/reset-password?token=abc123')
    await fillAndSubmit(user, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    const alert = await screen.findByTestId('reset-error-alert')
    expect(alert.textContent).toBe(i18n.t('auth.resetPassword.error.generic'))
    expect(screen.getByTestId('reset-password-form')).toBeTruthy()
    expect(screen.queryByTestId('reset-password-expired')).toBeNull()
    expect(screen.queryByTestId('reset-password-consumed')).toBeNull()
    expect(screen.queryByTestId('reset-password-invalid')).toBeNull()
  })
})
