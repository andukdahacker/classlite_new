/**
 * RegisterPage — ≥10 tests per Story 1-8 AC3.
 */
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import RegisterPage from '@/features/auth/RegisterPage'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { Toaster } from '@/components/ui/sonner'

function renderRegister(client: QueryClient = createTestQueryClient()) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/register']}>
          <Toaster />
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<p>verify-email reached</p>} />
            <Route path="/login" element={<p>login</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(ui)
  return { client, container }
}

async function expandAndFill(
  user: ReturnType<typeof userEvent.setup>,
  values: {
    fullName?: string
    email?: string
    password?: string
  } = {},
) {
  await user.click(screen.getByTestId('collapsible-email-trigger'))
  if (values.fullName !== undefined) {
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.register.fullName') }),
      values.fullName,
    )
  }
  if (values.email !== undefined) {
    await user.type(
      screen.getByRole('textbox', { name: i18n.t('auth.common.email') }),
      values.email,
    )
  }
  if (values.password !== undefined) {
    await user.type(
      screen.getByLabelText(i18n.t('auth.common.password')),
      values.password,
    )
  }
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

describe('RegisterPage (Story 1-8 AC3)', () => {
  test('renders H1 from t("auth.register.title")', () => {
    renderRegister()
    expect(screen.getByTestId('register-heading').textContent).toBe(
      i18n.t('auth.register.title'),
    )
  })

  test('happy path: mutation isPending disables Google + submit (mutation-trilogy pinned test)', async () => {
    server.use(
      http.post('/api/auth/register', async () => {
        await new Promise((r) => setTimeout(r, 80))
        return HttpResponse.json(
          {
            data: {
              user: {
                id: 'u',
                email: 'a@a.com',
                fullName: 'A',
                emailVerified: false,
              },
              verifyPollId: 'poll-1',
              emailDelivery: 'sent',
            },
          },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()
    renderRegister()
    await expandAndFill(user, {
      fullName: 'Alice Tran',
      email: 'alice@example.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    await waitFor(() => {
      expect(
        (screen.getByTestId('register-submit') as HTMLButtonElement).disabled,
      ).toBe(true)
      expect(
        screen.getByTestId('google-oauth-cta').getAttribute('aria-disabled'),
      ).toBe('true')
    })
  })

  test('happy path: isSuccess populates session cache with accessToken=null and navigates to /verify-email (pinned test)', async () => {
    const user = userEvent.setup()
    const { client } = renderRegister()
    await expandAndFill(user, {
      fullName: 'Alice Tran',
      email: 'alice@example.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    await screen.findByText('verify-email reached')
    const cached = client.getQueryData(authKeys.session()) as {
      user: { emailVerified: boolean }
      accessToken: string | null
    }
    expect(cached.user.emailVerified).toBe(false)
    expect(cached.accessToken).toBeNull()
  })

  test('409 EMAIL_ALREADY_REGISTERED: setError on email field and force-expand collapsible (pinned test)', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'taken',
              details: null,
            },
          },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderRegister()
    await expandAndFill(user, {
      fullName: 'Dup',
      email: 'taken@example.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    await screen.findByText(i18n.t('auth.register.error.emailTaken'))
    // Collapsible remains expanded — Base UI Collapsible exposes the
    // open/closed contract via the trigger's aria-expanded; the panel
    // mounts only when open.
    expect(
      screen
        .getByTestId('collapsible-email-trigger')
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })

  test('422 VALIDATION_ERROR: iterates details[] and setError per field', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad',
              details: [
                { field: 'password', message: 'password is awful' },
                { field: 'email', message: 'email malformed' },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderRegister()
    await expandAndFill(user, {
      fullName: 'X',
      email: 'bad@a.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    await screen.findByText('password is awful')
    expect(screen.getByText('email malformed')).toBeTruthy()
  })

  test('429 RATE_LIMIT_EXCEEDED renders form-level rateLimited copy', async () => {
    server.use(
      http.post('/api/auth/register', () =>
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
    renderRegister()
    await expandAndFill(user, {
      fullName: 'Alice',
      email: 'a@a.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    const alert = await screen.findByTestId('register-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.register.error.rateLimited'))
  })

  test('generic 5xx error renders generic copy', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: { code: 'INTERNAL', message: 'oops', details: null },
          },
          { status: 500 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderRegister()
    await expandAndFill(user, {
      fullName: 'Alice',
      email: 'a@a.com',
      password: 'Password1$',
    })
    await user.click(screen.getByTestId('register-submit'))
    const alert = await screen.findByTestId('register-form-error')
    expect(alert.textContent).toBe(i18n.t('auth.register.error.generic'))
  })

  test('PasswordStrengthBar updates as the user types', async () => {
    const user = userEvent.setup()
    renderRegister()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.type(
      screen.getByLabelText(i18n.t('auth.common.password')),
      'abc',
    )
    expect(
      screen
        .getByTestId('password-strength-announcement')
        .textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.weak'))
    await user.type(
      screen.getByLabelText(i18n.t('auth.common.password')),
      'Password1$@xy',
    )
    expect(
      screen
        .getByTestId('password-strength-announcement')
        .textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.veryStrong'))
  })

  test('zod resolver inline messages — empty submit shows fullNameRequired in the locale', async () => {
    const user = userEvent.setup()
    renderRegister()
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    await user.click(screen.getByTestId('register-submit'))
    await screen.findByText(i18n.t('auth.common.validation.fullNameRequired'))
  })

  test('vitest-axe returns zero violations on collapsed state', async () => {
    const { container } = renderRegister()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('vitest-axe returns zero violations on expanded state with typed input', async () => {
    const user = userEvent.setup()
    const { container } = renderRegister()
    await expandAndFill(user, {
      fullName: 'Alice',
      email: 'a@a.com',
      password: 'Password1',
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})
