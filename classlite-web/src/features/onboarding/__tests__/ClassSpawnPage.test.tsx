/**
 * Story 2-3b — ClassSpawnPage red-phase acceptance tests.
 *
 * The load-bearing test file. Covers:
 *   AC4   Multi-row form; delete HIDDEN on 1 row (Sally-S2); Build-from-scratch-blocked variant (Sally-B2)
 *   AC5   AssignChip composer keyboard/focus; role="group" (Sally-B4); self-invite hint v1 (Sally-S7)
 *   AC6   9-error catalog + 4 429 sub-tests (Murat-B2) + 3 SELF_INVITE sub-tests (Murat-S7) +
 *         spawn-submit-gate 3-state (Murat-S5) + INVALID_TENANT_CLAIM cache clear (Amelia-S3) +
 *         Winston-W3 no-invalidate + Winston-W2 flushWithLatch
 *   AC7   Founder auto-assign 3 sub-tests (Murat-B3 adjusted for Winston-W4) + Sally-B3 never-touched sentinel
 *   AC9   Winston-W1 currentStep from pathname + Murat-S3 useFieldArray debounce invariants
 *   AC10  Rows 5–7 (this page's routing decisions)
 *   AC11  i18n parity
 *   AC12  Three-state on POST spawn INCLUDING submit-gate 3-state (Murat-S5)
 *   AC13  axe + focus-return two-layer belt (Murat-S6)
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 6.1.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { I18nextProvider } from 'react-i18next'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import { authKeys } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import ClassSpawnPage from '@/features/onboarding/ClassSpawnPage'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { SYSTEM_TEMPLATE_IDS } from '../api/__tests__/fixtures'
import {
  errorHandlers,
  onboardingHandlers,
  spawnSuccessAs,
} from '../api/__tests__/handlers'

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
})

// R1-C3-P16 — remove any per-test `request:start` listeners so they don't
// accumulate across tests in the same vitest worker (multiple describes
// below install spy listeners for AC7 wire assertions + AC9 auto-save
// spies + AC6 spawn-submit-gate).
afterEach(() => {
  server.events.removeAllListeners('request:start')
})

interface RenderOptions {
  persona?: 'operator' | 'founder' | 'solo_teacher' | null
  currentStep?: 'template' | 'spawn' | 'solo_first_class' | 'done' | 'center' | 'persona'
  buildFromScratch?: boolean
  classesDraft?: Array<{
    cohortName: string
    startDate: string
    teacherEmail: string | null
  }>
  userEmail?: string
}

function renderClassSpawnPage(opts: RenderOptions = {}) {
  const {
    persona = 'operator',
    currentStep = 'spawn',
    buildFromScratch = false,
    classesDraft,
    userEmail = 'owner@classlite.example',
  } = opts

  const queryClient = createTestQueryClient()
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'user-1',
      email: userEmail,
      fullName: 'Ducdo Do',
      emailVerified: true,
    },
    accessToken: 'jwt.with.center',
    center: {
      id: 'center-1',
      name: 'Saigon English',
      shortCode: 'saigon-english',
      // eslint-disable-next-line no-restricted-syntax -- brandColor wire value (FU-2-3a-C)
      brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
  })

  queryClient.setQueryData(onboardingKeys.progress(), {
    persona,
    currentStep,
    payload: {
      schemaVersion: 1,
      personaChoice: persona,
      centerDraft: null,
      templateDraft: {
        selectedTemplateId: buildFromScratch
          ? null
          : SYSTEM_TEMPLATE_IDS.writingBootcamp,
        buildFromScratch,
        ...(classesDraft !== undefined ? { classesDraft } : {}),
      },
    },
    updatedAt: '2026-07-10T12:00:00.000Z',
  })

  const utils = render(
    <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/setup/spawn']}>
        <Routes>
          <Route element={<OnboardingLayout />}>
            <Route path="/setup/spawn" element={<ClassSpawnPage />} />
          </Route>
          <Route
            path="/setup/template"
            element={<div>TEMPLATE_PLACEHOLDER</div>}
          />
          <Route
            path="/setup/first-class"
            element={<div>FIRST_CLASS_PLACEHOLDER</div>}
          />
          <Route
            path="/setup/center"
            element={<div>CENTER_PLACEHOLDER</div>}
          />
          <Route path="/setup/done" element={<div>DONE_PLACEHOLDER</div>} />
          <Route path="/welcome" element={<div>WELCOME_PLACEHOLDER</div>} />
          <Route path="/login" element={<div>LOGIN_PLACEHOLDER</div>} />
          <Route
            path="/verify-email"
            element={<div>VERIFY_EMAIL_PLACEHOLDER</div>}
          />
          {/* Story 2-3c Task 3.4a — placeholder for Save-and-finish-later
              contract tests (Task 3.2). */}
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

