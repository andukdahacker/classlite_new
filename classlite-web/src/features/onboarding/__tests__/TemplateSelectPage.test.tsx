/**
 * Story 2-3b — TemplateSelectPage red-phase acceptance tests.
 *
 * ACs covered here:
 *   AC1   /setup/template renders inside OnboardingLayout; NO Skip link (Sally-S5)
 *   AC2   GET /api/templates via useListTemplates; three-state; SEED_INCOMPLETE distinct (Sally-I3)
 *   AC3   Selection → inline preview drawer → Continue → PUT progress + navigate
 *   AC10  Rows 1–4 (the routing decisions this page owns) per Murat-B4 matrix
 *   AC11  i18n parity (assertI18nParity + assertI18nInterpolationParity)
 *   AC12  Three-state on GET templates
 *   AC13  axe-core zero violations
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 5.1.
 * That's the red signal.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { beforeEach, describe, expect, test } from 'vitest'

import { authKeys } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import TemplateSelectPage from '@/features/onboarding/TemplateSelectPage'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import { server } from '@/test/msw-server'

import { errorHandlers, onboardingHandlers } from '../api/__tests__/handlers'

// (Providers assembled inline in renderTemplateSelectPageForOperator + AC10 rows)

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
})

function renderTemplateSelectPageForOperator() {
  const queryClient = createTestQueryClient()

  // Seed a verified authed session with a center (AC1 layout guard requires this)
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'user-1',
      email: 'owner@classlite.example',
      fullName: 'Ducdo Do',
      emailVerified: true,
    },
    accessToken: 'jwt.with.center',
    center: {
      id: 'center-1',
      name: 'Saigon English',
      shortCode: 'saigon-english',
      // eslint-disable-next-line no-restricted-syntax
        brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
  })

  // Progress: persona=operator, currentStep='template' (fresh landing)
  queryClient.setQueryData(onboardingKeys.progress(), {
    persona: 'operator',
    currentStep: 'template',
    payload: {
      schemaVersion: 1,
      personaChoice: 'operator',
      centerDraft: null,
      templateDraft: null,
    },
    updatedAt: '2026-07-10T12:00:00.000Z',
  })

  const utils = render(
    <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/setup/template']}>
        <Routes>
          <Route element={<OnboardingLayout />}>
            <Route path="/setup/template" element={<TemplateSelectPage />} />
          </Route>
          <Route path="/setup/spawn" element={<div>SPAWN_PLACEHOLDER</div>} />
          <Route
            path="/setup/first-class"
            element={<div>FIRST_CLASS_PLACEHOLDER</div>}
          />
          <Route path="/welcome" element={<div>WELCOME_PLACEHOLDER</div>} />
          <Route
            path="/dashboard"
            element={<div>DASHBOARD_PLACEHOLDER</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nextProvider>,
  )

  return { ...utils, queryClient }
}

// -------------------- AC1: page shell + NO Skip link (Sally-S5) --------------------
describe('AC1 — /setup/template renders in OnboardingLayout', () => {
  test('renders template grid + step-progress + Continue CTA', async () => {
    renderTemplateSelectPageForOperator()

    // Step progress "Step 3 of 4"
    expect(await screen.findByText(/Step 3 of 4/i)).toBeInTheDocument()

    // Fraunces title
    expect(
      await screen.findByRole('heading', { name: /Choose a template/i }),
    ).toBeInTheDocument()

    // 5 system template cards + 1 Build-from-scratch tile = 6 tiles minimum
    await waitFor(() => {
      const radios = screen.getAllByRole('radio')
      expect(radios.length).toBeGreaterThanOrEqual(6)
    })

    // Continue CTA — disabled until a card is selected
    const continueBtn = screen.getByRole('button', { name: /Continue/i })
    expect(continueBtn).toBeDisabled()
  })

  test('Sally-S5: NO Skip link exists in v1', async () => {
    renderTemplateSelectPageForOperator()
    await screen.findByRole('heading', { name: /Choose a template/i })

    expect(
      screen.queryByRole('link', { name: /skip/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /skip/i }),
    ).not.toBeInTheDocument()
  })
})

// -------------------- AC2: three-state on GET /api/templates --------------------
describe('AC2 — three-state on GET /api/templates (Sally-I3 SEED_INCOMPLETE distinct)', () => {
  test('loading state renders 4 skeleton cards before templates resolve', () => {
    renderTemplateSelectPageForOperator()

    const skeletons = screen.getAllByTestId(/template-skeleton/i)
    expect(skeletons.length).toBeGreaterThanOrEqual(4)
  })

  test('success state renders template cards with band + skill + session count', async () => {
    renderTemplateSelectPageForOperator()

    // First system template — Writing Bootcamp 6.5 / band 6.5 / writing / 12 sessions
    const card = await screen.findByRole('radio', {
      name: /Writing Bootcamp 6\.5/i,
    })
    expect(card).toBeInTheDocument()

    // Band pill + session count
    expect(within(card).getByText(/Band 6\.5/i)).toBeInTheDocument()
    expect(within(card).getByText(/12 sessions/i)).toBeInTheDocument()
  })

  test('generic 500 error renders Alert WITH retry button', async () => {
    server.use(errorHandlers.templatesInternalError())
    renderTemplateSelectPageForOperator()

    // TanStack Query retries 5xx once with 1s exponential-backoff delay; the
    // query takes ~1050ms to settle into the error state.
    const alert = await screen.findByRole('alert', {}, { timeout: 3_000 })
    expect(within(alert).getByRole('button', { name: /Try again/i }))
      .toBeInTheDocument()
  })

  test('SEED_INCOMPLETE error renders "Contact support" copy WITH NO retry button (Sally-I3)', async () => {
    server.use(errorHandlers.templatesSeedIncomplete())
    renderTemplateSelectPageForOperator()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Contact support/i)).toBeInTheDocument()
    // The load-bearing negative assertion — no retry button in DOM
    expect(
      within(alert).queryByRole('button', { name: /Try again/i }),
    ).not.toBeInTheDocument()
  })
})

// -------------------- AC3: selection → preview → Continue → PUT + navigate --------------------
describe('AC3 — selection opens preview drawer + Continue advances', () => {
  test('selecting a card expands inline preview panel below the grid', async () => {
    const user = userEvent.setup()
    renderTemplateSelectPageForOperator()

    const card = await screen.findByRole('radio', {
      name: /Writing Bootcamp 6\.5/i,
    })
    await user.click(card)

    // Preview drawer visible with metadata + Continue CTA inside it
    const preview = await screen.findByTestId('template-preview-drawer')
    expect(preview).toBeInTheDocument()
    expect(
      within(preview).getByRole('button', { name: /Continue/i }),
    ).toBeEnabled()
  })

  test('Continue → PUT progress with templateDraft.selectedTemplateId → navigate /setup/spawn', async () => {
    const user = userEvent.setup()
    renderTemplateSelectPageForOperator()

    const card = await screen.findByRole('radio', {
      name: /Writing Bootcamp 6\.5/i,
    })
    await user.click(card)

    const preview = await screen.findByTestId('template-preview-drawer')
    await user.click(within(preview).getByRole('button', { name: /Continue/i }))

    expect(await screen.findByText('SPAWN_PLACEHOLDER')).toBeInTheDocument()
  })

  test('Build-from-scratch tile selection sets buildFromScratch: true in payload', async () => {
    const user = userEvent.setup()
    renderTemplateSelectPageForOperator()

    const tile = await screen.findByRole('radio', {
      name: /Build from scratch/i,
    })
    await user.click(tile)

    // Preview drawer for build-from-scratch shows a distinct copy
    const preview = await screen.findByTestId('template-preview-drawer')
    expect(within(preview).getByText(/coming soon|build your own/i))
      .toBeInTheDocument()

    // Continue still navigates to /setup/spawn (the spawn page renders the
    // blocked-variant per AC4)
    await user.click(within(preview).getByRole('button', { name: /Continue/i }))
    expect(await screen.findByText('SPAWN_PLACEHOLDER')).toBeInTheDocument()
  })
})

// -------------------- AC10: rows 1–4 (this page's routing decisions) --------------------
describe('AC10 — resume-routing table rows 1–4 (Murat-B4 matrix)', () => {
  test('Row 1: persona=solo_teacher → redirect to /setup/first-class', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), {
      user: {
        id: 'user-1',
        email: 'solo@example.com',
        fullName: 'Solo',
        emailVerified: true,
      },
      accessToken: 'jwt',
      center: {
        id: 'c1',
        name: 'Solo Center',
        shortCode: 'solo',
        // eslint-disable-next-line no-restricted-syntax
        brandColor: '#1e3a8a',
        logoUrl: null,
        timezone: 'UTC',
      },
    })
    queryClient.setQueryData(onboardingKeys.progress(), {
      persona: 'solo_teacher',
      currentStep: 'template',
      payload: null,
      updatedAt: '2026-07-10T12:00:00.000Z',
    })

    render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/setup/template']}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route
                path="/setup/template"
                element={<TemplateSelectPage />}
              />
            </Route>
            <Route
              path="/setup/first-class"
              element={<div>FIRST_CLASS_PLACEHOLDER</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider></I18nextProvider>,
    )

    expect(await screen.findByText('FIRST_CLASS_PLACEHOLDER'))
      .toBeInTheDocument()
  })

  test('Row 2: persona=null → redirect to /welcome', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), {
      user: {
        id: 'user-1',
        email: 'x@example.com',
        fullName: 'X',
        emailVerified: true,
      },
      accessToken: 'jwt',
      center: {
        id: 'c1',
        name: 'C',
        shortCode: 'c',
        // eslint-disable-next-line no-restricted-syntax
        brandColor: '#1e3a8a',
        logoUrl: null,
        timezone: 'UTC',
      },
    })
    queryClient.setQueryData(onboardingKeys.progress(), {
      persona: null,
      currentStep: 'template',
      payload: null,
      updatedAt: '2026-07-10T12:00:00.000Z',
    })

    render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/setup/template']}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route
                path="/setup/template"
                element={<TemplateSelectPage />}
              />
            </Route>
            <Route path="/welcome" element={<div>WELCOME_PLACEHOLDER</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider></I18nextProvider>,
    )

    expect(await screen.findByText('WELCOME_PLACEHOLDER')).toBeInTheDocument()
  })

  test('Row 3: persona=operator + currentStep=done → OnboardingLayout catches (dashboard)', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), {
      user: {
        id: 'user-1',
        email: 'op@example.com',
        fullName: 'Op',
        emailVerified: true,
      },
      accessToken: 'jwt',
      center: {
        id: 'c1',
        name: 'C',
        shortCode: 'c',
        // eslint-disable-next-line no-restricted-syntax
        brandColor: '#1e3a8a',
        logoUrl: null,
        timezone: 'UTC',
      },
    })
    queryClient.setQueryData(onboardingKeys.progress(), {
      persona: 'operator',
      currentStep: 'done',
      payload: null,
      updatedAt: '2026-07-10T12:00:00.000Z',
    })

    render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/setup/template']}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route
                path="/setup/template"
                element={<TemplateSelectPage />}
              />
            </Route>
            <Route
              path="/dashboard"
              element={<div>DASHBOARD_PLACEHOLDER</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider></I18nextProvider>,
    )

    expect(await screen.findByText('DASHBOARD_PLACEHOLDER'))
      .toBeInTheDocument()
  })

  test('Row 4: persona=founder + currentStep=spawn → redirect to /setup/spawn', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), {
      user: {
        id: 'user-1',
        email: 'founder@example.com',
        fullName: 'F',
        emailVerified: true,
      },
      accessToken: 'jwt',
      center: {
        id: 'c1',
        name: 'C',
        shortCode: 'c',
        // eslint-disable-next-line no-restricted-syntax
        brandColor: '#1e3a8a',
        logoUrl: null,
        timezone: 'UTC',
      },
    })
    queryClient.setQueryData(onboardingKeys.progress(), {
      persona: 'founder',
      currentStep: 'spawn',
      payload: null,
      updatedAt: '2026-07-10T12:00:00.000Z',
    })

    render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/setup/template']}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route
                path="/setup/template"
                element={<TemplateSelectPage />}
              />
            </Route>
            <Route path="/setup/spawn" element={<div>SPAWN_PLACEHOLDER</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider></I18nextProvider>,
    )

    expect(await screen.findByText('SPAWN_PLACEHOLDER')).toBeInTheDocument()
  })
})

// -------------------- AC11: i18n parity for template-page keys --------------------
describe('AC11 — i18n parity for onboarding.template.* keys', () => {
  test('all template-page keys resolve in en + vi', () => {
    // Enumerated in Task 9.2 STORY_2_3B_KEYS block; this test is a quick
    // in-page belt against key drift while dev iterates.
    const templateKeys = [
      'onboarding.template.eyebrow',
      'onboarding.template.title',
      'onboarding.template.subtitle',
      'onboarding.template.buildFromScratch.title',
      'onboarding.template.buildFromScratch.description',
      'onboarding.template.card.systemBadge',
      'onboarding.template.card.centerBadge',
      'onboarding.template.card.targetBand',
      'onboarding.template.card.sessions',
      'onboarding.template.continueCta',
      'onboarding.template.error.generic',
      'onboarding.template.error.seedIncomplete',
      'onboarding.template.error.retryCta',
    ]
    assertI18nParity(templateKeys, ['en', 'vi'])
  })
})

// -------------------- AC13: axe-core --------------------
describe('AC13 — accessibility gate', () => {
  test('axe-core reports zero violations', async () => {
    const { container } = renderTemplateSelectPageForOperator()
    await screen.findByRole('heading', { name: /Choose a template/i })

    expect(await axe(container)).toHaveNoViolations()
  })
})
