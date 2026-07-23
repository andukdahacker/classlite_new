/**
 * Story 2-4 — `TeacherDashboard` red-phase acceptance tests.
 *
 * This is the FIRST test file for `TeacherDashboard.tsx` [A-STRONG-8 fold].
 * Includes shipped-behavior REGRESSION BASELINE for the 3 welcome-back
 * banner branches (`midWizardNoCenter` / `postCenterIncomplete` /
 * `progressUnknownNoCenter`) — otherwise the AC12 i18n rename silently
 * regresses shipped behavior.
 *
 * Covers Task 6.6 per AC1/AC12/AC13/AC16/AC17:
 *   - AC1 8-cell loading/error/state matrix (see Dev Notes §"Task 6.6 MSW
 *     handler catalog" — 12 rows including 6b/6c persona split)
 *   - AC12 3-way mutex assertion — welcome-back-banner XOR FinishSetupCard;
 *     persona-value cards XOR each other [W-STRONG-14 + M-STRONG-15]
 *   - AC13 shipped banner behavior under RENAMED i18n keys
 *     (dashboard.welcomeBack.*)
 *   - AC16 axe zero violations — 3 personas × 2 locales at cell 6 (default)
 *     + 3 personas at cell 5 (snoozed) = 9 axe renders
 *   - AC17 shipped-banner regression baseline block
 *
 * Uses the shipped MSW `progressWithPersona(persona, currentStep, payload)`
 * factory at `handlers.ts:267` + `queryClient.setQueryData(authKeys.session(), ...)`
 * for `useCurrentCenter` injection.
 *
 * ATDD contract: TS2307 on `@/features/dashboard/TeacherDashboard` will NOT
 * fire (file exists) — RED signal here is on shipped-behavior tests
 * that use RENAMED i18n keys (dashboard.welcomeBack.*) which don't exist
 * until Task 6.5 lands. Plus TS2307 on the new body components
 * (OperatorDashboardBody / FounderDashboardBody / SoloTeacherDashboardBody)
 * imported transitively.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from 'react-router'
import { HttpResponse, http } from 'msw'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import TeacherDashboard from '@/features/dashboard/TeacherDashboard'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

beforeEach(() => {
  server.use(...onboardingHandlers)
  window.localStorage.clear()
})

// Locale mutations in `renderShell` are global — reset per-test so a
// vi-locale render doesn't leak into a subsequent en-locale assertion.
afterEach(async () => {
  await i18n.changeLanguage('en')
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1'
const USER_EMAIL = 'owner@example.com'
const USER_DISPLAY_NAME = 'Trang'

function makeSession(overrides?: Partial<Session>): Session {
  const base: Session = {
    user: {
      id: USER_ID,
      email: USER_EMAIL,
      fullName: USER_DISPLAY_NAME,
      emailVerified: true,
    } as unknown as Session['user'],
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format
      brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    // Story 2.6 (AC2) — TeacherDashboard renders for a Teacher persona;
    // the seeded session mirrors the on-wire shape a Teacher would have
    // after login + membership resolve.
    role: 'teacher',
  }
  return { ...base, ...overrides }
}

type Persona = 'operator' | 'founder' | 'solo_teacher'

interface SeedProgressArgs {
  persona: Persona | null
  currentStep:
    | 'persona'
    | 'center'
    | 'template'
    | 'spawn'
    | 'solo_first_class'
    | 'done'
  spawnedClassIds?: string[]
  classesDraft?: Array<{
    cohortName: string
    startDate: string
    teacherEmail: string | null
  }>
}

function seedProgress(
  queryClient: ReturnType<typeof createTestQueryClient>,
  args: SeedProgressArgs,
) {
  queryClient.setQueryData(onboardingKeys.progress(), {
    persona: args.persona,
    currentStep: args.currentStep,
    payload: {
      templateDraft: {
        selectedTemplateId: 'tpl-1',
        spawnedClassIds: args.spawnedClassIds,
        classesDraft: args.classesDraft,
      },
    },
    updatedAt: new Date('2026-07-14T00:00:00Z').toISOString(),
  })
}

async function renderShell(opts: {
  session: Session | null
  progressArgs?: SeedProgressArgs
  locale?: 'en' | 'vi'
}) {
  const queryClient = createTestQueryClient()
  if (opts.session) {
    queryClient.setQueryData(authKeys.session(), opts.session)
  }
  if (opts.progressArgs) {
    seedProgress(queryClient, opts.progressArgs)
  }
  if (opts.locale) {
    // Await — `changeLanguage` is async; a void-swallowed switch races
    // against synchronous `getBy*` assertions and produces flake.
    await i18n.changeLanguage(opts.locale)
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<TeacherDashboard />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// AC17 — shipped welcome-back-banner REGRESSION baseline (under RENAMED keys)
// ---------------------------------------------------------------------------
describe('TeacherDashboard — shipped banner regression baseline [AC17]', () => {
  test('renders welcome-back banner in midWizardNoCenter branch under renamed key', async () => {
    await renderShell({
      session: makeSession({ center: null }),
      progressArgs: { persona: 'operator', currentStep: 'center' },
    })
    expect(
      await screen.findByTestId('dashboard-finish-setup-banner'),
    ).toBeInTheDocument()
    // Copy resolves via renamed dashboard.welcomeBack.banner key
    expect(
      screen.getByText(i18n.t('dashboard.welcomeBack.banner') as string),
    ).toBeInTheDocument()
  })

  test('renders welcome-back banner in postCenterIncomplete branch under renamed CTA key', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: 'operator', currentStep: 'template' },
    })
    expect(
      await screen.findByTestId('dashboard-finish-setup-banner'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.welcomeBack.continueCta') as string),
    ).toBeInTheDocument()
  })

  test('renders welcome-back banner in awaitingNextStep branch (persona:null + currentStep:done) under renamed key', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: null, currentStep: 'done' },
    })
    expect(
      await screen.findByText(
        i18n.t('dashboard.welcomeBack.awaitingNextStep') as string,
      ),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Center-durability resume-routing regression — a reloaded center-owning user
// whose `session.center` hasn't rehydrated must NOT be misrouted to the create
// form (where CreateCenter 409s and wedges them). "Center exists" falls back
// to `currentStep` having advanced PAST `center`, which only happens after the
// center is created.
// ---------------------------------------------------------------------------
describe('TeacherDashboard — center-durability resume routing regression', () => {
  async function renderWithResumeRoutes(opts: {
    session: Session | null
    progressArgs: SeedProgressArgs
  }) {
    const queryClient = createTestQueryClient()
    if (opts.session) {
      queryClient.setQueryData(authKeys.session(), opts.session)
    }
    seedProgress(queryClient, opts.progressArgs)
    return render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/dashboard" element={<TeacherDashboard />} />
              <Route
                path="/setup/center"
                element={<div>NAME_YOUR_CENTER</div>}
              />
              <Route
                path="/setup/first-class"
                element={<div>CREATE_FIRST_CLASS</div>}
              />
              <Route
                path="/setup/template"
                element={<div>PICK_TEMPLATE</div>}
              />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
  }

  test('session.center=null but currentStep advanced (solo_first_class) → Continue routes to /setup/first-class, NOT /setup/center', async () => {
    const user = userEvent.setup()
    await renderWithResumeRoutes({
      session: makeSession({ center: null }),
      progressArgs: { persona: 'solo_teacher', currentStep: 'solo_first_class' },
    })
    await user.click(await screen.findByTestId('dashboard-finish-setup-cta'))
    // The wizard only reaches solo_first_class AFTER the center is created, so
    // a missing session.center (e.g. not-yet-rehydrated on reload) must NOT
    // misroute to the create form where CreateCenter would 409.
    expect(await screen.findByText('CREATE_FIRST_CLASS')).toBeInTheDocument()
    expect(screen.queryByText('NAME_YOUR_CENTER')).not.toBeInTheDocument()
  })

  test('session.center=null AND currentStep=center → Continue still routes to /setup/center (genuine pre-create user)', async () => {
    const user = userEvent.setup()
    await renderWithResumeRoutes({
      session: makeSession({ center: null }),
      progressArgs: { persona: 'operator', currentStep: 'center' },
    })
    await user.click(await screen.findByTestId('dashboard-finish-setup-cta'))
    expect(await screen.findByText('NAME_YOUR_CENTER')).toBeInTheDocument()
  })

  test('Continue setup PUSHES the wizard so browser Back returns to /dashboard, not the prior page', async () => {
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(authKeys.session(), makeSession())
    seedProgress(queryClient, {
      persona: 'solo_teacher',
      currentStep: 'solo_first_class',
    })
    // History: user was on /settings, then opened /dashboard (index 1).
    const router = createMemoryRouter(
      [
        { path: '/settings', element: <div>SETTINGS_PAGE</div> },
        { path: '/dashboard', element: <TeacherDashboard /> },
        { path: '/setup/first-class', element: <div>CREATE_FIRST_CLASS</div> },
      ],
      { initialEntries: ['/settings', '/dashboard'], initialIndex: 1 },
    )
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <RouterProvider router={router} />
        </I18nextProvider>
      </QueryClientProvider>,
    )
    await user.click(await screen.findByTestId('dashboard-finish-setup-cta'))
    expect(await screen.findByText('CREATE_FIRST_CLASS')).toBeInTheDocument()
    // Simulate browser Back.
    await act(async () => {
      await router.navigate(-1)
    })
    // Back lands on the dashboard we launched from (banner re-renders), NOT
    // the /settings entry that preceded it — the `replace: true` regression.
    expect(
      await screen.findByTestId('dashboard-finish-setup-banner'),
    ).toBeInTheDocument()
    expect(screen.queryByText('SETTINGS_PAGE')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC12 — welcome heading interpolation with user.displayName [A-BLOCKER-1]
// ---------------------------------------------------------------------------
describe('TeacherDashboard — welcome heading [AC12]', () => {
  test('welcome heading interpolates user.displayName', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: 'operator', currentStep: 'done', spawnedClassIds: ['c1'] },
    })
    expect(
      await screen.findByText(
        i18n.t('dashboard.welcomeHeading', { name: USER_DISPLAY_NAME }) as string,
      ),
    ).toBeInTheDocument()
  })

  test('when useAuth().isLoading is true → heading renders skeleton (no crash on null user)', async () => {
    // Session is null (transient boot-probe) → skeleton, not throw
    await renderShell({ session: null })
    // No heading text yet; skeleton has no user-facing text
    // (Green-phase: assert Skeleton component present via testid)
    expect(screen.queryByTestId('teacher-dashboard-heading')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC1 — 8-cell loading/error/state matrix (12 rows counting persona split)
// ---------------------------------------------------------------------------
describe('TeacherDashboard — AC1 loading/error/state matrix (12-cell mutex)', () => {
  test('Cell 2: session.center=null + currentStep=persona → banner (midWizardNoCenter); no card', async () => {
    await renderShell({
      session: makeSession({ center: null }),
      progressArgs: { persona: null, currentStep: 'persona' },
    })
    expect(
      await screen.findByTestId('dashboard-finish-setup-banner'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
  })

  test('Cell 3: session.center=valid + currentStep=template → banner (postCenterIncomplete); no card', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: 'operator', currentStep: 'template' },
    })
    expect(
      await screen.findByTestId('dashboard-finish-setup-banner'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
  })

  test('Cell 4: currentStep=done + persona=null → banner (awaitingNextStep); no card', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: null, currentStep: 'done', spawnedClassIds: ['c1'] },
    })
    expect(
      await screen.findByText(
        i18n.t('dashboard.welcomeBack.awaitingNextStep') as string,
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
  })

  test('Cell 5: currentStep=done + persona=operator + snoozed → no card + no banner + sample preview visible', async () => {
    window.localStorage.setItem(
      `classlite_finish_setup_v1_${USER_ID}`,
      JSON.stringify({ snoozedUntil: Date.now() + 7 * 24 * 3600 * 1000 }),
    )
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'operator',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
        classesDraft: [
          { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
        ],
      },
    })
    // Wait for the persona body to commit — asserting `.not.toBeInTheDocument()`
    // BEFORE the dashboard has hydrated would pass because the card hasn't
    // rendered yet, not because snooze suppressed it.
    await screen.findByTestId('dashboard-sample-preview')
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-finish-setup-banner'),
    ).not.toBeInTheDocument()
  })

  test('Cell 6a Operator: currentStep=done + persona=operator + not snoozed → card + sample preview + YourClassesRow', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'operator',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
        classesDraft: [
          { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
        ],
      },
    })
    expect(
      await screen.findByTestId('dashboard-checklist-card'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-sample-preview')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-your-classes-row')).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-first-ai-grade-card'),
    ).not.toBeInTheDocument()
  })

  test('Cell 6b Founder: currentStep=done + persona=founder + not snoozed → card + AI grade + YourClassesRow', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'founder',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
        classesDraft: [
          { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: null },
        ],
      },
    })
    expect(
      await screen.findByTestId('dashboard-checklist-card'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-first-ai-grade-card')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-your-classes-row')).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-sample-preview'),
    ).not.toBeInTheDocument()
  })

  test('Cell 6c Solo Teacher: currentStep=done + persona=solo_teacher → card (4 items) + AI grade + YourClassesRow', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'solo_teacher',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
        classesDraft: [
          { cohortName: 'My first class', startDate: '2026-08-15', teacherEmail: USER_EMAIL },
        ],
      },
    })
    const card = await screen.findByTestId('dashboard-checklist-card')
    expect(card).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-first-ai-grade-card')).toBeInTheDocument()
    // Solo Teacher checklist = 4 items (scoped within the checklist card so
    // the AI-grade card's criterion <li>s and YourClassesRow's card <li>s
    // don't inflate the count).
    expect(within(card).getAllByRole('listitem')).toHaveLength(4)
  })

  test('Cell 7: progress.isError + session.center=null → banner (progressUnknownNoCenter); no card', async () => {
    // Explicitly seed a 500 handler so `useOnboardingProgress.isError` is
    // TRUE. Without this, the default MSW handlers succeed and the banner
    // shows for a DIFFERENT branch (midWizardNoCenter or the like) — the
    // test would pass for the wrong reason.
    server.use(
      http.get('*/api/v1/onboarding/progress', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom' } },
          { status: 500 },
        ),
      ),
    )
    await renderShell({
      session: makeSession({ center: null }),
    })
    await waitFor(() =>
      expect(screen.queryByTestId('dashboard-finish-setup-banner')).toBeInTheDocument(),
    )
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC12 3-way mutex assertion
// ---------------------------------------------------------------------------
describe('TeacherDashboard — AC12 3-way mutex', () => {
  test('WelcomeBackBanner XOR FinishSetupCard — card present → banner absent', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'operator',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
      },
    })
    await screen.findByTestId('dashboard-checklist-card')
    expect(
      screen.queryByTestId('dashboard-finish-setup-banner'),
    ).not.toBeInTheDocument()
  })

  test('WelcomeBackBanner XOR FinishSetupCard — banner present → card absent', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: { persona: 'operator', currentStep: 'template' },
    })
    await screen.findByTestId('dashboard-finish-setup-banner')
    expect(
      screen.queryByTestId('dashboard-checklist-card'),
    ).not.toBeInTheDocument()
  })

  test('FirstAIGradeCard XOR SampleDashboardPreview (persona-branch)', async () => {
    await renderShell({
      session: makeSession(),
      progressArgs: {
        persona: 'operator',
        currentStep: 'done',
        spawnedClassIds: ['c1'],
        classesDraft: [
          { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
        ],
      },
    })
    expect(
      await screen.findByTestId('dashboard-sample-preview'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-first-ai-grade-card'),
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC16 axe matrix — 9 renders (3 personas × 2 locales at cell 6 + 3 snoozed)
// ---------------------------------------------------------------------------
describe('TeacherDashboard — AC16 axe zero-violations matrix', () => {
  const PERSONAS: Persona[] = ['operator', 'founder', 'solo_teacher']
  const LOCALES: Array<'en' | 'vi'> = ['en', 'vi']

  test.each(PERSONAS.flatMap((persona) => LOCALES.map((locale) => [persona, locale] as const)))(
    'cell 6 axe (%s × %s) — zero violations',
    async (persona, locale) => {
      const { container } = await renderShell({
        session: makeSession(),
        progressArgs: {
          persona,
          currentStep: 'done',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
          ],
        },
        locale,
      })
      await screen.findByTestId('dashboard-checklist-card')
      expect(await axe(container)).toHaveNoViolations()
    },
  )

  test.each(PERSONAS)(
    'cell 5 axe (%s snoozed) — zero violations on shell + persona-value card + Your Classes',
    async (persona) => {
      window.localStorage.setItem(
        `classlite_finish_setup_v1_${USER_ID}`,
        JSON.stringify({ snoozedUntil: Date.now() + 7 * 24 * 3600 * 1000 }),
      )
      const { container } = await renderShell({
        session: makeSession(),
        progressArgs: {
          persona,
          currentStep: 'done',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: null },
          ],
        },
      })
      await screen.findByTestId('dashboard-your-classes-row')
      expect(await axe(container)).toHaveNoViolations()
    },
  )
})
