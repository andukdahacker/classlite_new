// storybook-rule: no-three-state — PasswordInput is an Input-primitive
// wrapper (no data fetching); the three-state contract does not apply.
/**
 * PasswordInput stories — Story 1-8 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import PasswordInput from './PasswordInput'

const meta = {
  title: 'features/auth/PasswordInput',
  component: PasswordInput,
  parameters: {
    a11y: { test: 'error' },
  },
  args: {
    'aria-label': 'Password',
    placeholder: 'At least 8 characters',
  },
} satisfies Meta<typeof PasswordInput>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Visible: Story = {
  args: { defaultValue: 'plain-text-shown' },
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'cannot-edit' },
}

export const Error: Story = {
  args: { 'aria-invalid': true, defaultValue: 'short' },
}
