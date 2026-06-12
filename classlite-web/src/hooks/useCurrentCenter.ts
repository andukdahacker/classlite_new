/**
 * useCurrentCenter — the active tenant for the dashboard.
 *
 * Story 1-7c ships this as a stub that returns null. Story 2-2 (center
 * setup wizard) fills the body — the real hook reads the center slug
 * from the URL subdomain and surfaces the matching center via TanStack
 * Query.
 */

export interface Center {
  id: string
  name: string
  slug: string
}

export function useCurrentCenter(): Center | null {
  return null
}