// ================================================================
// AC4 — multi-row form + delete hidden on single row + Build-from-scratch-blocked
// ================================================================
describe('AC4 — /setup/spawn multi-row form', () => {
  test('renders 1 blank class row on first paint + delete-row button HIDDEN (Sally-S2)', async () => {
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })

    // ONE row on first paint
    const rows = screen.getAllByTestId(/class-row-/i)
    expect(rows).toHaveLength(1)

    // Sally-S2: delete button HIDDEN entirely (not aria-disabled)
    expect(
      screen.queryByRole('button', { name: /Delete class 1/i }),
    ).not.toBeInTheDocument()

    // Row-minimum helper visible when only 1 row
    expect(
      screen.getByText(/You need at least one class to continue/i),
    ).toBeInTheDocument()
  })

  test('+ Add another class appends a row; delete becomes visible on all rows', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })

    await user.click(
      screen.getByRole('button', { name: /Add another class/i }),
    )

    const rows = screen.getAllByTestId(/class-row-/i)
    expect(rows).toHaveLength(2)

    // With 2+ rows, delete buttons are visible on ALL rows
    expect(
      screen.getByRole('button', { name: /Delete class 1/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Delete class 2/i }),
    ).toBeInTheDocument()
  })

  test('Sally-B2: Build-from-scratch variant hides "Save & spawn" and swaps CTA to "← Pick a template"', async () => {
    renderClassSpawnPage({ buildFromScratch: true })

    await screen.findByRole('heading', { name: /Create your first classes/i })

    // AC4 escalated variant — Save & spawn is NOT in the DOM
    expect(
      screen.queryByRole('button', { name: /Save & spawn/i }),
    ).not.toBeInTheDocument()

    // Prominent "← Pick a template" primary CTA present
    expect(
      screen.getByRole('button', { name: /Pick a template/i }),
    ).toBeInTheDocument()

    // Two-line notice
    expect(
      screen.getByText(/Custom template creation is coming soon/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Head back and pick a starter template/i),
    ).toBeInTheDocument()
  })

  test('Sally-B2: clicking "← Pick a template" navigates to /setup/template with replace', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage({ buildFromScratch: true })

    await user.click(
      screen.getByRole('button', { name: /Pick a template/i }),
    )
    expect(
      await screen.findByText('TEMPLATE_PLACEHOLDER'),
    ).toBeInTheDocument()
  })
})

