/**
 * Pagination — Story 1d-2 AC6.
 *
 * Query contract: `?page=2&pageSize=10` (XL-2), NEVER `?offset=20&limit=10`.
 * SQL conversion: `OFFSET (page-1)*pageSize LIMIT pageSize`. The deferred
 * `Pagination` wrapper inherits this contract.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'

const meta = {
  title: 'ui/Pagination',
  component: Pagination,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Pagination>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive size="icon" className="font-mono">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">2</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}

export const FirstPage: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationLink href="#" isActive size="icon" className="font-mono">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">2</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}

export const MiddlePage: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive size="icon" className="font-mono">7</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">12</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}

export const LastPage: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">10</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">11</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive size="icon" className="font-mono">12</PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}

export const WithEllipsis: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" size="icon" className="font-mono">12</PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}
