/**
 * AuthLayout — root of the auth lazy bundle group.
 *
 * Pre-auth pages (login, register, forgot password, reset password,
 * email verification, invite acceptance) mount as children of this
 * layout. The router lazy-loads AuthLayout as the auth chunk entry, so
 * Rolldown emits a single bundle for the whole auth surface that the
 * student/teacher dashboards never pull in.
 *
 * Story 1-7b ships this as a bare `<Outlet />` container — the polished
 * `AuthCard` styling, layout grid, and brand mark land with Story 1-8
 * (auth UI) per Epic 1C.
 */
import { Outlet } from 'react-router'

export default function AuthLayout() {
  return (
    <main className="min-h-screen bg-[var(--cl-paper)]">
      <Outlet />
    </main>
  )
}
