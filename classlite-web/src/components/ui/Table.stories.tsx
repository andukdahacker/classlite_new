/**
 * Table — Story 1d-2 AC6.
 *
 * `Sortable` uses `aria-sort` on header cells per the W3C ARIA grid
 * pattern — the contract the deferred `DataListTable` will consume.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

type Row = { id: string; name: string; status: 'active' | 'archived' }

const ROWS: Row[] = [
  { id: 'c1', name: 'IELTS 7.0 evening', status: 'active' },
  { id: 'c2', name: 'IELTS 6.5 morning', status: 'active' },
  { id: 'c3', name: 'IELTS 6.0 weekend', status: 'archived' },
  { id: 'c4', name: 'Speaking lab', status: 'active' },
  { id: 'c5', name: 'Writing studio', status: 'archived' },
]

const meta = {
  title: 'ui/Table',
  component: Table,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Table className="w-96">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const WithCaption: Story = {
  render: () => (
    <Table className="w-96">
      <TableCaption>Classes scheduled this week.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const WithFooter: Story = {
  render: () => (
    <Table className="w-96">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="font-mono">{ROWS.length}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}

export const Striped: Story = {
  render: () => (
    <Table className="w-96 [&_tbody_tr:nth-child(even)]:bg-muted/40">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const Hoverable: Story = {
  render: () => (
    <Table className="w-96 [&_tbody_tr:hover]:bg-muted/50">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const Sortable: Story = {
  render: () => (
    <Table className="w-96">
      <TableHeader>
        <TableRow>
          <TableHead aria-sort="ascending">Name ↑</TableHead>
          <TableHead aria-sort="none">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const WithMockData: Story = {
  render: () => (
    <Table className="w-96">
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono">{row.id}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}
