// storybook-rule: no-three-state — GoogleOAuthButton is an anchor
// initiating top-level navigation (no data fetching); the three-state
// contract does not apply.
/**
 * GoogleOAuthButton stories — Story 1-8 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import GoogleOAuthButton from './GoogleOAuthButton'

const meta = {
  title: 'features/auth/GoogleOAuthButton',
  component: GoogleOAuthButton,
  parameters: {
    a11y: { test: 'error' },
  },
  args: {
    label: 'Continue with Google',
  },
} satisfies Meta<typeof GoogleOAuthButton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Disabled: Story = {
  args: { disabled: true },
}

export const VietnameseLabel: Story = {
  args: { label: 'Tiếp tục với Google' },
}
