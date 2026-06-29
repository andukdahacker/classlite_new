/**
 * LoginPage stories — Story 1-9b AC8 addition.
 *
 * Single ResetBanner variant per AC8 — mirrors the 1-9a VerifiedBanner
 * story precedent. The page-level surface is covered by integration
 * tests; this story locks the success-banner visual for the new
 * `?reset=1` mount.
 *
 * Mock seam (TEST-FE-1): no MSW overrides needed — the banner renders
 * synchronously from the URL search params, no network call required.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import LoginPage from '@/features/auth/LoginPage'

const meta = {
  title: 'features/auth/LoginPage',
  component: LoginPage,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
    router: { initialEntries: ['/login'] },
  },
} satisfies Meta<typeof LoginPage>

export default meta

type Story = StoryObj<typeof meta>

/** Baseline login surface — Google CTA + collapsible email form. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('login-heading')).toBeTruthy()
  },
}

/**
 * `/login?reset=1` mount — success banner with the inline checkmark
 * glyph + session-wipe copy. The lazy initializer also wipes the
 * QueryClient `authKeys.session()` cache; that's covered by the
 * LoginPage.test.tsx unit test (cache assertions don't render).
 *
 * Axe-zero: the inline `<svg>` carries `aria-hidden="true"` so the
 * decorative glyph doesn't pollute the screen-reader output.
 */
export const ResetBanner: Story = {
  parameters: {
    router: { initialEntries: ['/login?reset=1'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = await canvas.findByTestId('login-form-banner')
    await expect(banner).toBeTruthy()
    const svg = banner.querySelector('svg')
    await expect(svg).not.toBeNull()
    await expect(svg?.getAttribute('aria-hidden')).toBe('true')
  },
}

/**
 * `/login?invited=true` mount — Story 1-9c AC7. Success banner with the
 * inline checkmark glyph + invited copy. Surfaces after Story 1-6's
 * OAuth-callback success redirects to `APP_POST_LOGIN_URL?invited=true`
 * and the index loader forwards the query.
 *
 * Mirrors the ResetBanner shape — same border / bg / text classes — so
 * the visual contract stays consistent across success banners.
 */
export const InvitedBanner: Story = {
  parameters: {
    router: { initialEntries: ['/login?invited=true'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = await canvas.findByTestId('login-form-banner')
    await expect(banner).toBeTruthy()
    const svg = banner.querySelector('svg')
    await expect(svg).not.toBeNull()
    await expect(svg?.getAttribute('aria-hidden')).toBe('true')
  },
}
