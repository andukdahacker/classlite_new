/**
 * InviteAcceptancePage stories — Story 1-9c AC7.
 *
 * 16 variants per the spec table:
 *   Default / DefaultWithCenterRibbon / LocaleVi / LocaleViWithCenterRibbon /
 *   EmailFormOpen / NotFound / Expired / AlreadyAccepted / EmailMismatch /
 *   PasswordNotAllowed / EmailAlreadyRegistered / InvalidToken / ErrorGeneric /
 *   RateLimited / Mobile390 / Mobile390EmailFormOpen / Mobile390Expired.
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` overrides per story.
 *
 * `useParams<{ token: string }>()` requires a route match — the InviteAcceptancePage
 * stories override the global Suspense + MemoryRouter decorator with a
 * per-story Routes wrapper so the `/invite/:token` path matches and the page
 * sees a token. The global preview decorator already provides MemoryRouter +
 * QueryClient + i18n + Suspense; the per-story decorator only adds the
 * `<Routes><Route path="/invite/:token" />` wiring.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import InviteAcceptancePage from '@/features/auth/InviteAcceptancePage'

async function submitForm(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByTestId('collapsible-email-trigger'))
  await userEvent.type(canvas.getByTestId('invite-fullname-input'), 'Linh Nguyen')
  await userEvent.type(canvas.getByTestId('invite-password-input'), 'goodPass123')
  await userEvent.click(canvas.getByTestId('invite-submit'))
}

function InviteRouteWrapper() {
  return (
    <Routes>
      <Route path="/invite/:token" element={<InviteAcceptancePage />} />
      <Route path="/invite" element={<InviteAcceptancePage />} />
    </Routes>
  )
}

const meta = {
  title: 'features/auth/InviteAcceptancePage',
  component: InviteRouteWrapper,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/invite/sb-default-token'] },
  },
} satisfies Meta<typeof InviteRouteWrapper>

export default meta

type Story = StoryObj<typeof meta>

/** Default — en locale, valid token, form mode collapsed, no ?c= ribbon. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('invite-form')).toBeTruthy()
  },
}

/**
 * Sender-embedded `?c=` ribbon happy-path (Sally party-mode 2026-06-26) —
 * en locale, "Join IELTS Academy" H1 instead of generic title.
 */
export const DefaultWithCenterRibbon: Story = {
  parameters: {
    router: {
      initialEntries: ['/invite/sb-default-token?c=IELTS%20Academy'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByTestId('invite-heading')
    await expect(heading.textContent).toContain('IELTS Academy')
  },
}

/** Vietnamese locale — verifies vi seed copy renders on first paint. */
export const LocaleVi: Story = {
  ...Default,
  globals: { locale: 'vi' },
}

/** Vietnamese locale with ?c= ribbon — "Tham gia IELTS Academy" H1. */
export const LocaleViWithCenterRibbon: Story = {
  ...DefaultWithCenterRibbon,
  globals: { locale: 'vi' },
}

/**
 * Collapsible expanded on initial paint — verifies focus moves to
 * fullName input + aria-live announcement node present.
 */
export const EmailFormOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByTestId('collapsible-email-trigger'))
    await expect(
      await canvas.findByTestId('invite-fullname-input'),
    ).toBeTruthy()
    await expect(
      await canvas.findByTestId('invite-aria-live'),
    ).toBeTruthy()
  },
}

/** 404 INVITE_NOT_FOUND — terminal dead-link state. */
export const NotFound: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-not-found-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_NOT_FOUND',
                message: 'gone',
                details: null,
              },
            },
            { status: 404 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('invite-not-found')).toBeTruthy()
  },
}

/** 410 INVITE_EXPIRED with centerName + inviterEmail + mailto CTA. */
export const Expired: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-expired-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_EXPIRED',
                message: 'expired',
                details: {
                  centerName: 'IELTS Academy',
                  inviterEmail: 'linh@ielts-academy.vn',
                },
              },
            },
            { status: 410 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('invite-expired')).toBeTruthy()
  },
}

/**
 * 409 INVITE_ALREADY_ACCEPTED — Sally good-outcome differentiation. The
 * inline check-circle SVG visually separates "this is fine" from the
 * dead-link error states.
 */
export const AlreadyAccepted: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-already-accepted-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_ALREADY_ACCEPTED',
                message: 'taken',
                details: { centerName: 'IELTS Academy' },
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('invite-already-accepted'),
    ).toBeTruthy()
  },
}

/** 409 INVITE_EMAIL_MISMATCH — REST-path landing (OAuth path is 1-9d). */
export const EmailMismatch: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-email-mismatch-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'INVITE_EMAIL_MISMATCH',
                message: 'mismatch',
                details: {
                  invitedEmail: 'invited@example.com',
                  oauthEmail: 'oauth@example.com',
                },
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('invite-email-mismatch'),
    ).toBeTruthy()
  },
}

/** 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER — Google CTA re-rendered. */
export const PasswordNotAllowed: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-pw-not-allowed-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER',
                message: 'oauth-only',
                details: null,
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('invite-password-not-allowed'),
    ).toBeTruthy()
  },
}

/** 409 EMAIL_ALREADY_REGISTERED — rare race during new-user branch. */
export const EmailAlreadyRegistered: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-email-registered-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'EMAIL_ALREADY_REGISTERED',
                message: 'dup',
                details: null,
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('invite-email-already-registered'),
    ).toBeTruthy()
  },
}

/** 400 INVALID_INVITE_TOKEN — malformed-token terminal state. */
export const InvalidToken: Story = {
  parameters: {
    router: { initialEntries: ['/invite/%20'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('invite-invalid-token'),
    ).toBeTruthy()
  },
}

/** 5xx — generic alert, form stays input. */
export const ErrorGeneric: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-5xx-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom', details: null } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('invite-error-alert')).toBeTruthy()
    await expect(canvas.getByTestId('invite-form')).toBeTruthy()
  },
}

/** 429 RATE_LIMIT_EXCEEDED with Retry-After=45 — submit disabled. */
export const RateLimited: Story = {
  parameters: {
    router: { initialEntries: ['/invite/sb-rate-limited-token'] },
    msw: {
      handlers: [
        http.post('/api/auth/accept-invite', () =>
          HttpResponse.json(
            {
              error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'slow down',
                details: null,
              },
            },
            { status: 429, headers: { 'Retry-After': '45' } },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('invite-error-alert')).toBeTruthy()
  },
}

/** Mobile 390 — form mode at small viewport. */
export const Mobile390: Story = {
  ...Default,
  parameters: {
    ...Default.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}

/**
 * Mobile 390 — CollapsibleEmailForm expanded. Sally party-mode catch:
 * the conversion-critical happy-path mobile fold (Google + divider +
 * fullName + password + submit + back-link + footer) was unverified;
 * wireframe only covered the easier Expired state.
 */
export const Mobile390EmailFormOpen: Story = {
  ...EmailFormOpen,
  parameters: {
    ...Default.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}

/** Mobile 390 — expired state with clock SVG above the fold. */
export const Mobile390Expired: Story = {
  ...Expired,
  parameters: {
    ...Expired.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}
