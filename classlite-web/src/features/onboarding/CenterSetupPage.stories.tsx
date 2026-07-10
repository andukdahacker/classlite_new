/**
 * CenterSetupPage stories — Story 2-3a Task 7.7 (R1-P37 backfill).
 *
 * Variants:
 *   Default / WithDraft / Error409 / Error422NameInvalid / Error429 /
 *   Error500 / LocaleVi / LocaleViCramped (Sally-S5 720px viewport).
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` overrides per story.
 * Session cache is seeded via `queryClient.setQueryData(authKeys.session(), ...)`
 * so the OnboardingLayout guard resolves to "authenticated + verified + no
 * center" and mounts this page.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Route, Routes } from 'react-router'
import { HttpResponse, http } from 'msw'
import { queryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import CenterSetupPage from '@/features/onboarding/CenterSetupPage'
import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

function seedAuthenticatedSession() {
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'sb-user',
      email: 'trang@example.com',
      fullName: 'Storybook User',
      emailVerified: true,
    },
    accessToken: 'sb.jwt',
    center: null,
  })
}

const withCenterStepHandlers = [
  http.get('/api/onboarding/progress', () =>
    HttpResponse.json({
      data: {
        persona: 'operator',
        currentStep: 'center',
        payload: null,
        updatedAt: '2026-07-08T14:23:45.123Z',
      },
      meta: { serverTime: '2026-07-08T14:23:45.123Z' },
    }),
  ),
  ...onboardingHandlers.filter(
    (h) =>
      !('info' in h) ||
      (h.info as { path?: string; method?: string }).path !==
        '/api/onboarding/progress',
  ),
]

function SetupCenterRoute() {
  return (
    <Routes>
      <Route element={<OnboardingLayout />}>
        <Route path="/setup/center" element={<CenterSetupPage />} />
      </Route>
    </Routes>
  )
}

const meta = {
  title: 'features/onboarding/CenterSetupPage',
  component: SetupCenterRoute,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/setup/center'] },
    msw: { handlers: withCenterStepHandlers },
  },
  decorators: [
    (Story) => {
      seedAuthenticatedSession()
      return <Story />
    },
  ],
} satisfies Meta<typeof SetupCenterRoute>

export default meta

type Story = StoryObj<typeof meta>

/** Empty form, ready for input. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nameInput = await canvas.findByLabelText(/center name/i)
    await expect(nameInput).toBeTruthy()
  },
}

/** Draft rehydrated from GET progress payload. */
export const WithDraft: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json({
            data: {
              persona: 'operator',
              currentStep: 'center',
              payload: {
                schemaVersion: 1,
                personaChoice: 'operator',
                centerDraft: {
                  name: 'Saigon English Center',
                  // eslint-disable-next-line no-restricted-syntax -- brand-color wire value
                  brandColor: '#d97706',
                  logoUrl: null,
                },
                templateDraft: null,
              },
              updatedAt: '2026-07-08T14:23:45.123Z',
            },
            meta: { serverTime: '2026-07-08T14:23:45.123Z' },
          }),
        ),
        ...onboardingHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nameInput = (await canvas.findByLabelText(/center name/i)) as
      | HTMLInputElement
    await expect(nameInput.value).toBe('Saigon English Center')
  },
}

/** 409 USER_ALREADY_HAS_CENTER — two-line recovery + Open Dashboard CTA. */
export const Error409: Story = {
  parameters: {
    msw: {
      handlers: [
        ...withCenterStepHandlers,
        http.post('/api/centers', () =>
          HttpResponse.json(
            {
              error: {
                code: 'USER_ALREADY_HAS_CENTER',
                message: 'User already has a center',
                requestId: 'req_sb_409',
                details: {
                  centerName: 'Existing Center',
                  shortCode: 'existing-center',
                },
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
}

/** 422 VALIDATION_ERROR — RHF field error surfaces on `name`. */
export const Error422NameInvalid: Story = {
  parameters: {
    msw: {
      handlers: [
        ...withCenterStepHandlers,
        http.post('/api/centers', () =>
          HttpResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                requestId: 'req_sb_422',
                details: [
                  {
                    field: 'name',
                    message:
                      'Center name can only contain letters, digits, spaces, hyphens, apostrophes, and periods.',
                    code: 'INVALID_NAME',
                  },
                ],
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
}

/** 429 RATE_LIMIT_EXCEEDED with Retry-After: 45. */
export const Error429: Story = {
  parameters: {
    msw: {
      handlers: [
        ...withCenterStepHandlers,
        http.post('/api/centers', () =>
          HttpResponse.json(
            {
              error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Rate limit exceeded',
                requestId: 'req_sb_429',
              },
            },
            { status: 429, headers: { 'Retry-After': '45' } },
          ),
        ),
      ],
    },
  },
}

/** 500 INTERNAL_ERROR — generic + visible requestId in Geist Mono. */
export const Error500: Story = {
  parameters: {
    msw: {
      handlers: [
        ...withCenterStepHandlers,
        http.post('/api/centers', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Something went wrong',
                requestId: 'req_sb_500',
              },
            },
            { status: 500 },
          ),
        ),
      ],
    },
  },
}

/** Vietnamese locale — full copy at default viewport. */
export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText(/Đặt tên|Tên trung tâm/i)).toBeTruthy()
  },
}

/**
 * Sally-S5 verification — Vietnamese copy at cramped 720px viewport. Locks
 * the "persona-safe" ~350px card width and ensures Founder-persona headline
 * does not overflow in the tighter Vietnamese layout.
 */
export const LocaleViCramped: Story = {
  globals: { locale: 'vi' },
  parameters: {
    viewport: {
      defaultViewport: 'cramped720',
      viewports: {
        cramped720: {
          name: '720px viewport (Sally-S5)',
          styles: { width: '720px', height: '900px' },
          type: 'desktop',
        },
      },
    },
  },
}
