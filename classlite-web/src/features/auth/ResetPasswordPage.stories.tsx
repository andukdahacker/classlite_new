/**
 * ResetPasswordPage stories — Story 1-9b AC8.
 *
 * 9 stories per the spec table:
 *   Default / LocaleVi / Invalid / Expired / Consumed / ErrorGeneric /
 *   PasswordMismatch / Mobile390 / Mobile390Expired.
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` overrides per story.
 * Per-story `router.initialEntries` seeds the searchParams (including
 * the `?token=` reactive read contract).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { HttpResponse, http } from 'msw'
import ResetPasswordPage from '@/features/auth/ResetPasswordPage'

async function submitNewPassword(
  canvasElement: HTMLElement,
  values: { newPassword: string; confirmPassword: string },
) {
  const canvas = within(canvasElement)
  await userEvent.type(
    canvas.getByTestId('reset-new-password'),
    values.newPassword,
  )
  await userEvent.type(
    canvas.getByTestId('reset-confirm-password'),
    values.confirmPassword,
  )
  await userEvent.click(canvas.getByTestId('reset-submit'))
}

const meta = {
  title: 'features/auth/ResetPasswordPage',
  component: ResetPasswordPage,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/reset-password?token=sb-default'] },
  },
} satisfies Meta<typeof ResetPasswordPage>

export default meta

type Story = StoryObj<typeof meta>

/** Form mode with a valid token, en locale. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('reset-password-form')).toBeTruthy()
  },
}

/** Form mode, Vietnamese locale. */
export const LocaleVi: Story = {
  ...Default,
  globals: { locale: 'vi' },
}

/** No-token landing — invalid state with NO network call. */
export const Invalid: Story = {
  parameters: {
    router: { initialEntries: ['/reset-password'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('reset-password-invalid')).toBeTruthy()
  },
}

/** 410 RESET_TOKEN_EXPIRED — UX-DR16 three-part recovery. */
export const Expired: Story = {
  parameters: {
    router: { initialEntries: ['/reset-password?token=sb-expired'] },
    msw: {
      handlers: [
        http.post('/api/auth/reset-password', () =>
          HttpResponse.json(
            {
              error: {
                code: 'RESET_TOKEN_EXPIRED',
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
  play: async ({ canvasElement }) => {
    await submitNewPassword(canvasElement, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('reset-password-expired'),
    ).toBeTruthy()
  },
}

/** 409 RESET_TOKEN_CONSUMED — link-already-used state. */
export const Consumed: Story = {
  parameters: {
    router: { initialEntries: ['/reset-password?token=sb-consumed'] },
    msw: {
      handlers: [
        http.post('/api/auth/reset-password', () =>
          HttpResponse.json(
            {
              error: {
                code: 'RESET_TOKEN_CONSUMED',
                message: 'consumed',
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
    await submitNewPassword(canvasElement, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('reset-password-consumed'),
    ).toBeTruthy()
  },
}

/** 5xx generic alert — form stays input mode. */
export const ErrorGeneric: Story = {
  parameters: {
    router: { initialEntries: ['/reset-password?token=sb-5xx'] },
    msw: {
      handlers: [
        http.post('/api/auth/reset-password', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'oops', details: null } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitNewPassword(canvasElement, {
      newPassword: 'newStrong123',
      confirmPassword: 'newStrong123',
    })
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('reset-error-alert'),
    ).toBeTruthy()
    await expect(canvas.getByTestId('reset-password-form')).toBeTruthy()
  },
}

/** Mismatching passwords — confirm-field error visible, no network call. */
export const PasswordMismatch: Story = {
  parameters: {
    router: { initialEntries: ['/reset-password?token=sb-mismatch'] },
  },
  play: async ({ canvasElement }) => {
    await submitNewPassword(canvasElement, {
      newPassword: 'Hunter2!!',
      confirmPassword: 'Hunter3!!',
    })
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/match/i),
    ).toBeTruthy()
  },
}

/** Mobile 390px — form mode. */
export const Mobile390: Story = {
  ...Default,
  parameters: {
    ...Default.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}

/** Mobile 390px — expired state with the clock SVG above the fold. */
export const Mobile390Expired: Story = {
  ...Expired,
  parameters: {
    ...Expired.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}
