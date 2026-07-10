/**
 * Onboarding wizard happy path — Story 2-3a Task 10.4.
 *
 * REQUIRED per Murat-S5 party-mode fold (promoted from OPTIONAL). Catches:
 *  - jsdom-focus-lies — real browser focus semantics on /setup/center mount
 *  - login → wizard integration boundary — the first authenticated surface
 *  - cross-page state carryover — persona selection persists into center step
 *  - Rolldown chunk isolation for /welcome (paired with route-bundle-boundaries.spec.ts)
 *
 * Runs under the `design-system` Playwright project (auto-launches Vite on
 * `localhost:5173` — no backend). `page.route()` stubs the four Story 2.1
 * endpoints + the boot-probe refresh so the wizard behaves as if a verified
 * user just logged in. Boot probe is what hydrates `useAuth`; without the
 * refresh stub the layout guard would bounce us to `/login`.
 */
import { expect, test } from '@playwright/test'

const jsonEnvelope = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    data,
    meta: { serverTime: '2026-07-08T14:23:45.123Z' },
  }),
})

const SERVER_TIME = '2026-07-08T14:23:45.123Z'

test.describe('Onboarding — persona pick + center setup happy path', () => {
  test.beforeEach(async ({ page }) => {
    let progressState: {
      persona: 'operator' | 'founder' | 'solo_teacher' | null
      currentStep:
        | 'persona'
        | 'center'
        | 'template'
        | 'spawn'
        | 'solo_first_class'
        | 'done'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any
      updatedAt: string | null
    } = {
      persona: null,
      currentStep: 'persona',
      payload: null,
      updatedAt: null,
    }

    // Boot-probe refresh — hydrates `useAuth` session cache with a verified
    // user. The layout guard requires this to render the wizard.
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill(
        jsonEnvelope({
          user: {
            id: 'user-e2e',
            email: 'e2e@example.com',
            fullName: 'E2E User',
            emailVerified: true,
          },
          accessToken: 'e2e.jwt.token',
        }),
      )
    })

    await page.route('**/api/onboarding/progress', async (route) => {
      const request = route.request()
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData() ?? '{}') as {
          currentStep: typeof progressState.currentStep
          payload: unknown
        }
        progressState = {
          ...progressState,
          currentStep: body.currentStep,
          payload: body.payload,
          updatedAt: SERVER_TIME,
        }
        await route.fulfill(
          jsonEnvelope({
            currentStep: body.currentStep,
            payload: body.payload,
            updatedAt: SERVER_TIME,
          }),
        )
        return
      }
      await route.fulfill(jsonEnvelope(progressState))
    })

    await page.route('**/api/onboarding/persona', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        persona: 'operator' | 'founder' | 'solo_teacher'
      }
      progressState = { ...progressState, persona: body.persona }
      await route.fulfill(jsonEnvelope({ persona: body.persona }))
    })

    await page.route('**/api/centers', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        name: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        brandColor: any
      }
      await route.fulfill(
        jsonEnvelope(
          {
            id: '11111111-2222-3333-4444-555555555599',
            name: body.name,
            shortCode: 'e2e-center',
            brandColor: body.brandColor,
            logoUrl: null,
            timezone: 'Asia/Ho_Chi_Minh',
            role: 'owner',
            accessToken: 'fresh.jwt.with-center-claim',
            expiresAt: '2026-07-08T14:38:45.123Z',
          },
          201,
        ),
      )
    })
  })

  test('/welcome → persona → Continue → /setup/center → save & continue → /setup/template', async ({
    page,
  }) => {
    await page.goto('/welcome')

    // AC1: 3 persona cards rendered
    await expect(page.getByRole('radio')).toHaveCount(3)

    // AC1 Sally-B1: zero-selection on first paint
    const initiallyChecked = await page
      .getByRole('radio', { checked: true })
      .count()
    expect(initiallyChecked).toBe(0)

    // Continue is disabled until selection
    const continueCta = page.getByRole('button', { name: /Continue/i })
    await expect(continueCta).toBeDisabled()

    // Select Operator (first card)
    await page.getByRole('radio').first().click()
    await expect(continueCta).toBeEnabled()

    // AC3: click Continue → advances to /setup/center
    await continueCta.click()
    await expect(page).toHaveURL(/\/setup\/center/)

    // AC14 (Murat-S5): center-name input has focus on mount — real browser test
    const nameInput = page.getByLabel(/center name/i)
    await expect(nameInput).toBeFocused()

    // AC5: type a name — short-code preview updates live. R1-P32: split
    // the client-preview assertion from the server-response assertion so a
    // silent drift between `slugPreview.ts` and Go's `internal/service/slug.go`
    // cannot pass this test.
    // (a) Client-side preview: what `slugPreview()` renders BEFORE submit.
    await nameInput.fill('Saigon English Center')
    await expect(
      page.getByText('saigon-english-center.classlite.app'),
    ).toBeVisible()

    // AC4: auto-save affordance visible (Sally-B2 idle copy or saved-after-debounce)
    await expect(
      page.getByText(/Auto-save|Auto-saving|Saved|Đã lưu|Tự động lưu/i),
    ).toBeVisible({ timeout: 3000 })

    // AC7 happy path: click Save & continue → /setup/template (2.3b renders NotFound)
    await page
      .getByRole('button', { name: /Save.*continue/i })
      .click()

    await expect(page).toHaveURL(/\/setup\/template/, { timeout: 5000 })
  })
})
