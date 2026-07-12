/**
 * Story 2-3b Task 10.4 — Playwright happy-path smoke (REQUIRED per Murat-S4 fold).
 *
 * Mirrors the 2-3a `onboarding-persona-center.spec.ts` pattern: every backend
 * call is stubbed via `page.route()` against Vite's dev server (design-system
 * project — no real backend). Boot-probe refresh hydrates `useAuth` so the
 * layout guard renders the wizard instead of bouncing to /login.
 *
 * Tests cover:
 *   1. Operator happy path — persona → center → template → spawn → done
 *   2. Founder wire-null verification (Winston-W4) — spawn POST body carries
 *      `teacherEmail: null` for row 0 while the UI displays the "You'll teach
 *      this one" pill
 *   3. Solo Teacher single-navigate — Amelia-B3/B4 amendment prevents the
 *      pre-fold /welcome → /setup/template → /setup/first-class double redirect
 *   4. Solo AssignChip trigger absent belt — jsdom-focus-lies edge covered
 *      via real browser
 *
 * R1-C1-P22 fix: seed pattern rewritten to `page.route()` stubs — the prior
 * placeholder `seedFreshVerifiedUser()` returned unregistered credentials and
 * every test failed at login. R1-C1-P3 fix: `spawnBodyPromise` narrowed to
 * the exact `/api/templates/{id}/spawn` endpoint. R1-C1-P21 fix: Solo pill
 * assertion targets the display shape RHF actually renders
 * (`displayName ?? email ?? 'You'`), not the fabricated `fullName` field.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const SERVER_TIME = '2026-07-12T15:00:00.000Z'
const TEMPLATE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SPAWN_ENDPOINT_RE = new RegExp(
  `/api/templates/${TEMPLATE_ID}/spawn$`,
)

type Persona = 'operator' | 'founder' | 'solo_teacher'
type Step =
  | 'persona'
  | 'center'
  | 'template'
  | 'spawn'
  | 'solo_first_class'
  | 'done'

interface TestUser {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
}

const jsonEnvelope = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    data,
    meta: { serverTime: SERVER_TIME },
  }),
})

/**
 * Wire the full request-stub surface for the onboarding wizard. The returned
 * `getState` accessor lets tests inspect the mutated session state (progress
 * step, persona, spawned classes). `overrides.onSpawnRequest` fires when the
 * spawn POST arrives — useful for wire-body assertions (Winston-W4).
 */
