/**
 * StudentsTab — Story 3.2 (AC3). Dormant: renders ONLY the ComingSoonPanel.
 */
// epic: 7.3 — swap ComingSoonPanel for the real class roster (enrollments table).
import { type ReactElement } from 'react'
import { ComingSoonPanel } from '../components/ComingSoonPanel'

export default function StudentsTab(): ReactElement {
  return (
    <ComingSoonPanel
      titleKey="classes.detail.comingSoon.students.title"
      bodyKey="classes.detail.comingSoon.students.body"
      testid="class-tab-students-coming-soon"
    />
  )
}
