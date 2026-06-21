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
