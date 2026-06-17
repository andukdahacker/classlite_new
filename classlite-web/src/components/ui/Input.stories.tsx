/**
 * Input — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'ui/Input',
  component: Input,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

function EmailInput(props: React.ComponentProps<typeof Input>) {
  const { t } = useTranslation()
  return <Input type="email" placeholder={t('storybook.placeholder.email')} {...props} />
}

export const Default: Story = {
  render: (args) => <EmailInput {...args} />,
}

export const WithLabel: Story = {
  render: () => {
    return <WithLabelDemo />
  },
}

function WithLabelDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email">{t('auth.common.email')}</Label>
      <EmailInput id="email" />
    </div>
  )
}

export const WithHelperText: Story = {
  render: () => {
    return <WithHelperDemo />
  },
}

function WithHelperDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email-helper">{t('auth.common.email')}</Label>
      <EmailInput id="email-helper" aria-describedby="email-helper-text" />
      <p id="email-helper-text" className="text-sm text-muted-foreground">
        {t('storybook.placeholder.email')}
      </p>
    </div>
  )
}

export const WithError: Story = {
  render: () => {
    return <WithErrorDemo />
  },
}

function WithErrorDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email-err">{t('auth.common.email')}</Label>
      <EmailInput
        id="email-err"
        aria-invalid="true"
        aria-describedby="email-err-msg"
        defaultValue="not-an-email"
      />
      <p id="email-err-msg" className="text-sm text-destructive">
        {t('storybook.placeholder.email')}
      </p>
    </div>
  )
}

export const Disabled: Story = {
  render: () => <EmailInput disabled />,
}

export const ReadOnly: Story = {
  render: () => <EmailInput readOnly defaultValue="readonly@example.com" />,
}

/**
 * `LabeledNumericInput` — canonical layout per AC1 + AC7. `font-mono`
 * (Geist Mono) applies to the typed value ONLY; label + helper text stay
 * on `font-sans` (Geist).
 */
export const LabeledNumericInput: Story = {
  render: () => {
    return <LabeledNumericInputDemo />
  },
}

function LabeledNumericInputDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-56 gap-2 font-sans">
      <Label htmlFor="hours">{t('storybook.input.hoursLabel')}</Label>
      <Input id="hours" type="number" defaultValue={12} className="font-mono" />
      <p className="text-sm text-muted-foreground">
        {t('storybook.input.hoursHelper')}
      </p>
    </div>
  )
}
