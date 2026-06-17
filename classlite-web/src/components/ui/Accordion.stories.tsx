/**
 * Accordion — Story 1d-2 AC5.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './accordion'

const meta = {
  title: 'ui/Accordion',
  component: Accordion,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

const items = [
  { value: 'q1', title: 'How do I add a class?', body: 'Open the Classes screen and select Add class.' },
  { value: 'q2', title: 'How do I grade writing?', body: 'Open the submission and use the writing grading view.' },
  { value: 'q3', title: 'How do I invite teachers?', body: 'From People → Invite, paste the teacher emails.' },
]

export const Default: Story = {
  render: () => (
    <Accordion className="w-80">
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const Single: Story = {
  render: () => (
    <Accordion className="w-80" multiple={false}>
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const Multiple: Story = {
  render: () => (
    <Accordion className="w-80" multiple>
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const DefaultOpen: Story = {
  render: () => (
    <Accordion className="w-80" defaultValue={['q1']}>
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}