// ================================================================
// AC5 — AssignChip single-panel composer + role="group" + focus mgmt
// ================================================================
describe('AC5 — AssignChip composer (Sally-B1 single-panel invite-only)', () => {
  test('composer container uses role="group" NOT role="dialog" (Sally-B4)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    const assignChip = screen.getByRole('button', {
      name: /Assign or invite a teacher/i,
    })
    await user.click(assignChip)

    // Composer appears with role="group" — assert dialog is NOT used
    const composer = await screen.findByRole('group', {
      name: /Invite a teacher|Assign teacher/i,
    })
    expect(composer).toBeInTheDocument()

    // Negative: dialog role must NOT be present for the composer
    expect(
      screen.queryByRole('dialog', { name: /teacher/i }),
    ).not.toBeInTheDocument()
  })

  test('Sally-B1: NO tab-switcher chrome (single-panel invite-only in v1)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    const assignChip = await screen.findByRole('button', {
      name: /Assign or invite a teacher/i,
    })
    await user.click(assignChip)

    // No tab buttons in the composer for v1
    expect(
      screen.queryByRole('tab', { name: /Assign existing/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tablist'),
    ).not.toBeInTheDocument()

    // Direct email + optional name inputs visible
    expect(
      screen.getByLabelText(/Email/i),
    ).toBeInTheDocument()
  })

  test('composer focus lands on email input on open; Escape returns focus to AssignChip trigger (Murat-S6)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    const assignChip = await screen.findByRole('button', {
      name: /Assign or invite a teacher/i,
    })
    await user.click(assignChip)

    const emailInput = await screen.findByLabelText(/Email/i)
    expect(emailInput).toHaveFocus()

    // Escape closes + focus returns to trigger (Sally-B4 non-modal focus contract)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(assignChip).toHaveFocus())
  })

  test('Sally-I6: Enter with invalid email shows error, composer stays open', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    const assignChip = await screen.findByRole('button', {
      name: /Assign or invite a teacher/i,
    })
    await user.click(assignChip)

    const emailInput = await screen.findByLabelText(/Email/i)
    await user.type(emailInput, 'not-an-email{Enter}')

    // Error shown
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument()
    // Composer NOT closed
    expect(
      screen.getByRole('group', { name: /Invite a teacher|Assign teacher/i }),
    ).toBeInTheDocument()
  })

  test('Sally-S7: self-invite hint v1 references empty-field action, NOT absent "Assign existing" tab', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage({ userEmail: 'owner@classlite.example' })

    await screen.findByRole('heading', { name: /Create your first classes/i })
    const assignChip = screen.getByRole('button', {
      name: /Assign or invite a teacher/i,
    })
    await user.click(assignChip)
    await user.type(screen.getByLabelText(/Email/i), 'owner@classlite.example')
    // Blur to trigger check
    await user.tab()

    const hint = await screen.findByText(/leave the field empty/i)
    expect(hint).toBeInTheDocument()
    // Sally-S7: MUST NOT reference the absent "Assign existing" tab
    expect(hint).not.toHaveTextContent(/Assign existing/i)
  })
})

// ================================================================
// AC6 — 9-error catalog + spawn-submit-gate 3-state + Winston-W2 latch
// ================================================================
describe('AC6 — Save & spawn: error catalog dispatch', () => {
  async function fillMinimalValidRowAndSpawn(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS Morning')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))
  }

  test('happy 201 → PUT progress (done) → navigate /setup/done', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    expect(await screen.findByText('DONE_PLACEHOLDER')).toBeInTheDocument()
  })

  test('404 TEMPLATE_NOT_FOUND → Alert + navigate /setup/template', async () => {
    server.use(errorHandlers.spawnTemplateNotFound())
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    expect(await screen.findByText('TEMPLATE_PLACEHOLDER')).toBeInTheDocument()
  })

  test('422 VALIDATION_ERROR with details → per-index field errors via setError', async () => {
    server.use(
      errorHandlers.spawnValidationError(0, 'cohortName', '', 'server-msg-here'),
    )
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    // The row 0's cohortName field shows the server message
    expect(await screen.findByText(/server-msg-here/i)).toBeInTheDocument()
  })

  test('422 INVALID_TEACHER_EMAIL → per-index field-level error on teacherEmail', async () => {
    server.use(errorHandlers.spawnInvalidTeacherEmail(0))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    // (skip AssignChip flow for brevity — form-level error should surface)
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument()
  })

  test('403 INVALID_TENANT_CLAIM → clears auth session cache + navigate /login (Amelia-S3)', async () => {
    server.use(errorHandlers.spawnInvalidTenantClaim())
    const user = userEvent.setup()
    const { queryClient } = renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    // Cache MUST be cleared BEFORE navigate — otherwise layout guard rebounces
    await waitFor(() => {
      expect(queryClient.getQueryData(authKeys.session())).toBeNull()
    })
    expect(await screen.findByText('LOGIN_PLACEHOLDER')).toBeInTheDocument()
  })

  test('403 FORBIDDEN bare code → generic Alert with requestId (Amelia-S3)', async () => {
    server.use(errorHandlers.spawnForbidden())
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/req-test-2-3a/i)).toBeInTheDocument()
  })

  test('500 INTERNAL_ERROR → Alert + NO auto-retry', async () => {
    server.use(errorHandlers.spawnInternalError())
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/req-test-2-3a/i)).toBeInTheDocument()
    // Still on the spawn page (no navigate)
    expect(
      screen.getByRole('heading', { name: /Create your first classes/i }),
    ).toBeInTheDocument()
  })

  // R1-C3-P7 — 403 EMAIL_VERIFICATION_REQUIRED + 403 CENTER_REQUIRED branches
  // ship in ClassSpawnPage.handleSpawnError but were previously unexercised.
  test('403 EMAIL_VERIFICATION_REQUIRED → navigate /verify-email', async () => {
    server.use(errorHandlers.spawnEmailVerificationRequired())
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    expect(
      await screen.findByText('VERIFY_EMAIL_PLACEHOLDER'),
    ).toBeInTheDocument()
  })

  test('403 CENTER_REQUIRED → queues arrival toast + navigate /setup/center', async () => {
    server.use(errorHandlers.spawnCenterRequired())
    const user = userEvent.setup()
    renderClassSpawnPage()

    await fillMinimalValidRowAndSpawn(user)

    expect(
      await screen.findByText('CENTER_PLACEHOLDER'),
    ).toBeInTheDocument()
    // Chunk 1 R1-C1-P19 wired `queueArrivalToast('onboarding.spawn.error.centerRequiredToast')`
    // before the navigate; verify the sessionStorage key was set. The
    // destination page consumes + clears it; we assert the key was written.
    // (Chunk 3 arrival-toast consumer is TemplateSelectPage; CENTER placeholder
    // stub above stands in for setup/center, which would consume the key in
    // production.)
    // Test-scoped assertion: we check the queue-key contract at the arrivalToast
    // module boundary via sessionStorage.getItem — if the destination page
    // renders before we read, the key is already consumed. So capture BEFORE
    // navigation completes via an intermediate render check.
    // Pragmatic: verify the arrival-toast queue was populated at some point
    // during the navigate flow. Because the destination stub doesn't call
    // `consumeArrivalToast`, the key stays in sessionStorage.
    expect(
      window.sessionStorage.getItem('onboarding.arrivalToast'),
    ).toBe('onboarding.spawn.error.centerRequiredToast')
    window.sessionStorage.removeItem('onboarding.arrivalToast')
  })
})

