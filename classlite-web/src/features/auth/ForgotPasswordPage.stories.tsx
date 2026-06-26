/**
 * ForgotPasswordPage stories — Story 1-9b AC8.
 *
 * 11 stories per the spec table:
 *   Default / LocaleVi / Sent / SentLocaleVi / SentResendCountdown /
 *   SentWrongEmailRevert / ErrorRateLimited / ErrorGeneric / Mobile390 /
 *   Mobile390Sent / Mobile390ErrorRateLimited.
 *
 * Mock seam (TEST-FE-1): `parameters.msw.handlers` overrides per story.
 * Per-story `router.initialEntries` seeds the route. Sent-mode visuals
 * are driven by user.type → user.click in the play function so the
 * MSW default-handler response settles into the confirmation region.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { HttpResponse, http } from 'msw'
import ForgotPasswordPage from '@/features/auth/ForgotPasswordPage'

const SHORT_EMAIL = 'a@b.co'
const LONG_EMAIL = 'verylongname.with.dots@subdomain.company.co'

async function submitEmail(canvasElement: HTMLElement, email: string) {
  const canvas = within(canvasElement)
  await userEvent.type(canvas.getByTestId('forgot-email-input'), email)
  await userEvent.click(canvas.getByTestId('forgot-submit'))
}

const meta = {
  title: 'features/auth/ForgotPasswordPage',
  component: ForgotPasswordPage,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/forgot-password'] },
  },
} satisfies Meta<typeof ForgotPasswordPage>

export default meta

type Story = StoryObj<typeof meta>

/** Form mode, en locale. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('forgot-password-form')).toBeTruthy()
  },
}

/** Form mode, Vietnamese locale. */
export const LocaleVi: Story = {
  ...Default,
  globals: { locale: 'vi' },
}

/** Confirmation mode after successful 200 — typo-escape + spam hint visible. */
export const Sent: Story = {
  parameters: {
    router: { initialEntries: ['/forgot-password'] },
    msw: {
      handlers: [
        http.post('/api/auth/forgot-password', () =>
          HttpResponse.json({ data: { sent: true } }, { status: 200 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitEmail(canvasElement, SHORT_EMAIL)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('forgot-password-sent'),
    ).toBeTruthy()
    await expect(canvas.getByTestId('forgot-sent-email').textContent).toBe(
      SHORT_EMAIL,
    )
    await expect(canvas.getByTestId('forgot-spam-hint')).toBeTruthy()
    await expect(canvas.getByTestId('forgot-wrong-email')).toBeTruthy()
  },
}

/** Confirmation mode, Vietnamese locale (Sally addition — VN inbox UX). */
export const SentLocaleVi: Story = {
  ...Sent,
  globals: { locale: 'vi' },
}

/** Resend button clicked — countdown active. */
export const SentResendCountdown: Story = {
  parameters: {
    router: { initialEntries: ['/forgot-password'] },
    msw: {
      handlers: [
        http.post('/api/auth/forgot-password', () =>
          HttpResponse.json({ data: { sent: true } }, { status: 200 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitEmail(canvasElement, SHORT_EMAIL)
    const canvas = within(canvasElement)
    await canvas.findByTestId('forgot-password-sent')
    const resend = canvas.getByTestId('forgot-resend-button') as HTMLButtonElement
    // The 60-second countdown starts on the initial 200; assert the
    // button is disabled to lock the visual baseline.
    await expect(resend.disabled).toBe(true)
  },
}

/** Typo-escape button clicked — form mode restored, email field focused. */
export const SentWrongEmailRevert: Story = {
  ...Sent,
  play: async ({ canvasElement }) => {
    await submitEmail(canvasElement, SHORT_EMAIL)
    const canvas = within(canvasElement)
    await canvas.findByTestId('forgot-password-sent')
    await userEvent.click(canvas.getByTestId('forgot-wrong-email'))
    await expect(
      await canvas.findByTestId('forgot-password-form'),
    ).toBeTruthy()
    const emailInput = canvas.getByTestId(
      'forgot-email-input',
    ) as HTMLInputElement
    await expect(emailInput.value).toBe('')
  },
}

/** 429 rate-limited alert with Retry-After: 45 — submit disabled. */
export const ErrorRateLimited: Story = {
  parameters: {
    router: { initialEntries: ['/forgot-password'] },
    msw: {
      handlers: [
        http.post('/api/auth/forgot-password', () =>
          HttpResponse.json(
            {
              error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many requests',
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
    await submitEmail(canvasElement, SHORT_EMAIL)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('forgot-error-alert'),
    ).toBeTruthy()
    await expect(
      (canvas.getByTestId('forgot-submit') as HTMLButtonElement).disabled,
    ).toBe(true)
  },
}

/** 5xx generic error alert. Form stays in input mode. */
export const ErrorGeneric: Story = {
  parameters: {
    router: { initialEntries: ['/forgot-password'] },
    msw: {
      handlers: [
        http.post('/api/auth/forgot-password', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'oops', details: null } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitEmail(canvasElement, SHORT_EMAIL)
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByTestId('forgot-error-alert'),
    ).toBeTruthy()
    await expect(canvas.getByTestId('forgot-password-form')).toBeTruthy()
  },
}

/** Mobile 390px viewport — form mode. */
export const Mobile390: Story = {
  ...Default,
  parameters: {
    ...Default.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
}

/** Mobile 390px viewport — confirmation mode with a long email. */
export const Mobile390Sent: Story = {
  parameters: {
    router: { initialEntries: ['/forgot-password'] },
    viewport: { defaultViewport: 'mobile1' },
    msw: {
      handlers: [
        http.post('/api/auth/forgot-password', () =>
          HttpResponse.json({ data: { sent: true } }, { status: 200 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await submitEmail(canvasElement, LONG_EMAIL)
    const canvas = within(canvasElement)
    const display = await canvas.findByTestId('forgot-sent-email')
    await expect(display.textContent).toBe(LONG_EMAIL)
    // Resend button must remain reachable (rendered) — Chromatic
    // baseline covers the scroll visual; this locks structural presence.
    await expect(canvas.getByTestId('forgot-resend-button')).toBeTruthy()
  },
}

/** Mobile 390px — 429 rate-limited alert with the longest single-line vi string. */
export const Mobile390ErrorRateLimited: Story = {
  ...ErrorRateLimited,
  parameters: {
    ...ErrorRateLimited.parameters,
    viewport: { defaultViewport: 'mobile1' },
  },
  globals: { locale: 'vi' },
}
