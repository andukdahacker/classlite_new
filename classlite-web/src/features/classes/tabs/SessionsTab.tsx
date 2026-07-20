/**
 * SessionsTab — Story 3.2 (AC3). Dormant: renders ONLY the ComingSoonPanel.
 */
// epic: 3.4 — swap ComingSoonPanel for the real schedule/session list (sessions table).
import { type ReactElement } from 'react'
import { ComingSoonPanel } from '../components/ComingSoonPanel'

export default function SessionsTab(): ReactElement {
  return (
    <ComingSoonPanel
      titleKey="classes.detail.comingSoon.sessions.title"
      bodyKey="classes.detail.comingSoon.sessions.body"
      testid="class-tab-sessions-coming-soon"
    />
  )
}
