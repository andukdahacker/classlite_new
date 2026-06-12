/**
 * useAuth — app-wide auth state.
 *
 * Story 1-7c ships this as a stub that returns "no session." Story 1-8
 * replaces the body with a `useQuery(authKeys.me, fetchMe)` call backed by
 * `GET /api/auth/me`. The stub returns the exact shape the real hook will
 * return, so consumers compile against it today and need no changes when
 * the real body lands.
 *
 * Do NOT add a fake user object — components that branch on
 * `isAuthenticated` would silently render the authenticated-only branch
 * during the stub window and the regression would be invisible.
 */

export interface User {
  id: string
  email: string
  displayName: string
}

export interface UseAuthResult {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

export function useAuth(): UseAuthResult {
  return { user: null, isAuthenticated: false, isLoading: false }
}
