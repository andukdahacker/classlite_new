/**
 * VerifyEmailPage stories — Story 1-9a AC8.
 *
 * 10 stories covering the polished surface variants per the spec table:
 *   Default / LocaleVi / PollingTimeout / Expired / ClickThroughLoading /
 *   ClickThroughSuccess / ClickThroughExpired / ClickThroughInvalid /
 *   Invalid / Mobile390 + Mobile390LongEmail.
 *
 * Every story has a `play()` function asserting the right `data-testid`
 * lands so the storybook-axe Playwright project + the test-runner pass
 * gain real coverage (not just visual smoke).
 *
 * Mock seam: parameters.msw.handlers overrides per story (TEST-FE-1).
 * Per-story router initialEntries seeds the searchParams.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { HttpResponse, delay, http } from 'msw'
import { queryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import VerifyEmailPage from '@/features/auth/VerifyEmailPage'

const SHORT_EMAIL = 'a@b.co'
const LONG_EMAIL = 'verylongname.with.dots@subdomain.company.co'

function seedSession(email: string) {
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'sb-user',
      email,
      fullName: 'Storybook User',
      emailVerified: false,
    },
    accessToken: null,
    // R1-P24: honor the "defined-as-null" Session.center invariant from
    // Story 2-3a AC9 (Winston-W2) — every session writer, including
    // Storybook decorators, must populate this slot.
    center: null,
  })
}

function clearSession() {
  queryClient.setQueryData(authKeys.session(), null)
}

const meta = {
  title: 'features/auth/VerifyEmailPage',
  component: VerifyEmailPage,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
} satisfies Meta<typeof VerifyEmailPage>

export default meta

type Story = StoryObj<typeof meta>

/** Polling mode, en locale, verified:false on every poll. */
export const Default: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?pollId=sb-default'] },
    msw: {
      handlers: [
        http.get('/api/auth/verify-status', () =>
          HttpResponse.json(
            { data: { verified: false, email: SHORT_EMAIL } },
            { status: 200 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      seedSession(SHORT_EMAIL)
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('verify-polling')).toBeTruthy()
  },
}

/** Polling mode, Vietnamese locale. Driven by Storybook globals.locale. */
export const LocaleVi: Story = {
  ...Default,
  globals: { locale: 'vi' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('verify-polling')).toBeTruthy()
  },
}

/**
 * Polling timeout state — simulated by seeding a `verified:false`
 * response indefinitely. The 10-min cap is not driven via timer in
 * Storybook (timers are real); the visual is shown via the seeded
 * timeout-region rendered through a story-only override below.
 */
export const PollingTimeout: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?pollId=sb-timeout'] },
    msw: {
      handlers: [
        http.get('/api/auth/verify-status', async () => {
          // Slow response keeps poller "pending" — visually demonstrates
          // the loading rhythm. The full timeout state is exercised by
          // the unit tests; Storybook covers the visual baseline.
          await delay(30_000)
          return HttpResponse.json(
            { data: { verified: false, email: SHORT_EMAIL } },
            { status: 200 },
          )
        }),
      ],
    },
  },
  loaders: [
    async () => {
      seedSession(SHORT_EMAIL)
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Still on polling visual since the 10-min cap doesn't fire in
    // story-time. The pinned test for the post-cap timeout swap lives
    // in VerifyEmailPage.test.tsx (vi.useFakeTimers).
    await expect(canvas.getByTestId('verify-polling')).toBeTruthy()
  },
}

/** Expired state — 404 from /verify-status. */
export const Expired: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?pollId=sb-expired'] },
    msw: {
      handlers: [
        http.get('/api/auth/verify-status', () =>
          HttpResponse.json(
            {
              error: {
                code: 'POLL_ID_NOT_FOUND',
                message: 'expired',
                details: null,
              },
            },
            { status: 404 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      seedSession(SHORT_EMAIL)
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('verify-expired'),
    ).toBeTruthy()
  },
}

/** Click-through mode — POST in-flight (loading skeleton + checkingNow). */
export const ClickThroughLoading: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?token=sb-loading'] },
    msw: {
      handlers: [
        http.post('/api/auth/verify-email', async () => {
          await delay(60_000)
          return HttpResponse.json(
            { data: { verified: true, email: SHORT_EMAIL } },
            { status: 200 },
          )
        }),
      ],
    },
  },
  loaders: [
    async () => {
      clearSession()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('verify-click-through')).toBeTruthy()
  },
}

/** Click-through 200 → success aria-live announcement. */
export const ClickThroughSuccess: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?token=sb-success'] },
    msw: {
      handlers: [
        http.post('/api/auth/verify-email', () =>
          HttpResponse.json(
            { data: { verified: true, email: SHORT_EMAIL } },
            { status: 200 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      clearSession()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('verify-success-redirecting'),
    ).toBeTruthy()
  },
}

/** Click-through 410 → expired visual. */
export const ClickThroughExpired: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?token=sb-expired'] },
    msw: {
      handlers: [
        http.post('/api/auth/verify-email', () =>
          HttpResponse.json(
            {
              error: {
                code: 'VERIFICATION_TOKEN_EXPIRED',
                message: 'expired',
                details: null,
              },
            },
            { status: 410 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      clearSession()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('verify-expired'),
    ).toBeTruthy()
  },
}

/** Click-through 404 → invalid visual. */
export const ClickThroughInvalid: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?token=sb-invalid'] },
    msw: {
      handlers: [
        http.post('/api/auth/verify-email', () =>
          HttpResponse.json(
            {
              error: {
                code: 'VERIFICATION_TOKEN_INVALID',
                message: 'invalid',
                details: null,
              },
            },
            { status: 404 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      clearSession()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('verify-invalid'),
    ).toBeTruthy()
  },
}

/** Neither query param → invalid fallback. */
export const Invalid: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email'] },
  },
  loaders: [
    async () => {
      clearSession()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('verify-invalid')).toBeTruthy()
  },
}

/** Mobile 390px viewport with a SHORT email — touch-target audit per UX-DR15. */
export const Mobile390: Story = {
  ...Default,
  parameters: {
    ...Default.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}

/**
 * Mobile 390px viewport with a 40+ char email — locks the `break-all`
 * span behavior. The bolded email wraps INSIDE the span without pushing
 * the resend button below the fold (Sally amendment 2026-06-25).
 */
export const Mobile390LongEmail: Story = {
  parameters: {
    router: { initialEntries: ['/verify-email?pollId=sb-long-email'] },
    viewport: { defaultViewport: 'mobile1' },
    msw: {
      handlers: [
        http.get('/api/auth/verify-status', () =>
          HttpResponse.json(
            { data: { verified: false, email: LONG_EMAIL } },
            { status: 200 },
          ),
        ),
      ],
    },
  },
  loaders: [
    async () => {
      seedSession(LONG_EMAIL)
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const display = await canvas.findByTestId('verify-email-display')
    await expect(display.textContent).toContain('@')
    // Resend button must be reachable (rendered) — visual scroll check
    // is the Chromatic baseline; this play assertion only locks the
    // structural presence.
    await expect(canvas.getByTestId('verify-resend-button')).toBeTruthy()
  },
}