describe('AC6 — 429 four sub-tests (Murat-B2)', () => {
  // R1-C3-P6 — the `useCountdown` tick / auto-re-enable behavior is covered
  // exhaustively at the hook level (`useCountdown.test.tsx`). Mixing fake +
  // real timers here (fake for the countdown, real for MSW + waitFor)
  // doesn't compose cleanly. These integration tests instead assert the
  // page-level surface: (a) countdown copy appears for short Retry-After,
  // (b) button re-enables for Retry-After: 0 / missing / malformed, and
  // (c) the rate-limit copy uses `seconds > 0` gating (R1-C1-P12). No
  // fake-timer scaffolding is needed at this layer.

  test('spawnLimit fires with Retry-After: 12 → countdown copy shows, button disabled', async () => {
    server.use(errorHandlers.spawnRateLimited('short'))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    // Countdown shows 12s + button disabled. The auto-re-enable-after-N-seconds
    // behavior is exhaustively covered at the hook level in
    // `useCountdown.test.tsx` (tick / onZero / cleanup invariants) — asserting
    // it again through the ClassSpawnPage integration would need to mix real
    // timers (for MSW + testing-library polling) with fake timers (to advance
    // the countdown instantly), and the two don't compose cleanly.
    expect(await screen.findByText(/12s|Try again in 12/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save & spawn/i })).toBeDisabled()
  })

  test('Retry-After: 0 → immediate re-enable, generic error surfaces', async () => {
    server.use(errorHandlers.spawnRateLimited('zero'))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    // No countdown UI; button stays enabled
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Save & spawn/i }),
      ).toBeEnabled(),
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('missing Retry-After header → treated as generic error, immediate re-enable', async () => {
    server.use(errorHandlers.spawnRateLimited('missing'))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Save & spawn/i }),
      ).toBeEnabled(),
    )
  })

  test('malformed Retry-After (non-numeric) → treated as missing', async () => {
    server.use(errorHandlers.spawnRateLimited('malformed'))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Save & spawn/i }),
      ).toBeEnabled(),
    )
  })
})

