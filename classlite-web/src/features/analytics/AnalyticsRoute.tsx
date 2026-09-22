/**
 * AnalyticsRoute — the role-branched dispatcher at `/analytics` (Story 8-2b,
 * Task 3, AC2/AC3). Mirrors `DashboardRoute`: reads `useRole()` /
 * `useRoleLoading()` and mounts exactly ONE branch. The branch is CONTENT, not
 * access — there is NO `RouteRoleGate`; the 8-2a endpoint self-scopes server-side
 * (a teacher only ever sees their own classes), so a branch slip would surface
 * the caller's own wrong layout, never another tenant's data.
 *
 * The D-TEST **P0 blocking-merge** gate lives here — the leak hides in the branch
 * predicate:
 *   - while `useRoleLoading()` is true → the checking state, NEVER a branch NOR a
 *     redirect (no wrong-branch flash mid-hydration, AC22e).
 *   - `student` → `<Navigate to="/my-performance" replace />`. The student branch
 *     mounts NOTHING that fetches `GET /api/analytics` (which would 403) — the
 *     home container is on the staff branch only, so zero analytics fetch fires
 *     (AC3/AC22d).
 *   - `teacher | owner | admin` → the analytics home.
 *   - settled null/unknown role (this route is intentionally ungated) →
 *     `<Navigate to="/login" replace />` rather than an unbounded spinner.
 */
import type { ReactElement } from 'react'
import { Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useRole, useRoleLoading } from '@/hooks/useRole'
import { AnalyticsHomeContainer } from './components/AnalyticsHomeContainer'

/** Hydration-safe placeholder while the role resolves. */
function AnalyticsChecking(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="analytics-checking"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[50vh] w-full items-center justify-center text-sm text-[var(--cl-ink-soft)]"
    >
      {t('app.routeGate.checkingAccess')}
    </div>
  )
}

export function AnalyticsRoute(): ReactElement {
  const role = useRole()
  const roleLoading = useRoleLoading()

  // Never flash a branch (nor fire the student redirect) mid-hydration.
  if (roleLoading) return <AnalyticsChecking />

  // Student → redirect BEFORE any analytics fetch (the API 403s them).
  if (role === 'student') return <Navigate to="/my-performance" replace />

  // Staff → the analytics home (the fetch lives on this branch only).
  if (role === 'owner' || role === 'admin' || role === 'teacher') {
    return <AnalyticsHomeContainer />
  }

  // Settled null/unknown role on an ungated route → login, not a stuck spinner.
  return <Navigate to="/login" replace />
}

export default AnalyticsRoute
