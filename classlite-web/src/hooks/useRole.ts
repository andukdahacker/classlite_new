/**
 * useRole — the current user's role for the active center.
 *
 * Story 1-7c ships this as a stub that returns null. Story 1d-1 adds a
 * `RoleContext` seam so Storybook (and component tests) can override the
 * value without spinning up the real auth flow. Story 2-6 (roles &
 * permissions) replaces the fallback below with the real auth-driven
 * resolution and wires `errorElement: <PermissionDenied />` on guarded
 * routes. The role enum matches the architecture's domain model —
 * Owner > Admin > Teacher; Student is a separate consumer role.
 */
import { useContext } from 'react'
import { RoleContext } from '@/hooks/RoleContext'

export type Role = 'owner' | 'admin' | 'teacher' | 'student'

export function useRole(): Role | null {
  return useContext(RoleContext)
}