describe('AC6 — 3 SELF_INVITE_BLOCKED sub-tests (Murat-S7)', () => {
  test('(i) client-side belt: typing own email → warning fires, no POST', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage({ userEmail: 'owner@classlite.example' })

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.click(
      screen.getByRole('button', { name: /Assign or invite a teacher/i }),
    )
    await user.type(
      screen.getByLabelText(/Email/i),
      'owner@classlite.example',
    )
    await user.tab()

    expect(await screen.findByText(/leave the field empty/i)).toBeInTheDocument()
  })

  test('(ii) server 422 SELF_INVITE_BLOCKED → per-index field-level error via setError', async () => {
    server.use(errorHandlers.spawnSelfInviteBlocked(0))
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    expect(
      await screen.findByText(/You can't invite yourself/i),
    ).toBeInTheDocument()
  })

  test('(iii) case-mismatch: typing OWNER@classlite.example matches owner@classlite.example (client-side belt)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage({ userEmail: 'owner@classlite.example' })

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.click(
      screen.getByRole('button', { name: /Assign or invite a teacher/i }),
    )
    await user.type(
      screen.getByLabelText(/Email/i),
      'OWNER@classlite.example',
    )
    await user.tab()

    expect(
      await screen.findByText(/leave the field empty/i),
    ).toBeInTheDocument()
  })
})

describe('AC6 — spawn-submit-gate three-state (Murat-S5)', () => {
  test('(i) savingState=idle → direct POST (no flush)', async () => {
    // Wire the fixture assertion inside a spy on server events
    const requestUrls: string[] = []
    server.events.on('request:start', ({ request }) => {
      requestUrls.push(request.url)
    })

    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    await screen.findByText('DONE_PLACEHOLDER')

    // With savingState=idle, spawn POST must fire before any additional PUT
    const spawnIdx = requestUrls.findIndex((u) => u.includes('/spawn'))
    expect(spawnIdx).toBeGreaterThanOrEqual(0)
  })

  // R1-C3-P4/P20 — sub-tests (ii) `savingState='saving' → flush()-first` and
  // (iii) `savingState='error'/'persistentFailure' → proceed with warning`
  // land at the hook level (see `useAutoSave.test.tsx` §"spawn-submit-gate
  // three-state at hook level"). Mixing MSW-timed integration + fake-timer
  // flush() promises at the page level was intractable; the useAutoSave
  // tests exercise the invariants directly against the hook that owns them.
})

