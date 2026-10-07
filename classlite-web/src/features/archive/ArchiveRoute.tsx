/**
 * ArchiveRoute — the `/archive` entry (Story 10.2, AC8). Mirrors InboxRoute's
 * role gate: while the role resolves it renders a hydration-safe checking state;
 * once settled, only staff (owner/admin/teacher) see the archive — a student or
 * an unauthenticated caller is redirected (students are ALSO blocked upstream by
 * the RouteRoleGate in routes.tsx, so no archive data ever reaches a student DOM).
 * All staff render the SAME ArchiveView (the role only derives the cache scope).
 */
import { Suspense, lazy, type ReactElement } from 'react'
import { Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { useRole, useRoleLoading } from '@/hooks/useRole'

const ArchiveView = lazy(() => import('./components/ArchiveView'))

/** Hydration-safe placeholder while the role resolves or the view chunk loads. */
function ArchiveChecking(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="archive-checking"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[50vh] w-full items-center justify-center text-sm text-[var(--cl-ink-soft)]"
    >
      {t('app.routeGate.checkingAccess')}
    </div>
  )
}

export function ArchiveRoute(): ReactElement {
  const role = useRole()
  const roleLoading = useRoleLoading()

  if (roleLoading) return <ArchiveChecking />

  if (role !== 'owner' && role !== 'admin' && role !== 'teacher') {
    // Student or unauthenticated — never render the archive (TEST-FE-6 absence).
    return <Navigate to="/login" replace />
  }

  return (
    <Suspense fallback={<ArchiveChecking />}>
      <ArchiveView />
    </Suspense>
  )
}

export default ArchiveRoute
