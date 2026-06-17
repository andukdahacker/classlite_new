/**
 * Slider — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Slider } from './slider'

const meta = {
  title: 'ui/Slider',
  component: Slider,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Slider className="w-72" defaultValue={[40]} />,
}

export const WithSteps: Story = {
  render: () => (
    <Slider className="w-72" defaultValue={[40]} step={10} min={0} max={100} />
  ),
}

export const WithRange: Story = {
  render: () => <Slider className="w-72" defaultValue={[20, 80]} />,
}

export const Disabled: Story = {
  render: () => <Slider className="w-72" defaultValue={[40]} disabled />,
}