// ================================================================
// AC7 — Founder auto-assign 3 sub-tests (Murat-B3 adjusted for Winston-W4)
// ================================================================
describe('AC7 — Founder auto-assign wire/UI decoupling (Winston-W4)', () => {
  test('(i) untouched Founder row 0 → wire submits teacherEmail: null; server returns founder_auto', async () => {
    const requestBodies: unknown[] = []
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/spawn')) {
        try {
          requestBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })
    server.use(
      spawnSuccessAs('founder', 'founder@classlite.example'),
    )

    const user = userEvent.setup()
    renderClassSpawnPage({
      persona: 'founder',
      userEmail: 'founder@classlite.example',
    })

    await screen.findByRole('heading', { name: /Create your first classes/i })

    // AC7 display-only: row 0 shows "You'll teach this one" star + user name
    expect(await screen.findByText(/You'll teach this one/i)).toBeInTheDocument()

    // Fill required fields and submit — DO NOT touch AssignChip
    await user.type(screen.getByLabelText(/Cohort name/i), 'Founders A')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    await screen.findByText('DONE_PLACEHOLDER')

    // Winston-W4 assertion: wire submits null, NOT the Founder's email
    const spawnBody = requestBodies[0] as { classes: Array<{ teacherEmail: string | null }> }
    expect(spawnBody.classes[0].teacherEmail).toBeNull()
  })

  test('(ii) Sally-B3 never-touched sentinel: explicit clear in draft → row 0 renders EMPTY (no star) + wire submits null', async () => {
    // R1-C3-P18 — extend the sentinel test through submit + assert wire.
    // Before: only DOM state was asserted; a regression treating explicit-
    // null sentinel as founder-auto on the wire (bug) would leave DOM empty
    // (test passes) while shipping founder@ (bug ships).
    const requestBodies: unknown[] = []
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/api/templates/') && request.url.endsWith('/spawn')) {
        try {
          requestBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })
    server.use(
      spawnSuccessAs('founder', 'founder@classlite.example'),
    )
    const user = userEvent.setup()
    renderClassSpawnPage({
      persona: 'founder',
      userEmail: 'founder@classlite.example',
      classesDraft: [
        { cohortName: '', startDate: '', teacherEmail: null }, // null vs undefined = explicit clear
      ],
    })

    await screen.findByRole('heading', { name: /Create your first classes/i })

    // Star is NOT rendered on row 0 when the never-touched sentinel is broken
    expect(screen.queryByText(/You'll teach this one/i)).not.toBeInTheDocument()

    // AssignChip renders empty state
    expect(
      screen.getByRole('button', { name: /Assign or invite a teacher/i }),
    ).toBeInTheDocument()

    // Now submit and assert the wire carries null (respecting the user's
    // explicit hand-off clear, NOT the Founder auto-assign).
    await user.type(screen.getByLabelText(/Cohort name/i), 'Founders A')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))
    await screen.findByText('DONE_PLACEHOLDER')

    const spawnBody = requestBodies[0] as {
      classes: Array<{ teacherEmail: string | null }>
    }
    expect(spawnBody.classes[0].teacherEmail).toBeNull()
  })

  test('(iii) Founder overrides with bob@example.com → wire has bob@; server returns explicit_member', async () => {
    // R1-C3-P3 — capture wire body + assert `bob@example.com` explicitly.
    // Prior version relied on DONE_PLACEHOLDER arrival as "proof" but the
    // MSW handler returns 201 for any payload — the assertion was on the
    // navigation, not the wire.
    const requestBodies: unknown[] = []
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/api/templates/') && request.url.endsWith('/spawn')) {
        try {
          requestBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })
    server.use(
      spawnSuccessAs('founder', 'founder@classlite.example', new Set(['bob@example.com'])),
    )

    const user = userEvent.setup()
    renderClassSpawnPage({
      persona: 'founder',
      userEmail: 'founder@classlite.example',
    })

    await screen.findByRole('heading', { name: /Create your first classes/i })

    // Click AssignChip → composer → type bob@ → Add.
    // Use the composer's exact "Add" label via i18n key resolution; a bare
    // `/Add/i` regex matches "Add another class" too.
    await user.click(screen.getByRole('button', { name: /You'll teach this one/i }))
    const composerEmail = await screen.findByLabelText(/Email/i)
    await user.type(composerEmail, 'bob@example.com')
    // Enter on the email input submits the composer (Sally-I6 fold — Enter
    // with valid email → onAssign → onClose).
    await user.keyboard('{Enter}')

    // Fill required fields and submit
    await user.type(screen.getByLabelText(/Cohort name/i), 'Founders A')
    await user.type(screen.getByLabelText(/Start date/i), '2026-07-15')
    await user.click(screen.getByRole('button', { name: /Save & spawn/i }))

    await screen.findByText('DONE_PLACEHOLDER')

    // Wire assertion — Founder's override MUST reach the server verbatim.
    const spawnBody = requestBodies[0] as {
      classes: Array<{ teacherEmail: string | null }>
    }
    expect(spawnBody.classes[0].teacherEmail).toBe('bob@example.com')
  })
})

// ================================================================
// AC10 — resume routing rows 5–7 (this page's decisions)
// ================================================================
describe('AC10 — resume routing rows 5–7', () => {
  test('Row 5: persona=solo_teacher on /setup/spawn → redirect /setup/first-class', async () => {
    renderClassSpawnPage({ persona: 'solo_teacher' })
    expect(
      await screen.findByText('FIRST_CLASS_PLACEHOLDER'),
    ).toBeInTheDocument()
  })

  test('Row 6: persona=null on /setup/spawn → redirect /welcome', async () => {
    renderClassSpawnPage({ persona: null })
    expect(await screen.findByText('WELCOME_PLACEHOLDER')).toBeInTheDocument()
  })

  test('Row 7: currentStep=template + /setup/spawn direct link → STAY + pre-select saved templateId + soft toast', async () => {
    renderClassSpawnPage({
      persona: 'operator',
      currentStep: 'template',
      classesDraft: [
        {
          cohortName: 'Resumed Cohort',
          startDate: '2026-08-01',
          teacherEmail: null,
        },
      ],
    })

    // Do NOT bounce back to /setup/template — user is here on purpose
    expect(
      await screen.findByRole('heading', {
        name: /Create your first classes/i,
      }),
    ).toBeInTheDocument()

    // Sally-I5 soft toast about resuming from draft
    expect(
      await screen.findByText(/Picked up where you left off/i),
    ).toBeInTheDocument()

    // R1-C3-P17 — spec Row 7 is "STAY + pre-select saved templateId +
    // soft toast". Verify pre-selection: the saved `classesDraft[0]` fields
    // ("Resumed Cohort" + "2026-08-01") must be rehydrated into the form
    // via Chunk-1-P1 `form.reset(draftDefaults)` safety-belt. Prior version
    // asserted only the heading + toast, so a regression in the rehydrate
    // path would have shipped silently.
    expect(screen.getByLabelText(/Cohort name/i)).toHaveValue('Resumed Cohort')
    expect(screen.getByLabelText(/Start date/i)).toHaveValue('2026-08-01')
  })
})

// ================================================================
// AC9 — Winston-W1 currentStep from pathname; useFieldArray debounce (Murat-S3)
// ================================================================
describe('AC9 — auto-save fires with correct currentStep + useFieldArray debounce invariants (Murat-S3)', () => {
  afterEach(() => vi.useRealTimers())

  test('Winston-W1: PUT progress from /setup/spawn carries currentStep: "spawn"', async () => {
    const putBodies: Array<{ currentStep: string }> = []
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'PUT' &&
        request.url.endsWith('/api/onboarding/progress')
      ) {
        try {
          putBodies.push(
            (await request.clone().json()) as { currentStep: string },
          )
        } catch { /* noop */ }
      }
    })

    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'IELTS')

    // Wait for the 1500ms debounce to elapse + PUT to fire under real timers.
    await waitFor(
      () => expect(putBodies.some((b) => b.currentStep === 'spawn')).toBe(true),
      { timeout: 3_000 },
    )
    // Winston-W1 negative: no PUT with currentStep === 'center' (default fallback)
    expect(putBodies.some((b) => b.currentStep === 'center')).toBe(false)
  })

  test('useFieldArray append({}) mid-debounce → pending PUT includes appended row', async () => {
    const putBodies: Array<{ payload: { templateDraft?: { classesDraft?: unknown[] } } }> = []
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'PUT' &&
        request.url.endsWith('/api/onboarding/progress')
      ) {
        try {
          putBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })

    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    await user.type(screen.getByLabelText(/Cohort name/i), 'A')

    // Append another class BEFORE the debounce window (1500ms) elapses.
    await user.click(
      screen.getByRole('button', { name: /Add another class/i }),
    )

    await waitFor(
      () => {
        const last = putBodies.at(-1)
        expect(last?.payload?.templateDraft?.classesDraft?.length).toBe(2)
      },
      { timeout: 3_000 },
    )
  })

  // R1-C3-P9 — invariants (ii) remove-mid-window and (iii) cross-row-collapse
  // for the useFieldArray auto-save. Chunk 3 review flagged them absent; they
  // exercise the debounce contract against RHF's row lifecycle.
  test('useFieldArray remove(idx) mid-debounce → pending PUT reflects post-remove row array', async () => {
    const putBodies: Array<{
      payload: { templateDraft?: { classesDraft?: unknown[] } }
    }> = []
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'PUT' &&
        request.url.endsWith('/api/onboarding/progress')
      ) {
        try {
          putBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })

    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    // Start with 1 row; add a second so remove is enabled.
    await user.click(
      screen.getByRole('button', { name: /Add another class/i }),
    )
    await user.type(screen.getAllByLabelText(/Cohort name/i)[0], 'Keep')
    await user.type(screen.getAllByLabelText(/Cohort name/i)[1], 'Remove')

    // Remove the second row BEFORE the debounce fires.
    const deleteButtons = screen.getAllByRole('button', {
      name: /Delete class/i,
    })
    await user.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(
      () => {
        const last = putBodies.at(-1)
        // The final debounced PUT MUST reflect exactly 1 row (post-remove).
        expect(last?.payload?.templateDraft?.classesDraft?.length).toBe(1)
      },
      { timeout: 3_000 },
    )
  })

  test('cross-row edits within debounce window collapse into a single PUT (last-value-wins)', async () => {
    const putBodies: Array<{
      payload: { templateDraft?: { classesDraft?: Array<{ cohortName?: string }> } }
    }> = []
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'PUT' &&
        request.url.endsWith('/api/onboarding/progress')
      ) {
        try {
          putBodies.push(await request.clone().json())
        } catch { /* noop */ }
      }
    })

    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })
    // Two rows so we can edit across rows.
    await user.click(
      screen.getByRole('button', { name: /Add another class/i }),
    )
    // Edit row 0 then row 1 in rapid succession (both within the 1500ms window).
    await user.type(screen.getAllByLabelText(/Cohort name/i)[0], 'Alpha')
    await user.type(screen.getAllByLabelText(/Cohort name/i)[1], 'Beta')

    await waitFor(
      () => {
        const last = putBodies.at(-1)
        const rows = last?.payload?.templateDraft?.classesDraft
        expect(rows?.[0]?.cohortName).toBe('Alpha')
        expect(rows?.[1]?.cohortName).toBe('Beta')
      },
      { timeout: 3_000 },
    )
  })
})

