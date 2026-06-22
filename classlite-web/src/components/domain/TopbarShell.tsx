import type { ReactNode } from 'react'

/**
 * TopbarShell — `s06` topbar.
 *
 * Desktop (≥md): a single 56px row — `collapseToggle` (sidebar hamburger,
 * desktop-only) + `breadcrumb` (left) + `search` + `cta` (right-most,
 * section CTA — `+ New class`, `Invite staff`, etc.).
 *
 * Mobile (sub-md, UX-4 + UX-DR32): a 2-row eyebrow + title pattern per
 * the inventory `MobileTopbar` row at `component-inventory.md` line 380.
 * Row 1 (the eyebrow) renders the breadcrumb in compact form alongside
 * the icon-only CTA. Row 2 (the title) renders the optional
 * `mobileTitle` slot — a page-level heading sized to fill the topbar's
 * mobile real estate. The desktop `search` slot is hidden on mobile and
 * the `collapseToggle` is desktop-only (mobile uses the bottom tab bar
 * for primary nav).
 *
 * Single-uiStore-subscription discipline (Winston, party-mode
 * 2026-06-18). The `collapseToggle` slot is intentionally a `ReactNode`
 * passed in by the consumer — `TopbarShell` does NOT read from
 * `useUIStore`. `AppLayout` is the sole subscriber and renders the
 * actual button with the correct aria-label + click handler.
 */
export interface TopbarShellProps {
  breadcrumb: ReactNode
  search?: ReactNode
  /** Section-specific CTA (e.g. `<Button>+ New class</Button>`). */
  cta?: ReactNode
  /**
   * Sidebar collapse / expand button (desktop-only). Consumer renders
   * the actual `<Button>` with the localized aria-label and
   * `useUIStore` click handler — keeps `TopbarShell` free of store
   * subscriptions. Hidden on sub-md viewports.
   */
  collapseToggle?: ReactNode
  /**
   * Mobile-only page title rendered below the eyebrow row. When unset,
   * the topbar renders a single eyebrow row on mobile. Typically passed
   * by the route layer to mirror the `PageHead.<h1>`.
   */
  mobileTitle?: ReactNode
}

export function TopbarShell({
  breadcrumb,
  search,
  cta,
  collapseToggle,
  mobileTitle,
}: TopbarShellProps) {
  return (
    <header
      role="banner"
      data-testid="topbar-shell"
      className="shrink-0 border-b border-border bg-card"
    >
      {/* Single primary row. Slots reflow with responsive utilities — the
          search slot is hidden below `md`, the collapse toggle is hidden
          below `md` (mobile uses the bottom tab bar), and the breadcrumb
          adopts eyebrow styling (uppercase + smaller) below `md`. Each
          slot appears in the DOM exactly once so `getByRole` queries in
          tests don't double-match. */}
      <div className="flex h-12 items-center justify-between gap-3 px-4 md:h-14">
        {collapseToggle ? (
          <div className="hidden items-center md:flex">{collapseToggle}</div>
        ) : null}
        <div
          className="flex min-w-0 flex-1 items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground md:text-sm md:normal-case md:tracking-normal md:text-foreground"
          data-testid="topbar-eyebrow"
        >
          {breadcrumb}
        </div>
        <div className="flex items-center gap-3">
          {search ? <div className="hidden md:flex">{search}</div> : null}
          {cta ? <div className="flex items-center">{cta}</div> : null}
        </div>
      </div>

      {/* Mobile-only title row sits BELOW the primary row. Hidden above
          `md` — desktop typically renders the H1 inside the page body
          via `PageHead` rather than reading it back in the topbar. */}
      {mobileTitle ? (
        <div className="px-4 pb-3 md:hidden" data-testid="topbar-mobile-title">
          <div className="font-heading text-xl text-foreground">{mobileTitle}</div>
        </div>
      ) : null}
    </header>
  )
}
