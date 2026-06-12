/**
 * useRole — the current user's role for the active center.
 *
 * Story 1-7c ships this as a stub that returns null. Story 2-6 (roles &
 * permissions) fills the body and wires `errorElement: <PermissionDenied />`
 * on guarded routes. The role enum matches the architecture's domain model
 * — Owner > Admin > Teacher; Student is a separate consumer role.
 */

export type Role = 'owner' | 'admin' | 'teacher' | 'student'

export function useRole(): Role | null {
  return null
}
