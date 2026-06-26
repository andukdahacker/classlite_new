/**
 * ForgotPasswordPage — Story 1-9b AC3 / AC4.
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test. i18n
 * keys resolved via the real en locale — never hardcoded English.
 *
 * Pinned contracts per AC3 + AC4:
 *   - Form mode on initial paint, sent region absent (TEST-FE-6).
 *   - Swap to sent confirmation on 200 with bolded submitted email.
 *   - Email field shows inline error on invalid format.
 *   - Submit disabled while mutation is pending.
 *   - Resend re-fires with deep-equal `{ email: submittedEmail }`
 *     (Murat tightened — full body, not just same-email field).
 *   - Anti-enum coupling regression guard — success swap fires
 *     identically regardless of response timing.
 *   - Typo-escape (wrong-email) reverts to form mode + clears + focuses.
 *   - 429 RATE_LIMIT_EXCEEDED renders rate-limited alert + disables submit.
 *   - 429 with missing Retry-After defaults to 60s.
 *   - 5xx + 422 render generic alert + form stays in input mode.
 */
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import ForgotPasswordPage from '@/features/auth/ForgotPasswordPage'
import { createTestQueryClient } from '@/lib/query-client'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

function renderForgot(client: QueryClient = createTestQueryClient()) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/forgot-password']}>
          <Routes>
            <Route
              path="/forgot-password"
              element={<ForgotPasswordPage />}
            />
            <Route
              path="/login"
              element={<p data-testid="login-reached">login</p>}
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
  email: string,
) {
  await user.type(screen.getByTestId('forgot-email-input'), email)
  await user.click(screen.getByTestId('forgot-submit'))
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ForgotPasswordPage (Story 1-9b AC3 / AC4)', () => {
  test('renders email form on initial paint', () => {
    renderForgot()
    expect(screen.getByTestId('forgot-password-form')).toBeTruthy()
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull()
    expect(screen.getByTestId('forgot-password-heading').textContent).toBe(
      i18n.t('auth.forgotPassword.title'),
    )
  })

  test('swaps to sent confirmation on 200 success with bolded submitted email', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/forgot-password', () => {
        requestCount++
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')

    await screen.findByTestId('forgot-password-sent')
    expect(screen.queryByTestId('forgot-password-form')).toBeNull()
    expect(screen.getByTestId('forgot-sent-email').textContent).toBe(
      'alice@example.com',
    )
    // Bolded inline via <strong>.
    const emailNode = screen.getByTestId('forgot-sent-email')
    expect(emailNode.tagName).toBe('STRONG')
    expect(requestCount).toBe(1)
  })

  test('email field shows inline error on invalid format and does NOT call the API', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/auth/forgot-password', () => {
        requestCount++
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    renderForgot()
    await user.type(screen.getByTestId('forgot-email-input'), 'not-an-email')
    await user.click(screen.getByTestId('forgot-submit'))
    await screen.findByText(i18n.t('auth.common.validation.emailFormat'))
    expect(requestCount).toBe(0)
  })

  test('submit is disabled while mutation is pending', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    renderForgot()
    await user.type(
      screen.getByTestId('forgot-email-input'),
      'alice@example.com',
    )
    await user.click(screen.getByTestId('forgot-submit'))
    expect(
      (screen.getByTestId('forgot-submit') as HTMLButtonElement).disabled,
    ).toBe(true)
    await screen.findByTestId('forgot-password-sent')
  })

  test('resend re-fires with deep-equal { email: submittedEmail } body and starts countdown', async () => {
    // Drive the 60s countdown to zero with fake timers so the resend
    // button enables; then verify the second request body deep-equals
    // `{ email: submittedEmail }`. Murat's spec-pinned contract
    // ([Review][Patch] P2 — code-review 2026-06-26).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const requestBodies: unknown[] = []
    server.use(
      http.post('/api/auth/forgot-password', async ({ request }) => {
        requestBodies.push(await request.json())
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    await screen.findByTestId('forgot-password-sent')

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toEqual({ email: 'alice@example.com' })

    // Tick the 60-second countdown to zero so the resend button
    // re-enables.
    await vi.advanceTimersByTimeAsync(60_000)
    const resendButton = screen.getByTestId(
      'forgot-resend-button',
    ) as HTMLButtonElement
    await waitFor(() => {
      expect(resendButton.disabled).toBe(false)
    })

    await user.click(resendButton)

    await waitFor(() => {
      expect(requestBodies).toHaveLength(2)
    })
    // Deep-equal of the SECOND request body — catches "fires
    // {email: 'a@b.com'} with wrong shape" regression.
    expect(requestBodies[1]).toEqual({ email: 'alice@example.com' })

    vi.useRealTimers()
  })

  test('anti-enum coupling regression guard — success swap fires identically regardless of response timing', async () => {
    const user1 = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    const first = renderForgot()
    await fillAndSubmit(user1, 'alice@example.com')
    await screen.findByTestId('forgot-password-sent')
    const fastShape = first.container.querySelector(
      '[data-testid="forgot-password-sent"]',
    )?.outerHTML
    first.container.remove()

    const user2 = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return HttpResponse.json({ data: { sent: true } }, { status: 200 })
      }),
    )
    const second = renderForgot()
    await fillAndSubmit(user2, 'alice@example.com')
    await screen.findByTestId('forgot-password-sent')
    const slowShape = second.container.querySelector(
      '[data-testid="forgot-password-sent"]',
    )?.outerHTML

    // Structural DOM identity after the swap settles.
    expect(slowShape).toBe(fastShape)
  })

  test('clicking wrong-email button reverts to form mode + clears form + focuses email input', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json({ data: { sent: true } }, { status: 200 }),
      ),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    await screen.findByTestId('forgot-password-sent')

    await user.click(screen.getByTestId('forgot-wrong-email'))
    await screen.findByTestId('forgot-password-form')
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull()
    const emailInput = screen.getByTestId('forgot-email-input') as HTMLInputElement
    await waitFor(() => {
      expect(document.activeElement).toBe(emailInput)
    })
    expect(emailInput.value).toBe('')
  })

  test('429 RATE_LIMIT_EXCEEDED renders rate-limited alert + disables submit for retryAfterSeconds', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '45' } },
        ),
      ),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    const alert = await screen.findByTestId('forgot-error-alert')
    expect(alert.textContent).toBe(
      i18n.t('auth.forgotPassword.error.rateLimited', { seconds: 45 }),
    )
    // Form stays in input mode.
    expect(screen.getByTestId('forgot-password-form')).toBeTruthy()
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull()
    // Submit is disabled while countdown is active.
    expect(
      (screen.getByTestId('forgot-submit') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  test('429 with missing Retry-After defaults to 60s', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests',
              details: null,
            },
          },
          { status: 429 },
        ),
      ),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    const alert = await screen.findByTestId('forgot-error-alert')
    expect(alert.textContent).toBe(
      i18n.t('auth.forgotPassword.error.rateLimited', { seconds: 60 }),
    )
  })

  test('5xx renders generic alert + form stays in input mode (TEST-FE-6 negative)', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'oops', details: null } },
          { status: 500 },
        ),
      ),
    )
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    const alert = await screen.findByTestId('forgot-error-alert')
    expect(alert.textContent).toBe(i18n.t('auth.forgotPassword.error.generic'))
    expect(screen.getByTestId('forgot-password-form')).toBeTruthy()
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull()
  })

  test('422 renders generic alert + form stays in input mode (TEST-FE-6 negative)', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () =>
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
    renderForgot()
    await fillAndSubmit(user, 'alice@example.com')
    const alert = await screen.findByTestId('forgot-error-alert')
    expect(alert.textContent).toBe(i18n.t('auth.forgotPassword.error.generic'))
    expect(screen.getByTestId('forgot-password-form')).toBeTruthy()
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull()
  })

  test('back-to-login footer link navigates to /login', async () => {
    const user = userEvent.setup()
    renderForgot()
    await user.click(screen.getByTestId('forgot-back-link'))
    await screen.findByTestId('login-reached')
  })
})
