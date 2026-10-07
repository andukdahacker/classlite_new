/**
 * InboxRoute — the single role-branched `/inbox` dispatcher (Story 10-1b, DD1).
 * Mirrors `DashboardRoute`: every authenticated role lands here (the branch is
 * CONTENT, not access — NO `RouteRoleGate`, every role has an inbox); it reads
 * `useRole()` / `useRoleLoading()` and `lazy`-mounts exactly ONE of four role
 * views (UX-3), each a separate Rolldown chunk so a student never ships the owner
 * billing/alerts view. Role-scope is a 10-1a WRITE invariant — a branch slip would
 * only ever surface the caller's own wrong lens, never another tenant's data.
 *
 * While `useRoleLoading()` is true the checking state renders (no wrong-view flash
 * mid-hydration). Once SETTLED, a null role means unauthenticated → `/login`.
 * Unlike the dashboard, admin ≠ owner here — the inbox lanes differ (DD8).
 */
import { lazy, Suspense, type ReactElement } from 'react'
import { Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { useRole, useRoleLoading } from '@/hooks/useRole'

const OwnerInbox = lazy(() => import('@/features/inbox/OwnerInbox'))
const AdminInbox = lazy(() => import('@/features/inbox/AdminInbox'))
const TeacherInbox = lazy(() => import('@/features/inbox/TeacherInbox'))
const StudentInbox = lazy(() => import('@/features/inbox/StudentInbox'))

/** Hydration-safe placeholder while the role resolves or a role chunk loads. */
function InboxChecking(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="inbox-checking"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[50vh] w-full items-center justify-center text-sm text-[var(--cl-ink-soft)]"
    >
      {t('app.routeGate.checkingAccess')}
    </div>
  )
}

export function InboxRoute(): ReactElement {
  const role = useRole()
  const roleLoading = useRoleLoading()

  if (roleLoading) return <InboxChecking />

  if (role !== 'owner' && role !== 'admin' && role !== 'teacher' && role !== 'student') {
    return <Navigate to="/login" replace />
  }

  return (
    <Suspense fallback={<InboxChecking />}>
      {role === 'owner' ? (
        <OwnerInbox />
      ) : role === 'admin' ? (
        <AdminInbox />
      ) : role === 'teacher' ? (
        <TeacherInbox />
      ) : (
        <StudentInbox />
      )}
    </Suspense>
  )
}

export default InboxRoute
