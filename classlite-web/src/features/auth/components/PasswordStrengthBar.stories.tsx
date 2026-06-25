// storybook-rule: no-three-state — PasswordStrengthBar is a pure-derived
// visual indicator over a controlled `password` prop (no data fetching,
// no loading/empty/error semantics); the three-state contract does not
// apply.
/**
 * PasswordStrengthBar stories — Story 1-8 AC1.
 *
 * Covers Empty + each of the 4 levels + Vietnamese announcement.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import PasswordStrengthBar from './PasswordStrengthBar'

const meta = {
  title: 'features/auth/PasswordStrengthBar',
  component: PasswordStrengthBar,
  parameters: {
    a11y: { test: 'error' },
  },
} satisfies Meta<typeof PasswordStrengthBar>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { password: '' },
}

export const Weak: Story = {
  args: { password: 'abc' },
}

export const Fair: Story = {
  args: { password: 'password1234' },
}

export const Strong: Story = {
  args: { password: 'Password1' },
}

export const VeryStrong: Story = {
  args: { password: 'Password1$@xyz' },
}

export const VietnameseLocale: Story = {
  args: { password: 'Password1$@xyz' },
  parameters: {
    // Surfaces the Vietnamese rất mạnh announcement under storybook test-runner.
    globals: { locale: 'vi' },
  },
}
