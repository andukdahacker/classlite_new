import type { ReactNode } from 'react'

import { PageHead } from './PageHead'
import { ScopeBar, type ScopeBarProps } from './ScopeBar'
import type { Role } from '@/hooks/useRole'

/**
 * AnalyticsHomeShell — `s45` (teacher) / `s48` (admin / owner) analytics
 * home container. Story 1d-4 AC7.
 *
 * Static visual identity only. Behavior — TanStack Query analytics
 * fetching, scope-aware refetch, RBAC enforcement on scope changes —
 * ships in Epic 8 Story 8.2. RBAC is the route layer's job per UX-3;
 * `ScopeBar.disabledScopes` only controls visual disablement.
 *
 * Slot children are analytics card chrome — the consumer (Epic 8) passes
 * the Skeleton-shaped chart areas. This shell owns the PageHead +
 * ScopeBar layout only.
 */
export interface AnalyticsHomeShellProps {
  role: Role
  children: ReactNode
  /** Header config passes through to PageHead from 1d-3. */
  titleKey: string
  subKey?: string
  scopeBar: ScopeBarProps
}

export function AnalyticsHomeShell({
  role,
  children,
  titleKey,
  subKey,
  scopeBar,
}: AnalyticsHomeShellProps) {
  return (
    <section
      data-testid="analytics-home-shell"
      data-role={role}
      className="flex flex-col gap-4"
    >
      <PageHead titleKey={titleKey} subKey={subKey} />
      <ScopeBar {...scopeBar} />
      <div
        data-testid="analytics-home-shell-grid"
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        {children}
      </div>
    </section>
  )
}
