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

// ===== Story 1-9d AC7 variants =====

const LOCKOUT_STORAGE_KEY = 'classlite_login_lockout_until'

/**
 * `/login` with lockoutStorage pre-seeded to 10 minutes ahead — exercises
 * the rehydrate-on-mount path (no MSW call, no 429 submit, no countdown
 * tick to start fresh). Locks the mode-replacement contract: form is
 * UNMOUNTED, lockout region visible, Google CTA stays mounted below.
 */
export const Lockout: Story = {
  decorators: [
    (Story) => {
      window.localStorage.setItem(
        LOCKOUT_STORAGE_KEY,
        JSON.stringify({
          lockoutUntilMs: Date.now() + 600_000,
          version: 1,
        }),
      )
      return <Story />
    },
  ],
  parameters: { router: { initialEntries: ['/login'] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-lockout')
    await expect(canvas.queryByTestId('login-submit')).toBeNull()
  },
}

/**
 * Lockout at 390×844 (Sally BLOCKER mobile stack-order pin) — reset CTA
 * lives in the thumb zone; Google CTA drops below.
 */
export const LockoutMobile390: Story = {
  decorators: [
    (Story) => {
      window.localStorage.setItem(
        LOCKOUT_STORAGE_KEY,
        JSON.stringify({
          lockoutUntilMs: Date.now() + 600_000,
          version: 1,
        }),
      )
      return <Story />
    },
  ],
  parameters: {
    router: { initialEntries: ['/login'] },
    viewport: { defaultViewport: 'iphone14' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-lockout-reset-cta')
  },
}

/**
 * `/login?error=invite_email_mismatch` — Story 1-9d AC2 polished screen.
 * Visually distinct from the 1-9c generic banner: full-region replacement
 * with warning-triangle SVG + reopen-invite-hint copy. NO register CTA.
 */
export const OAuthMismatch: Story = {
  parameters: {
    router: { initialEntries: ['/login?error=invite_email_mismatch'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-oauth-mismatch')
    await expect(
      canvas.queryByTestId('login-oauth-mismatch-register-cta'),
    ).toBeNull()
  },
}

/**
 * `/login?error=google_userinfo_failed` — Story 1-9d AC3 Workspace-policy
 * branch. Body copy framed "Workspace administrator hasn't allowed this app."
 */
export const WorkspaceBlockedUserinfoFailed: Story = {
  parameters: {
    router: { initialEntries: ['/login?error=google_userinfo_failed'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-workspace-blocked')
  },
}

/**
 * `/login?error=google_email_unverified` — Story 1-9d AC3 forced-
 * verification branch. Body copy framed "Verify your email at
 * myaccount.google.com." Visually shares heading + CTAs with
 * WorkspaceBlockedUserinfoFailed; only the body line is distinct.
 */
export const WorkspaceBlockedEmailUnverified: Story = {
  parameters: {
    router: { initialEntries: ['/login?error=google_email_unverified'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-workspace-blocked')
  },
}

/**
 * `/login?session_expired=1` — Story 1-9d AC4. Warning banner above the
 * form (form stays mounted). Data-loss hint copy visible below the banner.
 */
export const SessionExpiredBanner: Story = {
  parameters: {
    router: { initialEntries: ['/login?session_expired=1'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('login-form-banner')
    await canvas.findByTestId('login-session-expired-data-loss')
  },
}
