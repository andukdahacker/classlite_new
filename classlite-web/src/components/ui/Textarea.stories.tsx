/**
 * Textarea — Story 1d-2 AC1.
 *
 * Code review 2026-06-17 fix: previous revision wired the textarea label
 * to `t('auth.common.email')` (renders "Email" next to a notes field) and
 * reused `storybook.placeholder.longViText` as both helper text and a
 * validation error message. Dedicated `storybook.textarea.*` keys now
 * carry the right semantic — the placeholder still consumes the long
 * Vietnamese diacritic fixture for typography clearance verification.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { Textarea } from './textarea'
import { Label } from './label'

const meta = {
  title: 'ui/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

function NotesArea(props: React.ComponentProps<typeof Textarea>) {
  const { t } = useTranslation()
  return (
    <Textarea
      placeholder={t('storybook.placeholder.longViText')}
      className="w-80"
      {...props}
    />
  )
}

export const Default: Story = {
  render: (args) => <NotesArea {...args} />,
}

export const WithLabel: Story = {
  render: () => <WithLabelDemo />,
}

function WithLabelDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-80 gap-2">
      <Label htmlFor="notes">{t('storybook.textarea.label')}</Label>
      <NotesArea id="notes" />
    </div>
  )
}

export const WithHelperText: Story = {
  render: () => <WithHelperDemo />,
}

function WithHelperDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-80 gap-2">
      <Label htmlFor="notes-help">{t('storybook.textarea.label')}</Label>
      <NotesArea id="notes-help" aria-describedby="notes-help-text" />
      <p id="notes-help-text" className="text-sm text-muted-foreground">
        {t('storybook.textarea.helper')}
      </p>
    </div>
  )
}

export const WithError: Story = {
  render: () => <WithErrorDemo />,
}

function WithErrorDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid w-80 gap-2">
      <Label htmlFor="notes-err">{t('storybook.textarea.label')}</Label>
      <NotesArea
        id="notes-err"
        aria-invalid="true"
        aria-describedby="notes-err-msg"
      />
      <p id="notes-err-msg" className="text-sm text-destructive">
        {t('storybook.textarea.errorTooLong')}
      </p>
    </div>
  )
}

export const Disabled: Story = {
  render: () => <NotesArea disabled />,
}

export const ReadOnly: Story = {
  render: () => <ReadOnlyDemo />,
}

function ReadOnlyDemo() {
  const { t } = useTranslation()
  return <NotesArea readOnly defaultValue={t('storybook.textarea.readOnlyContents')} />
}
