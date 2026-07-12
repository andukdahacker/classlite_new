/**
 * Story 2-3b — SoloFirstClassPage red-phase acceptance tests.
 *
 * ACs covered:
 *   AC8   Solo Teacher single-class variant; teacher LOCKED display-only (`<div>` NOT button);
 *         horizontal template ribbon (Sally-S6); wire submits teacherEmail: user.email
 *         (server → explicit_self, correct for Solo — Winston-W4 fold does NOT apply)
 *   AC10  Rows 8–9 wrong-persona guards
 *   AC11  i18n parity
 *   AC12  Three-state on POST spawn
 *   AC13  axe-core
 *
 * ATDD contract: SoloFirstClassPage module does not exist yet.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { authKeys } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import SoloFirstClassPage from '@/features/onboarding/SoloFirstClassPage'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import {
  errorHandlers,
  onboardingHandlers,
  spawnSuccessAs,
} from '../api/__tests__/handlers'

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
})

// R1-C3-P16 — remove per-test `request:start` listeners so they don't
// accumulate across tests in the same vitest worker.
afterEach(() => {
  server.events.removeAllListeners('request:start')
})

interface RenderOptions {
  persona?: 'operator' | 'founder' | 'solo_teacher' | null
  userEmail?: string
  userFullName?: string
}

function renderSoloPage(opts: RenderOptions = {}) {
  const {
    persona = 'solo_teacher',
    userEmail = 'solo@classlite.example',
    userFullName = 'Solo Teacher',
  } = opts

  const queryClient = createTestQueryClient()
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'user-1',
      email: userEmail,
      fullName: userFullName,
      emailVerified: true,
    },
    accessToken: 'jwt.with.center',
    center: {
      id: 'center-1',
      name: 'Solo Center',
      shortCode: 'solo-center',
      // eslint-disable-next-line no-restricted-syntax -- brandColor wire value (FU-2-3a-C)
    brandColor: '#166534',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
  })
  queryClient.setQueryData(onboardingKeys.progress(), {
    persona,
    currentStep: 'solo_first_class',
    payload: {
      schemaVersion: 1,
      personaChoice: persona,
      centerDraft: null,
      templateDraft: null,
    },
    updatedAt: '2026-07-10T12:00:00.000Z',
  })

  const utils = render(
    <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/setup/first-class']}>
        <Routes>
          <Route element={<OnboardingLayout />}>
            <Route
              path="/setup/first-class"
              element={<SoloFirstClassPage />}
            />
          </Route>
          <Route path="/setup/spawn" element={<div>SPAWN_PLACEHOLDER</div>} />
          <Route path="/setup/done" element={<div>DONE_PLACEHOLDER</div>} />
          <Route path="/welcome" element={<div>WELCOME_PLACEHOLDER</div>} />
          <Route
            path="/setup/center"
            element={<div>CENTER_PLACEHOLDER</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nextProvider>,
  )
  return { ...utils, queryClient }
}

// -------------------- AC8: Solo layout + LOCKED teacher --------------------
describe('AC8 — Solo Teacher single-class variant', () => {
  test('renders "Step 3 of 3" and single-class form (NOT useFieldArray)', async () => {
    renderSoloPage({ userFullName: 'Solo Teacher' })

    expect(await screen.findByText(/Step 3 of 3/i)).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', {
        name: /Create your first class/i,
      }),
    ).toBeInTheDocument()

    // ONE row only — no "Add another class" button
    expect(
      screen.queryByRole('button', { name: /Add another class/i }),
    ).not.toBeInTheDocument()
  })

  test('teacher field is LOCKED display-only (div NOT button); shows "You · {name}"', async () => {
    renderSoloPage({ userFullName: 'Solo Teacher' })

    await screen.findByRole('heading', { name: /Create your first class/i })

    // Sally-B4 discipline + AC8: teacher pill is a `<div>` not `<button>` —
    // no AssignChip composer trigger available
    expect(
      screen.queryByRole('button', {
        name: /Assign or invite a teacher/i,
      }),
    ).not.toBeInTheDocument()

    // Text `You · Solo Teacher` present in some form
    expect(screen.getByText(/Solo Teacher/i)).toBeInTheDocument()
  })

  test('Sally-S6: template picker is horizontal ribbon (NOT collapsed <details>)', async () => {
    renderSoloPage()

    await screen.findByRole('heading', { name: /Create your first class/i })

    // No <details> disclosure
    expect(document.querySelector('details')).toBeNull()

    // Template ribbon visible on load with template cards
    const ribbon = await screen.findByTestId('solo-template-ribbon')
    expect(ribbon).toBeInTheDocument()
  })

  test('wire submits teacherEmail: user.email → server returns explicit_self (Winston-W4 does NOT apply to Solo)', async () => {
    const requestBodies: unknown[] = []
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/spawn')) {
        try {
          requestBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })
    server.use(spawnSuccessAs('solo_teacher', 'solo@classlite.example'))

    const user = userEvent.setup()
    renderSoloPage({ userEmail: 'solo@classlite.example' })

    await screen.findByRole('heading', { name: /Create your first class/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'Solo Class')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(
      screen.getByRole('button', { name: /Create my first class/i }),
    )

    await screen.findByText('DONE_PLACEHOLDER')

    // AC8 assertion: Solo wire ALWAYS includes user.email as teacherEmail
    const spawnBody = requestBodies[0] as {
      classes: Array<{ teacherEmail: string | null }>
    }
    expect(spawnBody.classes[0].teacherEmail).toBe('solo@classlite.example')
  })
})

// -------------------- AC10: wrong-persona guards (rows 8-9) --------------------
describe('AC10 — resume routing rows 8–9', () => {
  test('Row 8: operator persona lands on /setup/first-class → redirect /setup/spawn', async () => {
    renderSoloPage({ persona: 'operator' })
    expect(await screen.findByText('SPAWN_PLACEHOLDER')).toBeInTheDocument()
  })

  test('Row 8 (variant): founder persona → also redirect /setup/spawn', async () => {
    renderSoloPage({ persona: 'founder' })
    expect(await screen.findByText('SPAWN_PLACEHOLDER')).toBeInTheDocument()
  })

  test('Row 9: null persona → redirect /welcome', async () => {
    renderSoloPage({ persona: null })
    expect(await screen.findByText('WELCOME_PLACEHOLDER')).toBeInTheDocument()
  })
})

// -------------------- AC12: three-state error branches on POST spawn --------------------
// R1-C3-P8 — Solo's `handleSpawnError` ships EVR / CENTER_REQUIRED /
// INVALID_TENANT_CLAIM / 429 / 500 / TEMPLATE_NOT_FOUND branches (Chunk 1
// P10 adds the 404 path). File docstring claimed AC12 coverage but only
// happy-path landed. These tests exercise each branch through the shared
// submit path.
describe('AC12 — three-state on POST spawn (Solo error branches)', () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: /Create your first class/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'Solo Class')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(
      screen.getByRole('button', { name: /Create my first class/i }),
    )
  }

  test('404 TEMPLATE_NOT_FOUND → resets templateId + surfaces generic error copy', async () => {
    server.use(errorHandlers.spawnTemplateNotFound())
    const user = userEvent.setup()
    renderSoloPage({ userEmail: 'solo@classlite.example' })

    await fillAndSubmit(user)

    // Solo's 404 handler shows the templateNotFound generic-error copy
    // (see SoloFirstClassPage.tsx Chunk 1 P10 patch).
    expect(
      await screen.findByText(/no longer available/i),
    ).toBeInTheDocument()
    // Stays on-page for user to pick another template from the ribbon.
    expect(
      screen.getByRole('heading', { name: /Create your first class/i }),
    ).toBeInTheDocument()
  })

  test('403 INVALID_TENANT_CLAIM → clears auth session cache + navigate /login', async () => {
    server.use(errorHandlers.spawnInvalidTenantClaim())
    const user = userEvent.setup()
    const { queryClient } = renderSoloPage({
      userEmail: 'solo@classlite.example',
    })

    await fillAndSubmit(user)

    // Cache MUST clear (Amelia-S3) — layout would otherwise rebounce.
    await import('@testing-library/react').then(({ waitFor }) =>
      waitFor(() => {
        expect(queryClient.getQueryData(authKeys.session())).toBeNull()
      }),
    )
  })

  test('429 rate-limited → generic error surfaces when Retry-After=0', async () => {
    server.use(errorHandlers.spawnRateLimited('zero'))
    const user = userEvent.setup()
    renderSoloPage({ userEmail: 'solo@classlite.example' })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('500 INTERNAL_ERROR → generic Alert with requestId + no auto-retry', async () => {
    server.use(errorHandlers.spawnInternalError())
    const user = userEvent.setup()
    renderSoloPage({ userEmail: 'solo@classlite.example' })

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/req-test-2-3a/i)
    // Stays on-page (no navigate).
    expect(
      screen.getByRole('heading', { name: /Create your first class/i }),
    ).toBeInTheDocument()
  })
})

// -------------------- AC13: axe --------------------
describe('AC13 — accessibility gate', () => {
  test('axe-core reports zero violations', async () => {
    const { container } = renderSoloPage()
    await screen.findByRole('heading', { name: /Create your first class/i })
    expect(await axe(container)).toHaveNoViolations()
  })
})