async function stubOnboardingBackend(
  page: Page,
  user: TestUser,
  hasCenter: boolean = false,
  overrides: {
    onSpawnRequest?: (body: {
      templateId: string
      classes: Array<{
        cohortName: string
        startDate: string
        teacherEmail: string | null
      }>
    }) => void
  } = {},
): Promise<() => { persona: Persona | null; step: Step }> {
  const state: {
    persona: Persona | null
    step: Step
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
    updatedAt: string | null
    center: { id: string; shortCode: string } | null
  } = {
    persona: null,
    step: 'persona',
    payload: null,
    updatedAt: null,
    center: hasCenter
      ? { id: 'center-e2e', shortCode: 'e2e-center' }
      : null,
  }

  // Boot-probe refresh — hydrates useAuth cache. Without this the layout
  // guard bounces to /login before any page renders.
  await page.route('**/api/auth/refresh', async (route: Route) => {
    await route.fulfill(
      jsonEnvelope({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          fullName: user.displayName,
          emailVerified: user.emailVerified,
        },
        accessToken: 'e2e.jwt.token',
        center: state.center
          ? {
              id: state.center.id,
              name: 'E2E Center',
              shortCode: state.center.shortCode,
              brandColor: 'indigo',
              logoUrl: null,
              timezone: 'Asia/Ho_Chi_Minh',
              role: 'owner',
            }
          : null,
      }),
    )
  })

  await page.route('**/api/onboarding/progress', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}') as {
        currentStep: Step
        payload: unknown
      }
      state.step = body.currentStep
      state.payload = body.payload
      state.updatedAt = SERVER_TIME
      await route.fulfill(
        jsonEnvelope({
          currentStep: state.step,
          payload: state.payload,
          updatedAt: state.updatedAt,
        }),
      )
      return
    }
    await route.fulfill(
      jsonEnvelope({
        persona: state.persona,
        currentStep: state.step,
        payload: state.payload,
        updatedAt: state.updatedAt,
      }),
    )
  })

  await page.route('**/api/onboarding/persona', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      persona: Persona
    }
    state.persona = body.persona
    state.step = 'center'
    await route.fulfill(jsonEnvelope({ persona: body.persona }))
  })

  await page.route('**/api/centers', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      name: string
      brandColor: string | null
    }
    state.center = { id: 'center-e2e', shortCode: 'e2e-center' }
    state.step = state.persona === 'solo_teacher' ? 'solo_first_class' : 'template'
    await route.fulfill(
      jsonEnvelope(
        {
          id: state.center.id,
          name: body.name,
          shortCode: state.center.shortCode,
          brandColor: body.brandColor ?? 'slate',
          logoUrl: null,
          timezone: 'Asia/Ho_Chi_Minh',
          role: 'owner',
          accessToken: 'fresh.jwt.with-center-claim',
          expiresAt: '2026-07-12T15:15:00.000Z',
        },
        201,
      ),
    )
  })

  await page.route('**/api/templates', async (route: Route) => {
    await route.fulfill(
      jsonEnvelope({
        templates: [
          {
            id: TEMPLATE_ID,
            name: 'Writing Bootcamp 6.5',
            targetBand: '6.5',
            primarySkill: 'writing',
            sessionCount: 12,
            color: null,
            scope: 'system',
          },
        ],
      }),
    )
  })

  await page.route(SPAWN_ENDPOINT_RE, async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      templateId: string
      classes: Array<{
        cohortName: string
        startDate: string
        teacherEmail: string | null
      }>
    }
    overrides.onSpawnRequest?.(body)
    state.step = 'done'
    await route.fulfill(
      jsonEnvelope(
        {
          classes: body.classes.map((c, idx) => ({
            id: `class-${idx}`,
            cohortName: c.cohortName,
            teacherEmail: c.teacherEmail,
            teacherAssignmentReason:
              state.persona === 'founder' && idx === 0 && c.teacherEmail === null
                ? 'founder_auto'
                : c.teacherEmail === null
                  ? 'unassigned'
                  : 'invited',
          })),
        },
        201,
      ),
    )
  })

  return () => ({ persona: state.persona, step: state.step })
}

const DEFAULT_USER: TestUser = {
  id: 'user-e2e',
  email: 'e2e@classlite.test',
  displayName: 'E2E User',
  emailVerified: true,
}

async function pickPersonaAndCenter(
  page: Page,
  persona: Persona,
  centerName: string,
): Promise<void> {
  await page.goto('/welcome')
  await expect(page).toHaveURL(/\/welcome/)
  const personaName =
    persona === 'operator'
      ? /Operator|Người điều hành/i
      : persona === 'founder'
        ? /Founder|Người sáng lập/i
        : /Solo Teacher|Giáo viên độc lập/i
  await page.getByRole('radio', { name: personaName }).click()
  await page.getByRole('button', { name: /Continue/i }).click()

  await expect(page).toHaveURL(/\/setup\/center/)
  await page.getByLabel(/Center name/i).fill(centerName)
  await page.getByRole('button', { name: /Save.*continue/i }).click()
}