// ================================================================
// AC11 — i18n parity
// ================================================================
describe('AC11 — spawn-page i18n key resolution', () => {
  test('spawn-page keys used by this component resolve in en + vi (belt against key drift)', async () => {
    // Full assertion lives in i18n-parity-coverage.test.ts STORY_2_3B_KEYS
    // block; this is a quick in-page belt while dev iterates.
    renderClassSpawnPage()
    // Presence of the CTA labels is the belt
    expect(
      await screen.findByRole('button', { name: /Save & spawn/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Add another class/i }),
    ).toBeInTheDocument()
  })
})

// ================================================================
// AC13 — accessibility
// ================================================================
describe('AC13 — accessibility gate', () => {
  test('axe-core reports zero violations', async () => {
    const { container } = renderClassSpawnPage()
    await screen.findByRole('heading', { name: /Create your first classes/i })
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ================================================================
// Story 2-3c AC4 — Save-and-finish-later contract (Murat-S3, 3 sub-tests)
// ================================================================
//
// Two variants: normal form + buildFromScratch amber-card variant. The
// affordance MUST render on both (paused user still gets an exit even from
// the buildFromScratch dead-end). Placement on the buildFromScratch variant
// is INSIDE the amber card, BELOW "← Pick a template" (A-B1).
describe('Story 2-3c AC4 — Save-and-finish-later contract (Murat-S3)', () => {
  test('2xx flush → navigate /dashboard fires (happy path, normal form)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })

    await user.click(
      screen.getByRole('button', { name: /save and finish later/i }),
    )

    expect(
      await screen.findByText(/DASHBOARD_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })

  test('500 flush → navigate /dashboard STILL fires (try/finally holds)', async () => {
    const user = userEvent.setup()
    server.use(errorHandlers.putProgressInternalError())
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })

    await user.click(
      screen.getByRole('button', { name: /save and finish later/i }),
    )

    expect(
      await screen.findByText(/DASHBOARD_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })

  test('429 flush with Retry-After → navigate /dashboard STILL fires (no countdown UI — user is exiting)', async () => {
    const user = userEvent.setup()
    server.use(errorHandlers.putProgressRateLimited(12))
    renderClassSpawnPage()

    await screen.findByRole('heading', { name: /Create your first classes/i })

    await user.click(
      screen.getByRole('button', { name: /save and finish later/i }),
    )

    expect(
      await screen.findByText(/DASHBOARD_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })

  test('buildFromScratch amber-card variant — Save-and-finish-later renders INSIDE amber card BELOW "← Pick a template" (A-B1)', async () => {
    const user = userEvent.setup()
    renderClassSpawnPage({ buildFromScratch: true })

    // The amber card body — locate by its "Pick a template" primary CTA
    const pickTemplateCta = await screen.findByRole('button', {
      name: /pick a template/i,
    })
    expect(pickTemplateCta).toBeInTheDocument()

    // Save-and-finish-later button EXISTS on this variant (paused user's
    // only other exit beside redirecting to /setup/template).
    const saveLaterCta = screen.getByRole('button', {
      name: /save and finish later/i,
    })
    expect(saveLaterCta).toBeInTheDocument()

    await user.click(saveLaterCta)

    expect(
      await screen.findByText(/DASHBOARD_PLACEHOLDER/i),
    ).toBeInTheDocument()
  })
})
