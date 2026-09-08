/**
 * StudentsTeacherPage — Story 7.2b (s10a, AC4-6). The teacher roster: a thin
 * wrapper that renders the shared `StudentRosterView` in the `teacher` variant
 * (own-class scope enforced server-side, 7-2a D3). Mounted at `/students`
 * behind `RouteRoleGate allowedRoles={['teacher']}` — activating the shipped
 * DEAD sidebar link (D1).
 */
import type { ReactElement } from 'react'
import { StudentRosterView } from './components/StudentRosterView'

export function StudentsTeacherPage(): ReactElement {
  return <StudentRosterView variant="teacher" />
}
