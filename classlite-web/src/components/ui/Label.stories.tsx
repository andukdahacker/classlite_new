/**
 * Label — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { Label } from './label'
import { Input } from './input'

const meta = {
  title: 'ui/Label',
  component: Label,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="default-input">Class name</Label>
      <Input id="default-input" />
    </div>
  ),
}

export const Required: Story = {
  render: () => <RequiredDemo />,
}

function RequiredDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-72 gap-2">
      <Label htmlFor="req-input">
        Class name{' '}
        <span aria-hidden="true" className="text-destructive">*</span>
        <span className="sr-only">{t('storybook.label.required')}</span>
      </Label>
      <Input id="req-input" required />
    </div>
  )
}

export const Optional: Story = {
  render: () => <OptionalDemo />,
}

function OptionalDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-72 gap-2">
      <Label htmlFor="opt-input">
        Class name{' '}
        <span className="text-muted-foreground">{t('storybook.label.optional')}</span>
      </Label>
      <Input id="opt-input" />
    </div>
  )
}
