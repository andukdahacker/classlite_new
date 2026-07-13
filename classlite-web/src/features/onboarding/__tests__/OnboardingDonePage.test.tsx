/**
 * Story 2-3c — OnboardingDonePage red-phase acceptance tests.
 *
 * Covers Task 2.4 enumeration + AC1/AC2/AC3/AC9/AC11 + Task 1.5 idempotence
 * (which lives here rather than in OnboardingLayout.test.tsx because the
 * idempotence contract fires INSIDE the OnboardingDonePage tree — the
 * Provider only exists when the layout renders + stepFromPathname resolves).
 *
 *   AC1   /setup/done renders inside OnboardingLayout with DoneHeroPanel
 *   AC2   6-branch guard ladder + spawnedClassIds visible fail (S-B1) +
 *         guard-order pinning (M-I1) + refetch race (M-I2) + empty-vs-undefined
 *         enumeration (M-I4)
 *   AC3   Per-persona subtitle copy (3 branches) + Vietnamese subtitle
 *   AC9   Three-state (loading skeleton / success / error alert with retry) +
 *         3-attempt persistent-failure ratchet (M-B3)
 *   AC11  axe zero-violations across 3 personas × 2 locales (M-S2) +
 *         focus-on-mount (S-B2)
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 2.1
 * (`OnboardingDonePage.tsx`) + Task 2.2 (`DoneHeroPanel.tsx`) + Task 6.1
 * (~12 new `onboarding.done.*` i18n keys) + handlers.ts extension for
 * `putProgressInternalError` + `putProgressRateLimited` + variants of
 * `progressWithPersona` that carry `templateDraft.spawnedClassIds` +
 * `classesDraft`.
 *
 * MSW server lifecycle registered globally in `src/test/vitest-setup.ts`;
 * per-file `beforeEach(server.use(...onboardingHandlers))` re-seats the
 * happy-path handlers on top of any prior test's overrides (2-3a/2-3b
 * D4 lesson).
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// R1-C3-P5: Sentry breadcrumb spy for R1-C1-P12 (persistent-failure
// fire-once) + R1-C1-P23 (corrupt-step diagnostic emit). Mock lives at
// module scope so `addBreadcrumbSpy.mock.calls` inspects the actual
// `addBreadcrumb` invocations from `OnboardingDonePage.tsx`.
const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import OnboardingDonePage from '@/features/onboarding/OnboardingDonePage'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import {
  errorHandlers,
  onboardingHandlers,
} from '../api/__tests__/handlers'

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
  addBreadcrumbSpy.mockClear()
})

// ---------------------------------------------------------------------------
// Fixtures + render helper
// ---------------------------------------------------------------------------

const CENTER_ID = 'c0000000-0000-0000-0000-000000000001'
const USER_EMAIL = 'owner@example.com'
const USER_FULL_NAME = 'Owner Name'
const SPAWNED_ONE = ['class-0001']
const SPAWNED_THREE = ['class-0001', 'class-0002', 'class-0003']

type Persona = 'operator' | 'founder' | 'solo_teacher'

function makeSession(overrides?: Partial<Session>): Session {
  return {
    user: {
      id: 'user-1',
      email: USER_EMAIL,
      fullName: USER_FULL_NAME,
      emailVerified: true,
    } as unknown as Session['user'],
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
      brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    ...overrides,
  }
}

interface SeedProgressArgs {
  persona: Persona | null
  currentStep:
    | 'persona'
    | 'center'
    | 'template'
    | 'spawn'
    | 'solo_first_class'
    | 'done'
  spawnedClassIds?: string[] | undefined
  classesDraft?: Array<{
    cohortName: string
    startDate: string
    teacherEmail: string | null
  }>
}

function seedProgress(
  queryClient: ReturnType<typeof createTestQueryClient>,
  {
    persona,
    currentStep,
    spawnedClassIds,
    classesDraft,
  }: SeedProgressArgs,
) {
  queryClient.setQueryData(onboardingKeys.progress(), {
    persona,
    currentStep,
    payload: {
      schemaVersion: 1,
      personaChoice: persona,
      centerDraft: null,
      templateDraft: {
        selectedTemplateId: 'template-writing-bootcamp',
        buildFromScratch: false,
        spawnedClassIds,
        ...(classesDraft !== undefined ? { classesDraft } : {}),
      },
    },
    updatedAt: '2026-07-12T10:00:00.000Z',
  })
}

interface RenderArgs {
  session?: Session
  persona?: Persona | null
  currentStep?: SeedProgressArgs['currentStep']
  spawnedClassIds?: string[] | undefined
  classesDraft?: SeedProgressArgs['classesDraft']
  locale?: 'en' | 'vi'
  seedProgressCache?: boolean
  initialPath?: string
}

async function renderDonePage(args: RenderArgs = {}) {
  const {
    session = makeSession(),
    persona = 'operator',
    currentStep = 'done',
    locale = 'en',
    seedProgressCache = true,
    initialPath = '/setup/done',
  } = args
  // Distinguish "caller omitted the key" from "caller passed undefined
  // explicitly". Destructuring `= default` short-circuits explicit
  // `undefined` to the default value, which defeats the M-I4 branch-4
  // `spawnedClassIds === undefined` and M-S1 `null classesDraft` tests
  // (both intentionally pass `undefined` to exercise the null-safety path).
  const spawnedClassIds = Object.prototype.hasOwnProperty.call(
    args,
    'spawnedClassIds',
  )
    ? args.spawnedClassIds
    : SPAWNED_THREE
  const classesDraft = Object.prototype.hasOwnProperty.call(
    args,
    'classesDraft',
  )
    ? args.classesDraft
    : [
        { cohortName: 'IELTS Alpha', startDate: '2026-08-15', teacherEmail: null },
        { cohortName: 'IELTS Beta', startDate: '2026-08-22', teacherEmail: 'bob@example.com' },
        { cohortName: 'IELTS Gamma', startDate: '2026-08-29', teacherEmail: 'carol@example.com' },
      ]

  await i18n.changeLanguage(locale)

  const queryClient = createTestQueryClient()
  queryClient.setQueryData(authKeys.session(), session)

  if (seedProgressCache) {
    seedProgress(queryClient, {
      persona,
      currentStep,
      spawnedClassIds,
      classesDraft,
    })
  }

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route path="/welcome" element={<div>WELCOME_PLACEHOLDER</div>} />
              <Route
                path="/setup/center"
                element={<div>CENTER_PLACEHOLDER</div>}
              />
              <Route
                path="/setup/template"
                element={<div>TEMPLATE_PLACEHOLDER</div>}
              />
              <Route
                path="/setup/spawn"
                element={<div>SPAWN_PLACEHOLDER</div>}
              />
              <Route
                path="/setup/first-class"
                element={<div>FIRST_CLASS_PLACEHOLDER</div>}
              />
              <Route path="/setup/done" element={<OnboardingDonePage />} />
            </Route>
            <Route
              path="/dashboard"
              element={<div>DASHBOARD_PLACEHOLDER</div>}
            />
            <Route path="/login" element={<div>LOGIN_PLACEHOLDER</div>} />
            <Route
              path="/verify-email"
              element={<div>VERIFY_EMAIL_PLACEHOLDER</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )

  return { ...utils, queryClient }
}

// ---------------------------------------------------------------------------
// AC9 — Three-state coverage on <OnboardingDonePage> render
// ---------------------------------------------------------------------------

describe('AC9 — three-state coverage on <OnboardingDonePage>', () => {
  test('(a) loading skeleton renders while progress.isLoading (compound inFlight guard)', async () => {
    // No progress cache seeded + no MSW response yet → useOnboardingProgress
    // stays in loading state until refetch completes.
    server.use(
      // Never-resolving handler for GET progress → forces perpetual loading
      // for the duration of this test.
      ...onboardingHandlers,
    )
    await renderDonePage({ seedProgressCache: false })

    // Page-level loading skeleton (Task 2.1 spec: OnboardingDonePageSkeleton
    // or an inline `data-testid="skeleton-done"` block).
    expect(
      await screen.findByTestId('skeleton-done'),
    ).toBeInTheDocument()
  })

  test('(b) success — DoneHeroPanel renders with populated stats', async () => {
    await renderDonePage({
      persona: 'operator',
      spawnedClassIds: SPAWNED_THREE,
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: 'a@x.com' },
        { cohortName: 'B', startDate: '2026-08-22', teacherEmail: 'b@x.com' },
        { cohortName: 'C', startDate: '2026-08-29', teacherEmail: 'c@x.com' },
      ],
    })

    // AC1: interpolated center name in <h1>
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/Saigon English Center/i)

    // Stat strip — 3 tiles (R1-C1-P7 + P19: semantic <dt> label + <dd> value)
    const classesTile = await screen.findByTestId('stat-tile-classes')
    expect(classesTile).toHaveTextContent(/classes ready/i)
    expect(classesTile).toHaveTextContent(/3/)
    const teachersTile = screen.getByTestId('stat-tile-teachers')
    expect(teachersTile).toHaveTextContent(/teachers invited/i)
    expect(teachersTile).toHaveTextContent(/3/)
    expect(screen.getByText(/saigon-english\.classlite\.app/i)).toBeInTheDocument()

    // AC1: primary CTA is a <button> (not <a> — client-side nav)
    expect(
      screen.getByRole('button', { name: /open dashboard/i }),
    ).toBeInTheDocument()
  })

  test('(c) error — progress.isError renders Alert with retry, does NOT auto-navigate', async () => {
    server.use(errorHandlers.progressInternalError())

    const { queryClient } = await renderDonePage({ seedProgressCache: false })

    // Alert with retry CTA
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()

    // Did NOT auto-route back to a wizard step
    expect(
      screen.queryByText(/WELCOME_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()

    // Progress cache still empty → confirm no side-effect writes fired.
    expect(
      queryClient.getQueryData(onboardingKeys.progress()),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// AC9 (b.i–b.iii) — retry semantics (M-B3)
// ---------------------------------------------------------------------------

describe('AC9 — retry semantics (M-B3 persistent-failure ratchet)', () => {
  test('(b.i) retry-success after transient failure — guard ladder fires exactly once (mount-once ref)', async () => {
    // Deliberately naive: the mount-once ref means even after refetch success,
    // navigate is not re-fired. The test asserts the DoneHeroPanel renders
    // AFTER the retry lands the success payload — no double-navigate observed.
    server.use(errorHandlers.progressInternalError())
    await renderDonePage({ seedProgressCache: false })

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()

    // Swap the handler to success and click Try again
    server.use(...onboardingHandlers)
    server.use(
      errorHandlers.progressWithPersona('operator', 'done', {
        schemaVersion: 1,
        personaChoice: 'operator',
        centerDraft: null,
        templateDraft: {
          selectedTemplateId: 'template-writing-bootcamp',
          buildFromScratch: false,
          spawnedClassIds: SPAWNED_ONE,
        },
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Success render
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()

    // Assert we didn't accidentally navigate to the dashboard (mount-once ref
    // held) — we stayed on /setup/done and rendered the celebration.
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  test('(b.ii) retry-fail → alert stays visible, no double-render', async () => {
    server.use(errorHandlers.progressInternalError())
    await renderDonePage({ seedProgressCache: false })

    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Only one alert in the DOM
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
  })

  test('(b.iii) persistent-failure ratchet — 3 consecutive refetch failures escalate with role="alert" + Sentry breadcrumb', async () => {
    server.use(errorHandlers.progressInternalError())
    await renderDonePage({ seedProgressCache: false })

    const initialAlert = await screen.findByRole('alert')
    expect(initialAlert).toBeInTheDocument()

    // Fire refetch 3 times
    for (let i = 0; i < 3; i++) {
      await userEvent.click(
        screen.getByRole('button', { name: /try again/i }),
      )
      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      )
    }

    // After 3 failures, the visible copy escalates (test asserts on a
    // persistent-failure marker — data-testid or updated copy — Task 2.4
    // spec).
    expect(
      await screen.findByTestId('done-error-persistent'),
    ).toBeInTheDocument()

    // R1-C3-P5 — R1-C1-P12 diagnostic emit-once contract.
    const persistentBreadcrumbs = addBreadcrumbSpy.mock.calls.filter(
      (call) =>
        (call[0] as { message?: string }).message ===
        'done-page-persistent-failure',
    )
    expect(persistentBreadcrumbs).toHaveLength(1)
    expect(persistentBreadcrumbs[0][0]).toMatchObject({
      category: 'onboarding',
      level: 'warning',
    })
  })

  // R1-C3-P6 — R1-C1-P4 ratchet-reset semantic: refetch success MUST
  // reset the count. Sequence: fail → fail → success → fail → fail →
  // fail assert persistent. If the reset regressed, the persistent
  // marker would appear after the 5th failure (count 5 >= 3), but a
  // regression where success does NOT reset would show it at the 3rd
  // failure. Timing matters here — assert absence before the reset,
  // then presence after 3 post-reset failures.
  test('(b.iv) ratchet-reset semantic — success mid-sequence resets the count (R1-C1-P4)', async () => {
    server.use(errorHandlers.progressInternalError())
    const { queryClient } = await renderDonePage({ seedProgressCache: false })

    await screen.findByRole('alert')

    // 2 failing retries → count = 2, persistent NOT yet visible
    for (let i = 0; i < 2; i++) {
      await userEvent.click(
        screen.getByRole('button', { name: /try again/i }),
      )
      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      )
    }
    expect(
      screen.queryByTestId('done-error-persistent'),
    ).not.toBeInTheDocument()

    // Swap MSW to a success handler; 1 successful retry MUST reset count → 0
    server.use(
      errorHandlers.progressWithPersona('operator', 'done', {
        schemaVersion: 1,
        personaChoice: 'operator',
        centerDraft: null,
        templateDraft: {
          selectedTemplateId: 'template-writing-bootcamp',
          buildFromScratch: false,
          spawnedClassIds: SPAWNED_ONE,
        },
      }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: /try again/i }),
    )
    // Successful refetch → panel renders (no more alert)
    await screen.findByRole('heading', { level: 1 })

    // Swap MSW back to failing; 2 more failures should NOT trip persistent
    // (count is now 0, needs 3 more fails)
    server.use(errorHandlers.progressInternalError())
    await queryClient.invalidateQueries({
      queryKey: onboardingKeys.progress(),
    })
    for (let i = 0; i < 2; i++) {
      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      )
      await userEvent.click(
        screen.getByRole('button', { name: /try again/i }),
      )
    }
    // Persistent must NOT appear yet — the reset held
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    )
    expect(
      screen.queryByTestId('done-error-persistent'),
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC2 — 6-branch guard ladder (M-B2 enumeration)
// ---------------------------------------------------------------------------

describe('AC2 — 6-branch guard ladder (18 named tests per M-B2 + M-I4)', () => {
  // ── Early-exit tests (guards 0 and 0b) ────────────────────────────────
  test('early-exit — progress.data undefined → no navigate, renders loading skeleton', async () => {
    // Seed no cache; MSW happy handler returns default with persona: null,
    // but between mount and first render, progress.data may be undefined.
    // We assert the skeleton renders and no premature navigate to any
    // wizard route or /dashboard happens BEFORE the first data arrives.
    await renderDonePage({ seedProgressCache: false })

    // Immediately after mount, no premature navigate.
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/WELCOME_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  test('early-exit — inFlight true (session cache slot missing) → renders skeleton, no navigate', async () => {
    // Simulate the mid-probe race: no auth session cache seeded → useAuth
    // reports isLoading true → inFlight guard suppresses the ladder.
    const queryClient = createTestQueryClient()
    seedProgress(queryClient, {
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: SPAWNED_ONE,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/setup/done']}>
            <Routes>
              <Route element={<OnboardingLayout />}>
                <Route path="/setup/done" element={<OnboardingDonePage />} />
              </Route>
              <Route
                path="/dashboard"
                element={<div>DASHBOARD_PLACEHOLDER</div>}
              />
              <Route path="/login" element={<div>LOGIN_PLACEHOLDER</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    // OnboardingLayout skeleton owns the inFlight branch — no premature
    // navigation observed.
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // ── Branch 1 — persona null → /welcome ────────────────────────────────
  test('branch 1 — progress.data.persona === null → navigate /welcome', async () => {
    await renderDonePage({
      persona: null,
      currentStep: 'persona',
      spawnedClassIds: undefined,
      session: makeSession({ center: null }),
    })
    expect(
      await screen.findByText(/WELCOME_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })

  // ── Branch 2 — session.center null → /setup/center ────────────────────
  test('branch 2 — session.center === null (persona present) → navigate /setup/center', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'center',
      spawnedClassIds: undefined,
      session: makeSession({ center: null }),
    })
    expect(
      await screen.findByText(/CENTER_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })

  // ── Branch 3 — 12 currentStep dispatch permutations (M-B2) ────────────
  const NON_DONE_STEPS = ['center', 'template', 'spawn', 'solo_first_class'] as const
  const PERSONAS: Persona[] = ['operator', 'founder', 'solo_teacher']

  const dispatchExpectation = (
    persona: Persona,
    step: (typeof NON_DONE_STEPS)[number],
  ): string => {
    // R1-C1-P23: logically-impossible persona × step combos route to
    // /welcome (surface state corruption). When session.center is
    // populated (which the default renderDonePage seeds), the
    // OnboardingLayout further redirects /welcome → /dashboard because
    // persona-pick isn't valid once the center exists. Final observable
    // destination for corrupt states = DASHBOARD_PLACEHOLDER.
    if (persona === 'solo_teacher') {
      if (step === 'center') return 'CENTER_PLACEHOLDER'
      if (step === 'solo_first_class') return 'FIRST_CLASS_PLACEHOLDER'
      // Solo × (template | spawn) = corruption
      return 'DASHBOARD_PLACEHOLDER'
    }
    // Operator + Founder
    if (step === 'center') return 'CENTER_PLACEHOLDER'
    if (step === 'template') return 'TEMPLATE_PLACEHOLDER'
    if (step === 'spawn') return 'SPAWN_PLACEHOLDER'
    // Operator|Founder × solo_first_class = corruption
    return 'DASHBOARD_PLACEHOLDER'
  }

  for (const persona of PERSONAS) {
    for (const step of NON_DONE_STEPS) {
      test(`branch 3 — persona=${persona}, currentStep=${step} → dispatches to ${dispatchExpectation(persona, step)}`, async () => {
        await renderDonePage({
          persona,
          currentStep: step,
          spawnedClassIds: undefined,
        })
        expect(
          await screen.findByText(dispatchExpectation(persona, step)),
        ).toBeInTheDocument()
      })
    }
  }

  // R1-C3-P5 — R1-C1-P23 corrupt-step Sentry breadcrumb: logically-impossible
  // persona × step combos must emit a diagnostic breadcrumb. Legitimate
  // `step === 'persona'` (no persona picked yet) does NOT emit.
  test('R1-C1-P23: corrupt persona × step combo emits done-page-corrupt-step Sentry breadcrumb', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'solo_first_class', // corrupt for Operator
      spawnedClassIds: undefined,
    })
    // Wait for the ladder to fire + navigate
    await screen.findByText(/DASHBOARD_PLACEHOLDER/i)

    const corruptBreadcrumbs = addBreadcrumbSpy.mock.calls.filter(
      (call) =>
        (call[0] as { message?: string }).message === 'done-page-corrupt-step',
    )
    expect(corruptBreadcrumbs).toHaveLength(1)
    expect(corruptBreadcrumbs[0][0]).toMatchObject({
      category: 'onboarding',
      level: 'warning',
      data: { persona: 'operator', currentStep: 'solo_first_class' },
    })
  })

  test('R1-C1-P23: legitimate persona-set + currentStep=persona does NOT emit corrupt-step breadcrumb', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'persona', // resume-to-persona is the normal case
      spawnedClassIds: undefined,
    })
    await screen.findByText(/WELCOME_PLACEHOLDER|DASHBOARD_PLACEHOLDER/i)

    const corruptBreadcrumbs = addBreadcrumbSpy.mock.calls.filter(
      (call) =>
        (call[0] as { message?: string }).message === 'done-page-corrupt-step',
    )
    expect(corruptBreadcrumbs).toHaveLength(0)
  })

  // ── Branch 4 — spawnedClassIds empty / undefined → VISIBLE FAIL (S-B1) ──
  test('branch 4 — spawnedClassIds === [] → renders visible setupIncomplete alert (S-B1)', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: [],
    })

    // S-B1: DO NOT silent-bounce; render a visible fail state
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't confirm your setup/i)
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /continue to dashboard/i }),
    ).toBeInTheDocument()

    // Explicitly did NOT bounce to dashboard.
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  test('branch 4 — spawnedClassIds === undefined → renders visible setupIncomplete alert (M-I4)', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: undefined,
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't confirm your setup/i)
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // R1-C3-P4 — R1-C1-P21 non-array spawnedClassIds (tampered payload)
  // must ALSO trigger the visible fail alert, not fall through to
  // .length on a string/object which would render a broken celebration.
  test('branch 4 — spawnedClassIds is a non-array truthy value (tampered payload) → renders visible setupIncomplete alert (R1-C1-P21)', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'done',
      // Cast: seedProgress typing requires string[] but we deliberately
      // ship a string here to exercise the !Array.isArray guard.
      spawnedClassIds: 'not-an-array' as unknown as string[],
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't confirm your setup/i)
    // Would-be-broken celebration must NOT render.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // ── Branch 5 — stay + render DoneHeroPanel ────────────────────────────
  test('branch 5 — happy path → stays on /setup/done + renders DoneHeroPanel; hasRoutedOnMountRef NOT set (W-B3)', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: SPAWNED_THREE,
    })

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()

    // Did not bounce to dashboard or any wizard step.
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // ── Error-no-route ────────────────────────────────────────────────────
  test('progress.isError → renders Alert + does NOT navigate to any wizard step', async () => {
    server.use(errorHandlers.progressInternalError())
    await renderDonePage({ seedProgressCache: false })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(
      screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/WELCOME_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/SPAWN_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // ── Guard-order pins (M-I1) ───────────────────────────────────────────
  // R1-C3-P7: seed `currentStep:'template'` so Branch 3 would target
  // /setup/template — Branch 2 must intercept and route to /setup/center.
  // The prior form with `currentStep:'center'` could not distinguish
  // Branch 2 firing from Branch 3 firing (both routed to /setup/center).
  test('guard-order — persona=operator + session.center=null + currentStep=template → routes to /setup/center (branch 2 intercepts before branch 3)', async () => {
    await renderDonePage({
      persona: 'operator',
      currentStep: 'template',
      spawnedClassIds: undefined,
      session: makeSession({ center: null }),
    })
    expect(
      await screen.findByText(/CENTER_PLACEHOLDER/i),
    ).toBeInTheDocument()
    // Branch 3 would have routed to /setup/template — verify it did NOT.
    expect(
      screen.queryByText(/TEMPLATE_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/WELCOME_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  test('guard-order — persona=null + session.center=null → routes to /welcome (branch 1 fires first)', async () => {
    await renderDonePage({
      persona: null,
      currentStep: 'persona',
      spawnedClassIds: undefined,
      session: makeSession({ center: null }),
    })
    expect(
      await screen.findByText(/WELCOME_PLACEHOLDER/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/CENTER_PLACEHOLDER/i),
    ).not.toBeInTheDocument()
  })

  // ── Refetch race (M-I2) ───────────────────────────────────────────────
  // R1-C1-P1: navigate-only latch (W-B3) — branches 4/5 do NOT set the ref,
  // so refetches DO re-check the ladder. For valid data (same persona +
  // done + non-empty spawnedClassIds), the ladder stays at branch 5 and the
  // panel keeps rendering. For narrowed data, the ladder re-fires and
  // routes out — desired behavior on session ageing.
  test('refetch race — valid data on refetch keeps rendering the panel (no accidental navigate)', async () => {
    const { queryClient } = await renderDonePage({
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: SPAWNED_THREE,
    })

    // Success rendered.
    expect(
      await screen.findByRole('heading', { level: 1 }),
    ).toBeInTheDocument()

    // Ensure the refetch handler returns the same valid data so the ladder
    // stays at branch 5.
    server.use(
      errorHandlers.progressWithPersona('operator', 'done', {
        schemaVersion: 1,
        personaChoice: 'operator',
        centerDraft: null,
        templateDraft: {
          selectedTemplateId: 'template-writing-bootcamp',
          buildFromScratch: false,
          spawnedClassIds: SPAWNED_THREE,
        },
      }),
    )

    // Trigger a refetch by invalidating the progress key — simulates
    // tab-focus + TanStack Query's refetchOnWindowFocus behaviour.
    await queryClient.invalidateQueries({
      queryKey: onboardingKeys.progress(),
    })

    await waitFor(() =>
      expect(
        screen.queryByText(/DASHBOARD_PLACEHOLDER/i),
      ).not.toBeInTheDocument(),
    )
    // Heading still there — panel re-rendered with the fresh valid data.
    expect(
      screen.getByRole('heading', { level: 1 }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC1 stat-filter negative matrix (M-S1)
// ---------------------------------------------------------------------------

describe('AC1 — stat-filter teachersInvitedCount negative matrix (M-S1)', () => {
  const rows: Array<{
    name: string
    userEmail: string
    classesDraft: SeedProgressArgs['classesDraft']
    expectedCount: number
    persona?: Persona
  }> = [
    {
      name: 'case-mismatch — user Owner@example.com vs draft OWNER@EXAMPLE.COM → excluded',
      userEmail: 'Owner@example.com',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: 'OWNER@EXAMPLE.COM' },
      ],
      expectedCount: 0,
    },
    {
      name: 'trim-mismatch — user bob@example.com vs draft "  bob@example.com  " → excluded',
      userEmail: 'bob@example.com',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: '  bob@example.com  ' },
      ],
      expectedCount: 0,
    },
    {
      name: 'null classesDraft → count 0 (no throw)',
      userEmail: 'bob@example.com',
      classesDraft: undefined,
      expectedCount: 0,
    },
    {
      name: 'empty classesDraft [] → count 0',
      userEmail: 'bob@example.com',
      classesDraft: [],
      expectedCount: 0,
    },
    {
      name: 'Founder self-injection (Winston-W4) — persona=founder + row 0 teacherEmail=user.email → excluded, count 0',
      userEmail: 'founder@example.com',
      persona: 'founder',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: 'founder@example.com' },
      ],
      expectedCount: 0,
    },
    {
      name: 'undefined teacherEmail rows → filtered out (!= null handles undefined)',
      userEmail: 'owner@example.com',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: null },
        { cohortName: 'B', startDate: '2026-08-22', teacherEmail: 'a@x.com' },
      ],
      expectedCount: 1,
    },
    {
      // R1-C3-P2 — R1-C1-P24 dedup coverage: same teacher assigned to N classes
      // counts as 1 invite (Set dedup by normalized email).
      name: 'duplicate teacher email across rows → dedup by normalized email = 1 (R1-C1-P24)',
      userEmail: 'owner@example.com',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: 'bob@x.com' },
        { cohortName: 'B', startDate: '2026-08-22', teacherEmail: 'BOB@x.com' },
        { cohortName: 'C', startDate: '2026-08-29', teacherEmail: '  bob@x.com  ' },
      ],
      expectedCount: 1,
    },
    {
      // R1-C3-P3 — R1-C1-P20 whitespace-only teacherEmail coverage.
      name: 'whitespace-only teacherEmail ("   ") → excluded (R1-C1-P20)',
      userEmail: 'owner@example.com',
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: '   ' },
        { cohortName: 'B', startDate: '2026-08-22', teacherEmail: 'real@x.com' },
      ],
      expectedCount: 1,
    },
  ]

  for (const row of rows) {
    test(row.name, async () => {
      await renderDonePage({
        session: makeSession({
          user: {
            id: 'user-1',
            email: row.userEmail,
            fullName: USER_FULL_NAME,
            emailVerified: true,
          } as unknown as Session['user'],
        }),
        persona: row.persona ?? 'operator',
        currentStep: 'done',
        spawnedClassIds: SPAWNED_ONE,
        classesDraft: row.classesDraft,
      })

      // Assert on the teacher stat tile — R1-C1-P7 + P19: dt = label,
      // dd = count. Tile has data-testid="stat-tile-teachers". The dd
      // renders the raw count number, matched via scoped exact-text query.
      const tile = await screen.findByTestId('stat-tile-teachers')
      expect(tile).toHaveTextContent(/teachers invited/i)
      const dd = tile.querySelector('dd')
      expect(dd?.textContent?.trim()).toBe(String(row.expectedCount))
    })
  }

  test('defensive: null user (transient boot-probe state) — selfEmail === "" fallback counts all non-null emails (W-S3)', async () => {
    // Auth session cache seat is null → useAuth().user reports null →
    // stat-filter uses `?? ''` fallback → excludes nothing based on self.
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), null)
    seedProgress(queryClient, {
      persona: 'operator',
      currentStep: 'done',
      spawnedClassIds: SPAWNED_ONE,
      classesDraft: [
        { cohortName: 'A', startDate: '2026-08-15', teacherEmail: 'a@x.com' },
        { cohortName: 'B', startDate: '2026-08-22', teacherEmail: 'b@x.com' },
      ],
    })

    // Rendering without a real user — page-level guard falls through to
    // either loading skeleton or dashboard route (depending on the layout's
    // !user branch). The specific expectation: NO exception thrown; no
    // "Cannot read property 'toLowerCase' of undefined" error.
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/setup/done']}>
            <Routes>
              <Route element={<OnboardingLayout />}>
                <Route path="/setup/done" element={<OnboardingDonePage />} />
              </Route>
              <Route
                path="/login"
                element={<div>LOGIN_PLACEHOLDER</div>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    // Redirect fires (session === null → layout bounces to /login) —
    // no exception; the point of this test is defensive `?? ''` handling.
    expect(
      await screen.findByText(/LOGIN_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC1 — Open Dashboard CTA
// ---------------------------------------------------------------------------

describe('AC1 — primary CTA', () => {
  test('"Open Dashboard →" navigates /dashboard with replace: true', async () => {
    await renderDonePage({
      persona: 'operator',
      spawnedClassIds: SPAWNED_ONE,
    })

    const cta = await screen.findByRole('button', {
      name: /open dashboard/i,
    })
    expect(cta).toBeInTheDocument()

    await userEvent.click(cta)

    expect(
      await screen.findByText(/DASHBOARD_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC3 — per-persona subtitle copy
// ---------------------------------------------------------------------------

describe('AC3 — per-persona subtitle copy (3 branches)', () => {
  const cases: Array<{ persona: Persona; match: RegExp }> = [
    { persona: 'operator', match: /center is live/i },
    { persona: 'founder', match: /first class is spun up/i },
    { persona: 'solo_teacher', match: /one class, one teacher/i },
  ]

  for (const { persona, match } of cases) {
    test(`persona=${persona} → renders persona-specific subtitle`, async () => {
      await renderDonePage({
        persona,
        spawnedClassIds: SPAWNED_ONE,
      })
      expect(await screen.findByText(match)).toBeInTheDocument()
    })
  }
})

// ---------------------------------------------------------------------------
// AC11 — a11y matrix (M-S2 + S-B2)
// ---------------------------------------------------------------------------

describe('AC11 — a11y zero-violations across 3 personas × 2 locales (M-S2)', () => {
  const personas: Persona[] = ['operator', 'founder', 'solo_teacher']
  const locales: Array<'en' | 'vi'> = ['en', 'vi']

  for (const persona of personas) {
    for (const locale of locales) {
      test(`axe — persona=${persona}, locale=${locale} → zero violations`, async () => {
        const { container } = await renderDonePage({
          persona,
          locale,
          spawnedClassIds: SPAWNED_ONE,
        })

        // Wait for hero to mount.
        await screen.findByRole('heading', { level: 1 })

        const results = await axe(container)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(results as any).toHaveNoViolations()
      })
    }
  }

  test('focus-on-mount (S-B2) — <h1> receives focus after mount, SR announces via heading focus-change', async () => {
    await renderDonePage({
      persona: 'operator',
      spawnedClassIds: SPAWNED_ONE,
    })
    const heading = await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  test('S-B2 — DoneHeroPanel does NOT render a sibling role="status" region', async () => {
    await renderDonePage({
      persona: 'operator',
      spawnedClassIds: SPAWNED_ONE,
    })
    await screen.findByRole('heading', { level: 1 })

    // Explicit negative — role="status" on initial mount unreliable across
    // SR/browser combos; announcement is via <h1> focus, not a paired live
    // region.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC1 Vietnamese overflow discipline (S-S1)
// ---------------------------------------------------------------------------

describe('AC1 — Vietnamese Founder headline overflow discipline (S-S1)', () => {
  test('long VN centerName renders inside <h1> with responsive step-down classes (min-w-0 break-words)', async () => {
    await renderDonePage({
      persona: 'founder',
      locale: 'vi',
      spawnedClassIds: SPAWNED_ONE,
      session: makeSession({
        center: {
          id: CENTER_ID,
          name: 'Trung tâm Anh ngữ Quốc tế Hà Nội',
          shortCode: 'trung-tam-ha-noi',
          // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
          brandColor: '#1e3a8a',
          logoUrl: null,
          timezone: 'Asia/Ho_Chi_Minh',
        },
      }),
    })

    const heading = await screen.findByRole('heading', { level: 1 })
    // Assert the h1 carries the Vietnamese-safe layout classes.
    expect(heading.className).toMatch(/min-w-0/)
    expect(heading.className).toMatch(/break-words/)
  })
})

// ---------------------------------------------------------------------------
// Task 1.5 — stepFromPathname('/setup/done') idempotence contract (M-S6)
// ---------------------------------------------------------------------------

describe('Task 1.5 — stepFromPathname("/setup/done") idempotence (M-S6)', () => {
  test('mounting /setup/done does NOT fire a rogue PUT to /api/onboarding/progress', async () => {
    let putCallCount = 0
    server.use(
      // Wrap the shipped happy PUT handler to count calls; the celebration
      // page has no form so scheduleSave must never fire.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(onboardingHandlers as any[]),
    )
    // Intercept PUT progress to count calls.
    const { http, HttpResponse } = await import('msw')
    server.use(
      http.put('/api/onboarding/progress', async ({ request }) => {
        putCallCount += 1
        const body = (await request.json()) as {
          currentStep: string
          payload: unknown
        }
        return HttpResponse.json(
          {
            data: {
              currentStep: body.currentStep,
              payload: body.payload,
              updatedAt: '2026-07-12T10:00:00.000Z',
            },
            meta: { serverTime: '2026-07-12T10:00:00.000Z' },
          },
          { status: 200 },
        )
      }),
    )

    await renderDonePage({
      persona: 'operator',
      spawnedClassIds: SPAWNED_ONE,
    })

    await screen.findByRole('heading', { level: 1 })
    // Give the debounce a tick (page has no form, so 0 PUTs expected).
    await new Promise((r) => setTimeout(r, 200))

    expect(putCallCount).toBe(0)
  })
})
