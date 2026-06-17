/**
 * Card — Story 1d-2 AC5.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'
import { Button } from './button'

const meta = {
  title: 'ui/Card',
  component: Card,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardContent>Plain card surface.</CardContent>
    </Card>
  ),
}

export const WithHeader: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>IELTS 7.0 evening</CardTitle>
        <CardDescription>18 enrolled · Mon / Wed / Fri</CardDescription>
      </CardHeader>
      <CardContent>Class detail summary.</CardContent>
    </Card>
  ),
}

export const WithFooter: Story = {
  render: () => (
    <Card className="w-80">
      <CardContent>Class summary.</CardContent>
      <CardFooter>
        <Button size="sm">Open class</Button>
      </CardFooter>
    </Card>
  ),
}

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>IELTS 7.0 evening</CardTitle>
        <CardDescription>18 enrolled</CardDescription>
        <CardAction>
          <Button size="sm" variant="ghost">…</Button>
        </CardAction>
      </CardHeader>
      <CardContent>Mon / Wed / Fri · 18:00.</CardContent>
      <CardFooter>
        <Button size="sm">Open</Button>
      </CardFooter>
    </Card>
  ),
}

export const Interactive: Story = {
  render: () => (
    <Card className="w-80 transition-colors hover:bg-muted/50">
      <CardContent>Hover for the interactive state.</CardContent>
    </Card>
  ),
}
