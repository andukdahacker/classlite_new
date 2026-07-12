/**
 * PersonaSelectPage — Story 2-3a AC1, AC2, AC3, AC10, AC13, AC14.
 *
 * Red-phase specimens covering:
 *  - AC1: zero-selection on first paint, roving-tabindex, Continue disabled (Sally-B1)
 *  - AC2: radio-group semantics + arrow-key nav + aria-checked
 *  - AC3: Continue sequence POST persona → PUT progress → navigate; 5 error branches
 *  - AC10: resume-routing decision table (5 rows)
 *  - AC13: three-state on GET progress
 *  - AC14: axe zero violations + aria-hidden SVGs + aria-label per card
 *
 * RED phase: @/features/onboarding/PersonaSelectPage doesn't exist yet.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import PersonaSelectPage from '@/features/onboarding/PersonaSelectPage'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import {
  onboardingHandlers,
  errorHandlers,
} from '@/features/onboarding/api/__tests__/handlers'

function seedAuthedNoCenter(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: {
      id: 'user-1',
      email: 'trang@example.com',
      fullName: 'Trang',
      emailVerified: true,
    } as unknown as Session['user'],
    accessToken: 'a.b.c',
    center: null,
  })
}

function renderWizard(
  client: QueryClient = createTestQueryClient(),
  initialPath = '/welcome',
): { client: QueryClient; user: ReturnType<typeof userEvent.setup> } {
  seedAuthedNoCenter(client)
  const user = userEvent.setup()
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route path="/welcome" element={<PersonaSelectPage />} />
              <Route
                path="/setup/center"
                element={<p>setup-center reached</p>}
              />
              <Route
                path="/setup/template"
                element={<p>setup-template reached</p>}
              />
              <Route
                path="/setup/first-class"
                element={<p>setup-first-class reached</p>}
              />
            </Route>
            <Route path="/dashboard" element={<p>dashboard reached</p>} />
            <Route path="/verify-email" element={<p>verify-email</p>} />
            <Route path="/login" element={<p>login</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  render(shell)
  return { client, user }
}

beforeEach(() => {
  server.use(...onboardingHandlers)
})

afterEach(() => {
  // resetHandlers handled globally
})

describe('PersonaSelectPage — AC1 shell + zero-selection', () => {
  test('renders three persona cards with SVG illustrations aria-hidden', async () => {
    renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    const svgs = document.querySelectorAll('svg[aria-hidden="true"]')
    expect(svgs.length).toBeGreaterThanOrEqual(3)
  })

  test('AC1 Sally-B1: NO persona is aria-checked on first paint (zero-selection)', async () => {
    renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    const checked = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(0)
  })

  test('AC1: Continue button is disabled until a selection exists', async () => {
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    const cta = screen.getByRole('button', {
      name: i18n.t('onboarding.persona.continueCta'),
    })
    expect(cta).toBeDisabled()

    // Click a card
    await user.click(screen.getAllByRole('radio')[0])
    expect(cta).toBeEnabled()
  })
})

describe('PersonaSelectPage — AC2 keyboard nav', () => {
  test('arrow-key nav cycles selection through cards; aria-checked reflects', async () => {
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    const radios = screen.getAllByRole('radio')

    await user.click(radios[0])
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowRight}')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')

    await user.keyboard('{ArrowRight}')
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
  })
})

describe('PersonaSelectPage — AC3 Continue → POST persona + PUT progress + navigate', () => {
  test('happy path lands on /setup/center', async () => {
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )

    await user.click(screen.getAllByRole('radio')[0])
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.persona.continueCta'),
      }),
    )

    await waitFor(() =>
      expect(screen.getByText('setup-center reached')).toBeInTheDocument(),
    )
  })

  test('403 EMAIL_VERIFICATION_REQUIRED renders inline alert with verify link', async () => {
    server.use(errorHandlers.personaEmailVerificationRequired())
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )

    await user.click(screen.getAllByRole('radio')[0])
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.persona.continueCta'),
      }),
    )

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('link', { name: /verify-email/i }),
    ).toBeInTheDocument()
  })

  test('429 RATE_LIMIT_EXCEEDED renders rateLimited copy with seconds interpolated', async () => {
    server.use(errorHandlers.personaRateLimited(45))
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )

    await user.click(screen.getAllByRole('radio')[0])
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.persona.continueCta'),
      }),
    )

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/45/),
    )
  })

  test('500 INTERNAL_ERROR renders generic alert, no navigation', async () => {
    server.use(errorHandlers.personaInternalError())
    const { user } = renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )

    await user.click(screen.getAllByRole('radio')[0])
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.persona.continueCta'),
      }),
    )

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    )
    expect(
      screen.queryByText('setup-center reached'),
    ).not.toBeInTheDocument()
  })
})

describe('PersonaSelectPage — AC10 resume-routing decision table', () => {
  test('progress currentStep=done → /dashboard', async () => {
    server.use(errorHandlers.progressWithPersona('operator', 'done'))
    renderWizard()
    await waitFor(() =>
      expect(screen.getByText('dashboard reached')).toBeInTheDocument(),
    )
  })

  test('progress currentStep=template → /setup/template', async () => {
    server.use(errorHandlers.progressWithPersona('operator', 'template'))
    renderWizard()
    await waitFor(() =>
      expect(
        screen.getByText('setup-template reached'),
      ).toBeInTheDocument(),
    )
  })

  test('progress currentStep=center → /setup/center', async () => {
    server.use(errorHandlers.progressWithPersona('operator', 'center'))
    renderWizard()
    await waitFor(() =>
      expect(screen.getByText('setup-center reached')).toBeInTheDocument(),
    )
  })

  test('progress persona=founder + currentStep=persona → stays on /welcome with founder pre-selected', async () => {
    server.use(errorHandlers.progressWithPersona('founder', 'persona'))
    renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    // Founder is the 2nd card by convention (Operator/Founder/Solo).
    const radios = screen.getAllByRole('radio')
    const founderChecked = radios.some(
      (el) =>
        el.getAttribute('aria-checked') === 'true' &&
        el
          .getAttribute('aria-label')
          ?.toLowerCase()
          .includes(i18n.t('onboarding.persona.founder.title').toLowerCase()),
    )
    expect(founderChecked).toBe(true)
  })

  test('progress persona=null → stays on /welcome with zero-selection', async () => {
    // Default handler returns persona: null + currentStep: 'persona' — the shell state.
    renderWizard()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    const checked = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(0)
  })

  // R1-C3-P13 — Amelia-B3 amendment: Solo Teacher persona resuming with an
  // ADVANCED currentStep (template / spawn / solo_first_class) routes
  // DIRECTLY to `/setup/first-class`, NOT `/setup/template`. Prior to the
  // amendment, the shipped 2-3a resume effect hardcoded `/setup/template`
  // for all personas — a Solo Teacher would double-redirect via `/welcome
  // → /setup/template → /setup/first-class`. This test protects the
  // single-navigate path per the persona-branch dispatch.
  //
  // Note: Solo + currentStep=center is handled separately (routes to
  // /setup/center — the user hasn't finished center setup yet). The
  // amendment covers the advanced steps.
  test('Amelia-B3 — persona=solo_teacher + currentStep=solo_first_class → routes to /setup/first-class (single navigate)', async () => {
    server.use(
      errorHandlers.progressWithPersona('solo_teacher', 'solo_first_class'),
    )
    renderWizard()
    await waitFor(() =>
      expect(
        screen.getByText('setup-first-class reached'),
      ).toBeInTheDocument(),
    )
    // Solo MUST NOT touch /setup/template on the way — no intermediate render.
    expect(
      screen.queryByText('setup-template reached'),
    ).not.toBeInTheDocument()
  })

  test('Amelia-B3 — persona=solo_teacher + currentStep=spawn → routes to /setup/first-class', async () => {
    server.use(
      errorHandlers.progressWithPersona('solo_teacher', 'spawn'),
    )
    renderWizard()
    await waitFor(() =>
      expect(
        screen.getByText('setup-first-class reached'),
      ).toBeInTheDocument(),
    )
    // Guard: no /setup/template flash for Solo Teacher.
    expect(
      screen.queryByText('setup-template reached'),
    ).not.toBeInTheDocument()
  })
})

describe('PersonaSelectPage — AC13 three-state on GET progress', () => {
  test('renders skeleton while GET progress is loading', async () => {
    // MSW default handler is synchronous fast — mock a slow response.
    let resolve: (() => void) | undefined
    server.use(
      (await import('msw')).http.get('/api/onboarding/progress', async () => {
        await new Promise<void>((r) => {
          resolve = r
        })
        return (await import('msw')).HttpResponse.json({
          data: {
            persona: null,
            currentStep: 'persona',
            payload: null,
            updatedAt: null,
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    renderWizard()
    // Skeleton container is present.
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="skeleton-onboarding"]'),
      ).toBeInTheDocument(),
    )
    resolve?.()
  })

  test('renders error alert when GET progress fails', async () => {
    server.use(errorHandlers.progressInternalError())
    renderWizard()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    )
  })
})

describe('PersonaSelectPage — AC14 accessibility', () => {
  test('zero axe violations on default render', async () => {
    const { container } = (() => {
      const client = createTestQueryClient()
      seedAuthedNoCenter(client)
      return render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/welcome']}>
              <Routes>
                <Route element={<OnboardingLayout />}>
                  <Route path="/welcome" element={<PersonaSelectPage />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>,
      )
    })()
    await waitFor(() =>
      expect(screen.getAllByRole('radio')).toHaveLength(3),
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
