// storybook-rule: no-three-state
// Route-page / presentational tier (Story 10.3): the data three-state trilogy does not apply.
/**
 * PersonaSelectPage stories — Story 2-3a Task 6.5 (R1-P37 backfill).
 *
 * Variants:
 *   Default / Loading / SavedProgressOperator / SavedProgressFounder /
 *   LocaleVi / Error500.
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` overrides per story.
 * Session cache is seeded into the preview's own client via `SeedSession`
 * so the OnboardingLayout guard resolves to "authenticated + verified + no
 * center" and mounts this page.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Route, Routes } from 'react-router'
import { HttpResponse, delay, http } from 'msw'
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import PersonaSelectPage from '@/features/onboarding/PersonaSelectPage'
import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

const SB_USER = {
  id: 'sb-user',
  email: 'trang@example.com',
  fullName: 'Storybook User',
  emailVerified: true,
}

// Pre-onboarding (no center) → null role.
const NO_CENTER_SESSION: Session = {
  user: SB_USER,
  accessToken: 'sb.jwt',
  center: null,
  role: null,
}

// Center-attached → Owner (AlreadyHasCenter guard branch).
const WITH_CENTER_SESSION: Session = {
  user: SB_USER,
  accessToken: 'sb.jwt',
  center: {
    id: 'center-1',
    name: 'Saigon English Center',
    shortCode: 'saigon-english-center',
    brandColor: null,
    logoUrl: null,
    timezone: 'Asia/Ho_Chi_Minh',
  },
  role: 'owner',
}

// Seed the session into the SAME client the preview provides (NOT the global
// `queryClient` singleton — the preview wraps every story in a fresh
// `createTestQueryClient()`). `useQueryClient()` inside a decorator resolves to
// that client; the lazy `useState` seeds once before the page renders, so
// `useAuth()` reads a populated cache instead of hanging on the skeleton.
// (Story 10.3 — surfaced when page stories became first-class.)
function SeedSession({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}): ReactNode {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(authKeys.session(), session)
    return null
  })
  return children
}

function WelcomeRoute() {
  return (
    <Routes>
      <Route element={<OnboardingLayout />}>
        <Route path="/welcome" element={<PersonaSelectPage />} />
      </Route>
    </Routes>
  )
}

const meta = {
  title: 'features/onboarding/PersonaSelectPage',
  component: WelcomeRoute,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/welcome'] },
    msw: { handlers: onboardingHandlers },
  },
  decorators: [
    (Story) => (
      <SeedSession session={NO_CENTER_SESSION}>
        <Story />
      </SeedSession>
    ),
  ],
} satisfies Meta<typeof WelcomeRoute>

export default meta

type Story = StoryObj<typeof meta>

/** Fresh mount, no persona — zero selection per Sally-B1. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cards = await canvas.findAllByRole('radio')
    await expect(cards.length).toBe(3)
    // Sally-B1: none checked on first paint.
    for (const card of cards) {
      await expect(card.getAttribute('aria-checked')).toBe('false')
    }
  },
}

/** Loading skeleton — MSW handler delays 500ms. */
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', async () => {
          await delay(500)
          return HttpResponse.json({
            data: {
              persona: null,
              currentStep: 'persona',
              payload: null,
              updatedAt: null,
            },
            meta: { serverTime: '2026-07-08T14:23:45.123Z' },
          })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Skeleton visible during delay.
    await expect(
      canvas.getByTestId('skeleton-onboarding'),
    ).toBeTruthy()
  },
}

/** Persona rehydrated from GET progress = operator. */
export const SavedProgressOperator: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json({
            data: {
              persona: 'operator',
              currentStep: 'persona',
              payload: null,
              updatedAt: '2026-07-08T14:23:45.123Z',
            },
            meta: { serverTime: '2026-07-08T14:23:45.123Z' },
          }),
        ),
        ...onboardingHandlers.filter(
          (h) => !('info' in h && (h.info as { path?: string }).path === '/api/onboarding/progress'),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cards = await canvas.findAllByRole('radio')
    // Operator (first card) is checked; the others are not.
    await expect(cards[0].getAttribute('aria-checked')).toBe('true')
  },
}

/** Persona rehydrated = founder. */
export const SavedProgressFounder: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json({
            data: {
              persona: 'founder',
              currentStep: 'persona',
              payload: null,
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
    const cards = await canvas.findAllByRole('radio')
    // Founder is the second card in the render order.
    await expect(cards[1].getAttribute('aria-checked')).toBe('true')
  },
}

/** Vietnamese locale — verifies Sally-S1 persona labels + Sally-S5 grid. */
export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Vietnamese title: `Người điều hành` (Operator).
    await expect(canvas.findByText(/Người điều hành/)).toBeTruthy()
  },
}

/** GET progress 500 — error alert renders with retry CTA. */
export const Error500: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeTruthy()
  },
}

/** Session cache is already populated with a center → layout redirects to
 * /dashboard. Visual smoke of the guard branch (d). */
export const AlreadyHasCenter: Story = {
  decorators: [
    (Story) => (
      <SeedSession session={WITH_CENTER_SESSION}>
        <Story />
      </SeedSession>
    ),
  ],
}
