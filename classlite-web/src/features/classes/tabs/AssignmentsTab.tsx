/**
 * AssignmentsTab — Story 3.2 (AC3). Dormant: renders ONLY the ComingSoonPanel.
 */
// epic: 5 — swap ComingSoonPanel for the real AssignmentList (assignments table).
import { type ReactElement } from 'react'
import { ComingSoonPanel } from '../components/ComingSoonPanel'

export default function AssignmentsTab(): ReactElement {
  return (
    <ComingSoonPanel
      titleKey="classes.detail.comingSoon.assignments.title"
      bodyKey="classes.detail.comingSoon.assignments.body"
      testid="class-tab-assignments-coming-soon"
    />
  )
}
