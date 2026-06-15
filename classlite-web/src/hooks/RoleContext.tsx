/* eslint-disable react-refresh/only-export-components --
 * Context value + Provider co-export is the standard React pattern; the
 * two belong together for discoverability. HMR for the role override
 * seam is non-critical (it is a single-value Provider).
 */
import { createContext, type ReactNode } from 'react'
import type { Role } from './useRole'

/**
 * RoleContext — overrideable seam for `useRole()`.
 *
 * `null` (the default) means "no override is active" — `useRole()` falls
 * back to its real-world resolution. Story 1-7c ships that resolution as a
 * stub returning null; Story 2-6 replaces it with the auth-driven role.
 *
 * Why this exists at all (Story 1d-1 AC2 #5): the Storybook role-toolbar
 * decorator wraps every story in `<RoleProvider value={selectedRole}>` so
 * `useRole()` returns the toolbar-selected role inside the story render.
 * Component tests use the same provider to assert role-gated rendering
 * (per UX-3 / TEST-FE-6). No new authorization surface — the real
 * authorization gate is service-layer (SEC-1).
 */
export const RoleContext = createContext<Role | null>(null)

/**
 * RoleProvider — set an explicit role for the subtree.
 *
 * Use in Storybook decorators and in tests that need to render a
 * role-gated component without spinning up the real auth flow.
 */
export function RoleProvider({
  value,
  children,
}: {
  value: Role | null
  children: ReactNode
}) {
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}
