/**
 * Avatar — Story 1d-2 AC4.
 *
 * Avatar colors are identity-only, NEVER status. For status indication
 * use `Badge` `Destructive` / `Warn`. The six-color rotation maps to
 * `--cl-accent` / `--cl-accent-2` / `--cl-green` / `--cl-amber` /
 * `--cl-red` / `--cl-muted` via the Tailwind arbitrary-value syntax
 * `bg-[color:var(--cl-...)]` — never hex literals, never inline styles.
 * AC7 + Avatar story header note.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { UserIcon } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from './avatar'

const meta = {
  title: 'ui/Avatar',
  component: Avatar,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
}

/**
 * `WithImage` uses an inline transparent-pixel data URL so the story has
 * no external network dependency — Storybook stories must not depend on
 * github.com or any third-party asset host (air-gapped CI breaks; upstream
 * URLs rot). The transparent pixel forces the `AvatarFallback` path
 * (visible initials) which is the contract the deferred Image-with-broken-url
 * variant will inherit. Real avatar images live in feature stories that
 * carry their own fixture assets under `src/assets/fixtures/`.
 */
const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

export const WithImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src={TRANSPARENT_PIXEL_DATA_URL} alt="ClassLite teacher" />
      <AvatarFallback>SC</AvatarFallback>
    </Avatar>
  ),
}

export const WithInitials: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
}

export const SizeSm: Story = {
  render: () => (
    <Avatar size="sm">
      <AvatarFallback>SM</AvatarFallback>
    </Avatar>
  ),
}

// SizeMd intentionally omitted — `avatar.tsx` types `size` as
// `"default" | "sm" | "lg"`; the default IS the md scale per the
// editorial-ledger sizing. Adding a SizeMd story would render identical
// to `Default` (code review 2026-06-17).

export const SizeLg: Story = {
  render: () => (
    <Avatar size="lg">
      <AvatarFallback>LG</AvatarFallback>
    </Avatar>
  ),
}

/**
 * Six identity-color rotations (A1..A6). Background routed through the
 * `--cl-*` source tokens via Tailwind arbitrary values; foreground stays
 * on the bridged `text-primary-foreground` (paper white) for contrast.
 */
const COLORS = [
  { key: 'A1', bg: 'bg-[color:var(--cl-accent)]' },
  { key: 'A2', bg: 'bg-[color:var(--cl-accent-2)]' },
  { key: 'A3', bg: 'bg-[color:var(--cl-green)]' },
  { key: 'A4', bg: 'bg-[color:var(--cl-amber)]' },
  { key: 'A5', bg: 'bg-[color:var(--cl-red)]' },
  { key: 'A6', bg: 'bg-[color:var(--cl-muted)]' },
] as const

function ColoredAvatar({ index }: { index: 0 | 1 | 2 | 3 | 4 | 5 }) {
  const { key, bg } = COLORS[index]
  return (
    <Avatar>
      <AvatarFallback className={`${bg} text-primary-foreground`}>
        <UserIcon aria-hidden="true" className="size-4" />
        <span className="sr-only">{key}</span>
      </AvatarFallback>
    </Avatar>
  )
}

export const ColoredA1: Story = { render: () => <ColoredAvatar index={0} /> }
export const ColoredA2: Story = { render: () => <ColoredAvatar index={1} /> }
export const ColoredA3: Story = { render: () => <ColoredAvatar index={2} /> }
export const ColoredA4: Story = { render: () => <ColoredAvatar index={3} /> }
export const ColoredA5: Story = { render: () => <ColoredAvatar index={4} /> }
export const ColoredA6: Story = { render: () => <ColoredAvatar index={5} /> }
