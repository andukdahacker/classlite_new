/**
 * MaterialsTab — Story 3.2 (AC3). Dormant: renders ONLY the ComingSoonPanel.
 */
// epic: 3.5 / 4 — swap ComingSoonPanel for the real materials list (session_materials / knowledge-hub).
import { type ReactElement } from 'react'
import { ComingSoonPanel } from '../components/ComingSoonPanel'

export default function MaterialsTab(): ReactElement {
  return (
    <ComingSoonPanel
      titleKey="classes.detail.comingSoon.materials.title"
      bodyKey="classes.detail.comingSoon.materials.body"
      testid="class-tab-materials-coming-soon"
    />
  )
}
