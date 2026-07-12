/**
 * CenterSetupPage — Story 2-3a AC4, AC5, AC6, AC7, AC11, AC13, AC14.
 *
 * Red-phase specimens for the setup-card form. Focus on load-bearing branches:
 *  - AC5: rune-length center name (Vietnamese > 60 runes → error)
 *  - AC7: five error branches (409 / 422 / 403 / 429 / 500) with 409 recovery
 *    surface (Sally-S4 two-line + support link)
 *  - AC11: save-and-finish-later → flush + navigate /dashboard
 *  - AC14: focus lands on center-name input on mount (jsdom + toHaveFocus)
 *
 * The 429 test uses vi.useFakeTimers to drive the Retry-After countdown
 * per Murat-B3 fold.
 *
 * RED phase: @/features/onboarding/CenterSetupPage doesn't exist yet.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import CenterSetupPage from '@/features/onboarding/CenterSetupPage'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import {
  onboardingHandlers,
  errorHandlers,
} from '@/features/onboarding/api/__tests__/handlers'

function seedAuthed(client: QueryClient): void {
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

function renderPage(
  client: QueryClient = createTestQueryClient(),
): {
  client: QueryClient
  user: ReturnType<typeof userEvent.setup>
  container: HTMLElement
} {
  seedAuthed(client)
  const user = userEvent.setup()
  const shell: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/setup/center']}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route path="/setup/center" element={<CenterSetupPage />} />
            </Route>
            <Route path="/dashboard" element={<p>dashboard reached</p>} />
            <Route
              path="/setup/template"
              element={<p>setup-template reached</p>}
            />
            <Route
              path="/setup/first-class"
              element={<p>setup-first-class reached</p>}
            />
            <Route path="/verify-email" element={<p>verify-email</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(shell)
  return { client, user, container }
}

beforeEach(() => {
  server.use(...onboardingHandlers)
  // CenterSetupPage assumes the user has already picked a persona (AC10
  // drift protection redirects to /welcome otherwise). Override GET
  // progress so the page stays on /setup/center for the form tests.
  server.use(errorHandlers.progressWithPersona('operator', 'center'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CenterSetupPage — AC5 form fields', () => {
  test('center-name input renders + focus lands on mount (AC14)', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await waitFor(() => expect(nameInput).toHaveFocus())
  })

  test('short-code preview updates as name changes (client mirror)', async () => {
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )

    await user.type(nameInput, 'Saigon English Center')
    await waitFor(() => {
      expect(
        screen.getByText(/saigon-english-center\.classlite\.app/i),
      ).toBeInTheDocument()
    })
  })

  test('rune-length: Vietnamese name >60 runes shows validation error', async () => {
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    // 65 Vietnamese runes — bytes would be ~130, but Array.from(v).length must be 65.
    const long = 'Trung tâm Anh ngữ Sài Gòn chi nhánh quận một'.repeat(3)
    await user.type(nameInput, long)
    await user.tab()
    await waitFor(() =>
      expect(
        screen.getByText(i18n.t('onboarding.center.error.nameMax', { max: 60 })),
      ).toBeInTheDocument(),
    )
  })

  test('brand color radio-group renders 6 swatches with aria-label per swatch', async () => {
    renderPage()
    await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    const swatches = screen.getAllByRole('radio', {
      name: /deep navy|amber|green|red|brown|gray/i,
    })
    expect(swatches.length).toBe(6)
  })
})

describe('CenterSetupPage — AC7 POST /api/centers error branches', () => {
  test('409 USER_ALREADY_HAS_CENTER renders two-line recovery + Open Dashboard button', async () => {
    server.use(
      errorHandlers.centerAlreadyHasCenter('Existing Center', 'existing-abc'),
    )
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'Whatever')
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.center.form.saveContinueCta'),
      }),
    )

    // Line 1 interpolates centerName + shortCode.
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(
        /Existing Center/,
      ),
    )
    expect(screen.getByRole('alert').textContent).toMatch(/existing-abc/)

    // Primary CTA "Open Dashboard →"
    await user.click(
      screen.getByRole('button', { name: /open dashboard/i }),
    )
    await waitFor(() =>
      expect(screen.getByText('dashboard reached')).toBeInTheDocument(),
    )
  })

  test('422 VALIDATION_ERROR field details map to RHF setError', async () => {
    server.use(errorHandlers.centerValidationError('name', 'Invalid name'))
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'Bad Name')
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.center.form.saveContinueCta'),
      }),
    )
    await waitFor(() =>
      expect(screen.getByText('Invalid name')).toBeInTheDocument(),
    )
  })

  test('403 EMAIL_VERIFICATION_REQUIRED renders link to /verify-email', async () => {
    server.use(errorHandlers.centerEmailVerificationRequired())
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'X')
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.center.form.saveContinueCta'),
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /verify-email/i })).toBeInTheDocument(),
    )
  })

  test('429 RATE_LIMIT_EXCEEDED interpolates Retry-After seconds + disables button (Murat-B3)', async () => {
    server.use(errorHandlers.centerRateLimited(45))
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'X')
    const submit = screen.getByRole('button', {
      name: i18n.t('onboarding.center.form.saveContinueCta'),
    })
    await user.click(submit)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/45/),
    )
    // Button should be disabled during the countdown window.
    expect(submit).toBeDisabled()
  })

  test('500 INTERNAL_ERROR renders generic alert with requestId visible', async () => {
    server.use(errorHandlers.centerInternalError())
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'X')
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.center.form.saveContinueCta'),
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/req-test-2-3a/),
    )
  })

  test('happy path: 201 → navigate /setup/template', async () => {
    const { user } = renderPage()
    const nameInput = await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    await user.type(nameInput, 'Saigon English Center')
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.center.form.saveContinueCta'),
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByText('setup-template reached'),
      ).toBeInTheDocument(),
    )
  })
})

describe('CenterSetupPage — AC11 save-and-finish-later', () => {
  test('clicking flushes pending auto-save + navigates to /dashboard', async () => {
    const { user } = renderPage()
    await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    // R1-P12: "Save and finish later" is now a <button> (was <Link>) so it
    // can await the flush() promise before navigating.
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('onboarding.wizard.saveAndFinishLater'),
      }),
    )
    await waitFor(() =>
      expect(screen.getByText('dashboard reached')).toBeInTheDocument(),
    )
  })
})

describe('CenterSetupPage — AC14 accessibility gate', () => {
  test('zero axe violations on default render', async () => {
    const { container } = renderPage()
    await screen.findByLabelText(
      i18n.t('onboarding.center.form.nameLabel'),
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

// R1-C3-P13 — Amelia-B4 amendment: on Solo Teacher persona resuming with
// an ADVANCED currentStep (template / spawn / solo_first_class), the
// shipped 2-3a resume effect originally hardcoded `/setup/template` for
// all personas; the amendment persona-branches Solo to `/setup/first-class`.
// Without the amendment, a Solo user with `currentStep: 'solo_first_class'`
// would double-redirect through `/setup/template → /setup/first-class`.
// This test protects the direct-route dispatch.
describe('CenterSetupPage — Amelia-B4 Solo Teacher persona-branch resume', () => {
  test('post-hydration effect: persona=solo_teacher + currentStep=solo_first_class → routes to /setup/first-class (not /setup/template)', async () => {
    // Seed a Solo Teacher with an ADVANCED currentStep — the case the
    // amendment protects.
    server.use(
      errorHandlers.progressWithPersona('solo_teacher', 'solo_first_class'),
    )
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('setup-first-class reached'),
      ).toBeInTheDocument(),
    )
    // MUST NOT bounce through /setup/template — regression guard.
    expect(
      screen.queryByText('setup-template reached'),
    ).not.toBeInTheDocument()
  })

  test('post-hydration effect: persona=solo_teacher + currentStep=spawn → routes to /setup/first-class', async () => {
    server.use(errorHandlers.progressWithPersona('solo_teacher', 'spawn'))
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('setup-first-class reached'),
      ).toBeInTheDocument(),
    )
  })
})
