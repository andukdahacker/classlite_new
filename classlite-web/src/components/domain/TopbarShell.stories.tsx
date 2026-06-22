// storybook-rule: no-three-state
/**
 * TopbarShell — `s06` 56px topbar. 1d-3 AC1.
 *
 * Pure layout (three slots) — exempted from the *Shell three-state lint
 * via the allowlist in `required-exports.ts` (Option A — predicate-gated
 * closed set {AppShell, SidebarShell, TopbarShell}, closed 2026-06-18
 * by Ducdo). See storybook-conventions.md § 3 sub-section for the
 * predicate. The `no-three-state` directive is a belt-and-braces
 * fallback for future fixture sweeps.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BreadcrumbBar } from './BreadcrumbBar'
import { SearchPill } from './SearchPill'
import { TopbarShell } from './TopbarShell'

const meta = {
  title: 'domain/TopbarShell',
  component: TopbarShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TopbarShell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    breadcrumb: (
      <BreadcrumbBar
        items={[
          { label: 'Workspace', href: '/' },
          { label: 'Classes', href: '/classes' },
          { label: 'IELTS 7.0 evening' },
        ]}
      />
    ),
    search: <SearchPill placeholderKey="topbar.search.placeholder" />,
    cta: <Button>+ New class</Button>,
  },
}

/**
 * Story 1d-3 code-review D1 — TopbarShell exposes a `collapseToggle?`
 * slot for a desktop-only hamburger button. The actual `useUIStore`
 * subscription lives in the consumer (AppLayout) so TopbarShell stays
 * free of store reads.
 */
export const WithCollapseToggle: Story = {
  args: {
    breadcrumb: (
      <BreadcrumbBar
        items={[
          { label: 'Workspace', href: '/' },
          { label: 'Classes', href: '/classes' },
        ]}
      />
    ),
    search: <SearchPill placeholderKey="topbar.search.placeholder" />,
    cta: <Button>+ New class</Button>,
    collapseToggle: (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Collapse sidebar"
        data-testid="sidebar-collapse-toggle"
      >
        <Menu aria-hidden="true" className="size-5" />
      </Button>
    ),
  },
}

/**
 * Story 1d-3 code-review D2 — mobile eyebrow + title pattern. The story
 * docs the slot shape; runtime layout at 375×667 is verified by
 * `e2e/storybook/topbar-mobile-pattern.spec.ts` (the test-runner ignores
 * `parameters.viewport`, so a desktop-viewport play assertion can't
 * exercise the breakpoint swap).
 */
export const WithMobileTitle: Story = {
  args: {
    breadcrumb: (
      <BreadcrumbBar
        items={[
          { label: 'Workspace', href: '/' },
          { label: 'Classes', href: '/classes' },
        ]}
        truncateAt={2}
      />
    ),
    search: <SearchPill placeholderKey="topbar.search.placeholder" />,
    cta: <Button size="icon" aria-label="New class">+</Button>,
    mobileTitle: 'IELTS 7.0 evening',
  },
}