test.describe('Story 2-3b happy path — Operator/Founder', () => {
  test('Operator: /setup/template → pick template → /setup/spawn → 1 class → /setup/done', async ({
    page,
  }) => {
    await stubOnboardingBackend(page, DEFAULT_USER)
    await pickPersonaAndCenter(page, 'operator', 'Smoke Center EN')

    await expect(page).toHaveURL(/\/setup\/template/)
    await expect(
      page.getByRole('heading', { name: /Choose a template/i }),
    ).toBeVisible()

    await page.getByRole('radio', { name: /Writing Bootcamp 6\.5/i }).click()
    await expect(page.getByTestId('template-preview-drawer')).toBeVisible()
    await page
      .getByTestId('template-preview-drawer')
      .getByRole('button', { name: /Continue/i })
      .click()

    await expect(page).toHaveURL(/\/setup\/spawn/)
    await expect(
      page.getByRole('heading', { name: /Create your first classes/i }),
    ).toBeVisible()

    await page.getByLabel(/Cohort name/i).fill('Smoke Cohort A')
    await page.getByLabel(/Start date/i).fill('2026-07-15')
    await page.getByRole('button', { name: /Save & spawn/i }).click()

    await expect(page).toHaveURL(/\/setup\/done/)
  })

  test('Founder: row 0 star + wire submits null teacherEmail (Winston-W4)', async ({
    page,
  }) => {
    // R1-C1-P3 — capture the exact spawn POST body. Route regex is scoped
    // to `/api/templates/{id}/spawn` (no substring `/spawn` matches on
    // arbitrary future endpoints).
    let capturedSpawnBody: {
      templateId: string
      classes: Array<{
        cohortName: string
        startDate: string
        teacherEmail: string | null
      }>
    } | null = null
    await stubOnboardingBackend(page, DEFAULT_USER, false, {
      onSpawnRequest: (body) => {
        capturedSpawnBody = body
      },
    })
    await pickPersonaAndCenter(page, 'founder', 'Smoke Founder Center')

    await expect(page).toHaveURL(/\/setup\/template/)
    await page.getByRole('radio', { name: /Writing Bootcamp 6\.5/i }).click()
    await page
      .getByTestId('template-preview-drawer')
      .getByRole('button', { name: /Continue/i })
      .click()

    await expect(page).toHaveURL(/\/setup\/spawn/)
    await expect(page.getByText(/You'll teach this one/i)).toBeVisible()

    await page.getByLabel(/Cohort name/i).fill('Founders First')
    await page.getByLabel(/Start date/i).fill('2026-07-15')
    await page.getByRole('button', { name: /Save & spawn/i }).click()

    await expect(page).toHaveURL(/\/setup\/done/)
    // Winston-W4 wire-null assertion — display shows the Founder pill but
    // the payload MUST carry null so the server returns `founder_auto`.
    expect(capturedSpawnBody).not.toBeNull()
    expect(capturedSpawnBody!.classes[0].teacherEmail).toBeNull()
  })
})

test.describe('Story 2-3b happy path — Solo Teacher', () => {
  test('Solo: persona → /setup/center → SINGLE navigate to /setup/first-class (Amelia-B3/B4)', async ({
    page,
  }) => {
    await stubOnboardingBackend(page, DEFAULT_USER)
    await pickPersonaAndCenter(page, 'solo_teacher', 'Smoke Solo Center')

    // Amelia-B3/B4 amendment — Solo lands DIRECTLY on /setup/first-class,
    // not via /setup/template detour.
    await expect(page).toHaveURL(/\/setup\/first-class/)
    await expect(
      page.getByRole('heading', { name: /Create your first class/i }),
    ).toBeVisible()

    // AssignChip composer trigger MUST NOT exist (locked to self).
    await expect(
      page.getByRole('button', { name: /Assign or invite a teacher/i }),
    ).toHaveCount(0)

    // Sally-S6 — template ribbon visible on load.
    await expect(page.getByTestId('solo-template-ribbon')).toBeVisible()
    await page
      .getByTestId('solo-template-ribbon')
      .getByRole('radio')
      .first()
      .click()

    await page.getByLabel(/Cohort name/i).fill('Solo First')
    await page.getByLabel(/Start date/i).fill('2026-07-15')
    await page.getByRole('button', { name: /Create my first class/i }).click()

    await expect(page).toHaveURL(/\/setup\/done/)
  })

  test('Solo: AssignChip composer trigger absent; locked pill shows displayName', async ({
    page,
  }) => {
    await stubOnboardingBackend(page, DEFAULT_USER)
    await pickPersonaAndCenter(page, 'solo_teacher', 'Smoke Solo AC5')

    await expect(page).toHaveURL(/\/setup\/first-class/)
    await expect(
      page.getByRole('button', { name: /Assign or invite a teacher/i }),
    ).toHaveCount(0)
    // R1-C1-P21 — pill interpolates `displayName ?? email ?? 'You'`; the
    // stubbed user's displayName is what actually renders. Fabricated
    // `fullName` was the prior spec's assertion target and never appeared
    // in the DOM.
    await expect(page.getByText(DEFAULT_USER.displayName)).toBeVisible()
  })
})
