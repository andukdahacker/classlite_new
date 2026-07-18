/**
 * RouteRoleGate — Story 2.6 (AC5, AC6).
 *
 * React Router v7 `element:` wrapper that guards a subtree by role.
 * Renders `<Outlet />` when `useRole()` is in `allowedRoles`, renders
 * `<PermissionDenied>` on deny, and renders `loadingFallback`
 * (defaulting to `<RouteAccessCheckingCard>`) while `useRoleLoading()`
 * is true — the boot-probe / role-hydration window per
 * [[feedback_check_prior_story_artifacts_before_generating]]'s
 * CR-2-5A-7 fold.
 *
 * NOT `errorElement:` — `errorElement` fires on thrown loader/render
 * errors, not policy deny. The shipped TODOs at `SettingsPage.tsx:25`,
 * `PermissionDenied.tsx:17`, and `routes.tsx:293-294` that referenced
 * "errorElement" are being retired in Story 2.6's Task 7.3.
 */
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useRole, useRoleLoading } from '@/hooks/useRole'
import type { Role } from '@/features/auth/api/authKeys'
import PermissionDenied, {
  type PermissionDeniedRoles,
  type SectionNameKey,
} from '@/components/shared/PermissionDenied'
import { RouteAccessCheckingCard } from '@/components/shared/RouteAccessCheckingCard'

export interface RouteRoleGateProps {
  /**
   * Roles that pass the gate. Order-independent set — a caller-controlled
   * allowlist per route. E.g. `['owner']` for /settings; `['owner', 'admin']`
   * for /people/invites once Epic 7's frontend lands.
   */
  allowedRoles: readonly Role[]
  /**
   * The role-summary label the PermissionDenied screen renders. Kept
   * separate from `allowedRoles` because the deny copy is one of two
   * pinned variants (Owner-only vs Owner+Admin) and MUST match the
   * PermissionDeniedRoles union — never a synthesized list.
   */
  requiredRolesForCopy: PermissionDeniedRoles
  /**
   * Section that PermissionDenied names in its sub-header. Optional so
   * the bare `/permission-denied` URL still works without one; every
   * route-mounted gate SHOULD supply one.
   */
  sectionNameKey?: SectionNameKey
  /**
   * Fallback rendered while the role is still being resolved (boot probe
   * in flight OR session cache lacks role). Defaults to the shared
   * `<RouteAccessCheckingCard>` — override to inline a route-specific
   * skeleton if a route has a distinct loading shape.
   */
  loadingFallback?: ReactNode
}

export default function RouteRoleGate({
  allowedRoles,
  requiredRolesForCopy,
  sectionNameKey,
  loadingFallback,
}: RouteRoleGateProps) {
  const role = useRole()
  const loading = useRoleLoading()

  // Loading takes precedence over deny — boot-probe MUST NOT flash
  // PermissionDenied [Winston-STRONG-3]. Even when role is null, if the
  // probe is in flight we render the fallback rather than the deny screen.
  if (loading) {
    return loadingFallback ?? <RouteAccessCheckingCard />
  }

  if (role !== null && allowedRoles.includes(role)) {
    return <Outlet />
  }

  return (
    <PermissionDenied
      requiredRoles={requiredRolesForCopy}
      sectionNameKey={sectionNameKey}
    />
  )
}
