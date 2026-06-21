import type { ReactNode } from 'react'

/**
 * TopbarShell — `s06` 56px topbar.
 *
 * Three-slot layout: `breadcrumb` (left) + `search` (right) + `cta`
 * (right-most, section CTA — `+ New class`, `Invite staff`, etc.).
 *
 * Mobile responsive variant: at sub-`md` breakpoints the topbar becomes
 * the mobile eyebrow + title pattern (UX-4 + UX-DR32). Per the inventory
 * `MobileTopbar` row at `component-inventory.md` line 380, the mobile
 * pattern is a responsive variant of `TopbarShell`, NOT a separate
 * `MobileTopbar.tsx`. The `search` slot collapses below `md`; `cta`
 * moves into the topbar right side as an icon-only affordance.
 */
export interface TopbarShellProps {
  breadcrumb: ReactNode
  search?: ReactNode
  /** Section-specific CTA (e.g. `<Button>+ New class</Button>`). */
  cta?: ReactNode
}

export function TopbarShell({ breadcrumb, search, cta }: TopbarShellProps) {
  return (
    <header
      role="banner"
      data-testid="topbar-shell"
      className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{breadcrumb}</div>
      <div className="flex items-center gap-3">
        {search ? <div className="hidden md:flex">{search}</div> : null}
        {cta ? <div className="flex items-center">{cta}</div> : null}
      </div>
    </header>
  )
}
