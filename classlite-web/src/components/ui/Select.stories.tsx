/**
 * Select — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'

const meta = {
  title: 'ui/Select',
  component: Select,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56" aria-label="Select class">
        <SelectValue placeholder="Pick a class" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ielts-7">IELTS 7.0 evening</SelectItem>
        <SelectItem value="ielts-65">IELTS 6.5 morning</SelectItem>
        <SelectItem value="ielts-6">IELTS 6.0 weekend</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const WithPlaceholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56" aria-label="Select class">
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Option A</SelectItem>
        <SelectItem value="b">Option B</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const WithGroups: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56" aria-label="Select class">
        <SelectValue placeholder="Pick a class" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Evening</SelectLabel>
          <SelectItem value="e1">IELTS 7.0 evening</SelectItem>
          <SelectItem value="e2">IELTS 6.5 evening</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Weekend</SelectLabel>
          <SelectItem value="w1">IELTS 6.0 weekend</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Select disabled>
      <SelectTrigger className="w-56" aria-label="Select class">
        <SelectValue placeholder="Disabled" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="x">Option</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const LongVietnameseOption: Story = {
  render: () => <LongViDemo />,
}

function LongViDemo() {
  const { t } = useTranslation()
  return (
    <Select>
      <SelectTrigger className="w-72" aria-label="Chọn lớp">
        <SelectValue placeholder={t('storybook.placeholder.longViText')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="long">{t('storybook.placeholder.longViText')}</SelectItem>
        <SelectItem value="short">{t('app.layout.userPill.roleLabel.teacher')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
