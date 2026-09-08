/**
 * StudentsCenterPage — Story 7.2b (s42, AC7-10). The center-wide roster: a thin
 * wrapper that renders the shared `StudentRosterView` in the `center` variant
 * (all `role='student'` members center-wide, backend-scoped). Mounted at
 * `/people/students` behind `RouteRoleGate allowedRoles={['owner','admin']}`.
 */
import type { ReactElement } from 'react'
import { StudentRosterView } from './components/StudentRosterView'

export function StudentsCenterPage(): ReactElement {
  return <StudentRosterView variant="center" />
}
