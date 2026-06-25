// storybook-rule: no-three-state — AuthCard is a pure-presentational slot
// container (no data fetching, no conditional render branches on user
// data); the three-state Loading/Empty/Error contract does not apply.
/**
 * AuthCard stories — Story 1-8 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import AuthCard from './AuthCard'

const meta = {
  title: 'features/auth/AuthCard',
  component: AuthCard,
  parameters: {
    a11y: { test: 'error' },
  },
  args: {
    regionLabel: 'Sign in',
    heading: (
      <h1 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
        Sign in to ClassLite
      </h1>
    ),
    body: <p className="text-sm text-muted-foreground">Form goes here.</p>,
    footer: (
      <a href="/register" className="text-[var(--cl-accent)] underline">
        Don't have an account? Sign up
      </a>
    ),
  },
} satisfies Meta<typeof AuthCard>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
}

export const VietnameseLongHeading: Story = {
  args: {
    regionLabel: 'Đăng nhập vào ClassLite',
    heading: (
      <h1 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
        Đăng nhập vào ClassLite
      </h1>
    ),
    footer: (
      <a href="/register" className="text-[var(--cl-accent)] underline">
        Chưa có tài khoản? Đăng ký
      </a>
    ),
  },
}

export const WithoutFooter: Story = {
  args: { footer: undefined },
}
