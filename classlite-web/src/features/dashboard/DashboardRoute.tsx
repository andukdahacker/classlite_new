/**
 * DashboardRoute — the single role-branched landing at `/dashboard` (Story
 * 8-1b, D1). Every authenticated role lands here (the branch is CONTENT, not
 * access — there is no `RouteRoleGate`); the dispatcher reads `useRole()` /
 * `useRoleLoading()` and mounts exactly ONE of three separate components (UX-3),
 * each deep-imported (`lazy`) so Rolldown emits a per-role chunk — a student
 * session never pulls in owner/teacher code.
 *
 * While `useRoleLoading()` is true the checking state renders and NEVER a role
 * dashboard (mirrors `RouteRoleGate` precedence — no wrong-dashboard flash mid-
 * hydration). The endpoint self-scopes server-side (`tc.Role`) so a branch slip
 * would only ever surface the caller's own wrong layout, never another tenant's
 * data.
 *
 * Once role resolution has SETTLED (`useRoleLoading()` false) a `null` role means
 * unauthenticated (this route is intentionally ungated, D1) — redirect to `/login`
 * rather than spinning the checking placeholder forever (8-1b review P4).
 */
import { lazy, Suspense, type ReactElement } from 'react'
import { Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useRole, useRoleLoading } from '@/hooks/useRole'

const OwnerDashboard = lazy(() =>
  import('@/features/dashboard/OwnerDashboard').then((module) => ({
    default: module.OwnerDashboard,
  })),
)
const TeacherDashboard = lazy(
  () => import('@/features/dashboard/TeacherDashboard'),
)
const StudentDashboard = lazy(
  () => import('@/features/dashboard/StudentDashboard'),
)

/** Hydration-safe placeholder while the role resolves or a role chunk loads. */
function DashboardChecking(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="dashboard-checking"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[50vh] w-full items-center justify-center text-sm text-[var(--cl-ink-soft)]"
    >
      {t('app.routeGate.checkingAccess')}
    </div>
  )
}

export function DashboardRoute(): ReactElement {
  const role = useRole()
  const roleLoading = useRoleLoading()

  // Never flash the wrong dashboard mid-hydration.
  if (roleLoading) return <DashboardChecking />

  // Role resolution has settled: a null/unknown role is not an authenticated
  // dashboard caller — send them to login rather than an unbounded spinner (P4).
  if (role !== 'owner' && role !== 'admin' && role !== 'teacher' && role !== 'student') {
    return <Navigate to="/login" replace />
  }

  return (
    <Suspense fallback={<DashboardChecking />}>
      {role === 'owner' || role === 'admin' ? (
        <OwnerDashboard />
      ) : role === 'teacher' ? (
        <TeacherDashboard />
      ) : (
        <StudentDashboard />
      )}
    </Suspense>
  )
}

export default DashboardRoute
