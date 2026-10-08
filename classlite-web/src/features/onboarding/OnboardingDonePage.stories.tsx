// storybook-rule: no-three-state
// Route-page / presentational tier (Story 10.3): the data three-state trilogy does not apply.
/**
 * OnboardingDonePage stories — Story 2-3c Task 2.5.
 *
 * 10 discrete variants (A-S1) exercising the completion screen across:
 *   - persona × class-count × teacher-count matrix (Default / SoloTeacher /
 *     FounderNoInvites / OneClassManyInvites)
 *   - state (Loading / Error500 / SetupIncomplete)
 *   - locale (LocaleViOperator / LocaleViFounder / LocaleViSolo /
 *     LocaleViCramped720 — verifies S-S1 Vietnamese headline overflow
 *     discipline at md viewport)
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` per-story overrides.
 * Session cache is seeded into the preview's own client via `SeedSession`
 * with `center` populated so OnboardingLayout mounts /setup/done.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Route, Routes } from 'react-router'
import { HttpResponse, http } from 'msw'
import { useState, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/api/authKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import OnboardingDonePage from '@/features/onboarding/OnboardingDonePage'
import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

type SeedOverrides = { centerName?: string; shortCode?: string; email?: string }

const CENTER = {
  id: 'sb-center',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
  brandColor: '#1e3a8a' as string | null,
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

function seedAuthenticatedSession(client: QueryClient, overrides: SeedOverrides = {}) {
  client.setQueryData(authKeys.session(), {
    user: {
      id: 'sb-user',
      email: overrides.email ?? 'owner@example.com',
      fullName: 'Storybook Owner',
      emailVerified: true,
    },
    accessToken: 'sb.jwt',
    center: {
      ...CENTER,
      name: overrides.centerName ?? CENTER.name,
      shortCode: overrides.shortCode ?? CENTER.shortCode,
    },
    // Story 2.6 (AC2). Post-center-creation → Owner. Storybook seeder
    // must populate role explicitly per Task 6.2 grep contract.
    role: 'owner',
  })
}

// Seed into the preview's own client (NOT the global `queryClient` singleton —
// the preview wraps every story in a fresh `createTestQueryClient()`).
// `useQueryClient()` inside a decorator resolves to that client; the lazy
// `useState` seeds once before the page renders, so `useAuth()` reads a
// populated cache (with `center`) instead of hanging on the onboarding
// skeleton. (Story 10.3 — surfaced when page stories became first-class.)
function SeedSession({
  overrides,
  children,
}: {
  overrides?: SeedOverrides
  children: ReactNode
}): ReactNode {
  const client = useQueryClient()
  useState(() => {
    seedAuthenticatedSession(client, overrides)
    return null
  })
  return children
}

interface DoneProgressArgs {
  persona: 'operator' | 'founder' | 'solo_teacher'
  spawnedClassIds?: string[]
  classesDraft?: Array<{
    cohortName: string
    startDate: string
    teacherEmail: string | null
  }>
}

function doneProgressHandler({
  persona,
  spawnedClassIds = ['c1', 'c2', 'c3'],
  classesDraft,
}: DoneProgressArgs) {
  return http.get('/api/onboarding/progress', () =>
    HttpResponse.json({
      data: {
        persona,
        currentStep: 'done',
        payload: {
          schemaVersion: 1,
          personaChoice: persona,
          centerDraft: null,
          templateDraft: {
            selectedTemplateId: 'template-writing-bootcamp',
            buildFromScratch: false,
            spawnedClassIds,
            ...(classesDraft ? { classesDraft } : {}),
          },
        },
        updatedAt: '2026-07-12T10:00:00.000Z',
      },
      meta: { serverTime: '2026-07-12T10:00:00.000Z' },
    }),
  )
}

function DoneRoute() {
  return (
    <Routes>
      <Route element={<OnboardingLayout />}>
        <Route path="/setup/done" element={<OnboardingDonePage />} />
      </Route>
    </Routes>
  )
}

const meta = {
  title: 'features/onboarding/OnboardingDonePage',
  component: DoneRoute,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/setup/done'] },
  },
  decorators: [
    (Story) => (
      <SeedSession>
        <Story />
      </SeedSession>
    ),
  ],
} satisfies Meta<typeof DoneRoute>

export default meta
type Story = StoryObj<typeof meta>

// -- persona × count matrix --------------------------------------------------

export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'operator',
          spawnedClassIds: ['c1', 'c2', 'c3'],
          classesDraft: [
            { cohortName: 'IELTS Alpha', startDate: '2026-08-15', teacherEmail: 'a@x.com' },
            { cohortName: 'IELTS Beta', startDate: '2026-08-22', teacherEmail: 'b@x.com' },
            { cohortName: 'IELTS Gamma', startDate: '2026-08-29', teacherEmail: null },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = await canvas.findByRole('heading', { level: 1 })
    await expect(heading).toBeTruthy()
  },
}

export const SoloTeacher: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'solo_teacher',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'IELTS Foundations', startDate: '2026-08-15', teacherEmail: null },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
  },
}

export const FounderNoInvites: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'founder',
          spawnedClassIds: ['c1'],
          classesDraft: [
            // Founder self-injection edge — row 0 teacherEmail = user.email
            // should be filtered out of teachersInvitedCount (Winston-W4).
            { cohortName: 'IELTS Alpha', startDate: '2026-08-15', teacherEmail: 'owner@example.com' },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
  },
}

export const OneClassManyInvites: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'operator',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'IELTS Alpha', startDate: '2026-08-15', teacherEmail: 'a@x.com' },
            { cohortName: 'IELTS Alpha B', startDate: '2026-08-22', teacherEmail: 'b@x.com' },
            { cohortName: 'IELTS Alpha C', startDate: '2026-08-29', teacherEmail: 'c@x.com' },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
  },
}

// -- state variants ----------------------------------------------------------

export const Loading: Story = {
  parameters: {
    // R1-C1-P15: never-resolving promise (not a 60s delay) so Chromatic /
    // a11y-runner captures the skeleton state without blocking CI for 60s.
    chromatic: { pauseAnimationAtEnd: true },
    msw: {
      handlers: [
        http.get(
          '/api/onboarding/progress',
          () => new Promise<never>(() => {}),
        ),
        ...onboardingHandlers,
      ],
    },
  },
}

export const Error500: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Boom',
                requestId: 'req_sb_500',
              },
            },
            { status: 500 },
          ),
        ),
        ...onboardingHandlers,
      ],
    },
  },
}

// R1-C1-P17: covers the escalated persistent-failure alert (retry ≥3) so
// designers can review the ratcheted copy. Play clicks retry 3× to hit the
// PERSISTENT_FAILURE_THRESHOLD — each click triggers a refetch, MSW keeps
// returning 500, ratchet trips from 3→persistent via the refetch-failure
// transition tracker.
export const Error500Persistent: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Boom',
                requestId: 'req_sb_500_persistent',
              },
            },
            { status: 500 },
          ),
        ),
        ...onboardingHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The retry button is `disabled={progress.isFetching}`. A click only yields a
    // settled error refetch (which ratchets `retryCount`) once the PRIOR fetch has
    // settled — so wait for the button to re-enable before each click, otherwise
    // rapid clicks coalesce into one request and the threshold (3) is never hit.
    for (let i = 0; i < 3; i++) {
      const retryButton = await canvas.findByRole('button', { name: /try again/i })
      await waitFor(() => expect(retryButton).toBeEnabled())
      await userEvent.click(retryButton)
    }
    await waitFor(
      () => expect(canvas.getByTestId('done-error-persistent')).toBeInTheDocument(),
      { timeout: 5000 },
    )
  },
}

export const SetupIncomplete: Story = {
  parameters: {
    msw: {
      handlers: [
        // spawnedClassIds: [] → S-B1 visible fail alert (not silent bounce).
        doneProgressHandler({ persona: 'operator', spawnedClassIds: [] }),
        ...onboardingHandlers,
      ],
    },
  },
}

// R1-C1-P22: covers M-I4's second permutation — `templateDraft` missing
// entirely (undefined spawnedClassIds) → same visible fail alert as the
// empty-array case.
export const SetupIncompleteMissingDraft: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/onboarding/progress', () =>
          HttpResponse.json({
            data: {
              persona: 'operator',
              currentStep: 'done',
              payload: {
                schemaVersion: 1,
                personaChoice: 'operator',
                centerDraft: null,
                templateDraft: null,
              },
              updatedAt: '2026-07-12T10:00:00.000Z',
            },
            meta: { serverTime: '2026-07-12T10:00:00.000Z' },
          }),
        ),
        ...onboardingHandlers,
      ],
    },
  },
}

// -- locale variants ---------------------------------------------------------

// R1-C1-P16: decorator WRAPS the Story so `lang="vi"` inherits through the
// story tree. Prior impl rendered an empty <div> as a sibling — `lang`
// context never applied.
function ViWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div lang="vi" data-storybook-locale="vi">
      {children}
    </div>
  )
}

export const LocaleViOperator: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'operator',
          spawnedClassIds: ['c1', 'c2'],
          classesDraft: [
            { cohortName: 'IELTS A', startDate: '2026-08-15', teacherEmail: 'a@x.com' },
            { cohortName: 'IELTS B', startDate: '2026-08-22', teacherEmail: 'b@x.com' },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
    i18n: { locale: 'vi' },
  },
  decorators: [
    (Story) => (
      <ViWrapper>
        <Story />
      </ViWrapper>
    ),
  ],
}

export const LocaleViFounder: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'founder',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'IELTS A', startDate: '2026-08-15', teacherEmail: null },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
    i18n: { locale: 'vi' },
  },
  decorators: [
    (Story) => (
      <ViWrapper>
        <Story />
      </ViWrapper>
    ),
  ],
}

export const LocaleViSolo: Story = {
  parameters: {
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'solo_teacher',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'IELTS A', startDate: '2026-08-15', teacherEmail: null },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
    i18n: { locale: 'vi' },
  },
  decorators: [
    (Story) => (
      <ViWrapper>
        <Story />
      </ViWrapper>
    ),
  ],
}

export const LocaleViCramped720: Story = {
  parameters: {
    viewport: { defaultViewport: { name: 'cramped720', styles: { width: '720px', height: '900px' } } },
    msw: {
      handlers: [
        doneProgressHandler({
          persona: 'founder',
          spawnedClassIds: ['c1'],
          classesDraft: [
            { cohortName: 'IELTS A', startDate: '2026-08-15', teacherEmail: null },
          ],
        }),
        ...onboardingHandlers,
      ],
    },
    i18n: { locale: 'vi' },
  },
  decorators: [
    (Story) => (
      // Long Vietnamese center name to exercise the min-w-0 break-words
      // responsive step-down at md viewport (S-S1).
      <SeedSession
        overrides={{
          centerName: 'Trung tâm Anh ngữ Quốc tế Hà Nội',
          shortCode: 'trung-tam-ha-noi',
        }}
      >
        <ViWrapper>
          <Story />
        </ViWrapper>
      </SeedSession>
    ),
  ],
}
