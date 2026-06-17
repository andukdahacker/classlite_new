/**
 * Breadcrumb — Story 1d-2 AC6.
 *
 * The contract `1d-3`'s `BreadcrumbBar` will wrap.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'ui/Breadcrumb',
  component: Breadcrumb,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Breadcrumb>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/classes">Classes</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>IELTS 7.0 evening</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}

export const WithEllipsis: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Session detail</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}

export const WithDropdown: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Show more breadcrumb segments"
              className="flex items-center gap-1 text-sm"
            >
              <BreadcrumbEllipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Classes</DropdownMenuItem>
              <DropdownMenuItem>IELTS 7.0</DropdownMenuItem>
              <DropdownMenuItem>Evening</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Session detail</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}

export const LongPath: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        {['Dashboard', 'Classes', 'IELTS 7.0', 'Evening', 'Session detail'].map(
          (segment, index, all) => (
            <Fragment key={segment}>
              <BreadcrumbItem>
                {index === all.length - 1 ? (
                  <BreadcrumbPage>{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={`/${segment.toLowerCase()}`}>
                    {segment}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {index < all.length - 1 ? <BreadcrumbSeparator /> : null}
            </Fragment>
          ),
        )}
      </BreadcrumbList>
    </Breadcrumb>
  ),
}
