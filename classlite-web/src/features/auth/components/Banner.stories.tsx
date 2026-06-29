/**
 * Banner stories — Story 1-9d AC7.
 *
 * Five variants, one per BannerVariant. Each story isolates the Banner
 * component so the variant-style audit doesn't compete with LoginPage's
 * surrounding chrome.
 *
 * Mock seam (TEST-FE-1): no MSW overrides — Banner renders from props.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import Banner from '@/features/auth/components/Banner'

const meta = {
  title: 'features/auth/Banner',
  component: Banner,
  parameters: {
    a11y: { test: 'error' },
    layout: 'centered',
  },
} satisfies Meta<typeof Banner>

export default meta

type Story = StoryObj<typeof meta>

export const Success_Invited: Story = {
  args: {
    variant: 'invited',
    message: "Welcome — you've joined your center. Sign in to continue.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByTestId('login-form-banner')
    await expect(banner.getAttribute('role')).toBe('status')
  },
}

export const Success_Reset: Story = {
  args: {
    variant: 'reset',
    message: 'Password reset complete. We signed out your other devices.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByTestId('login-form-banner')
    await expect(banner.getAttribute('role')).toBe('status')
  },
}

export const Success_Verified: Story = {
  args: {
    variant: 'verified',
    message: 'Your email is verified. Sign in to continue.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByTestId('login-form-banner')
    await expect(banner.getAttribute('role')).toBe('status')
  },
}

export const Destructive_OAuthError: Story = {
  args: {
    variant: 'oauth-error',
    message: "We couldn't complete sign-in with Google. Please try again.",
    testId: 'login-form-error',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByTestId('login-form-error')
    await expect(banner.getAttribute('role')).toBe('alert')
  },
}

export const Warning_SessionExpired: Story = {
  args: {
    variant: 'session-expired',
    message: 'We signed you out for security. Sign in to continue where you left off.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByTestId('login-form-banner')
    await expect(banner.getAttribute('role')).toBe('alert')
  },
}
