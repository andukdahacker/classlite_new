/**
 * AnalyticsTab — Story 3.2 (AC3). Dormant: renders ONLY the ComingSoonPanel.
 * Analytics is the epic-designated placeholder — same dormant treatment.
 */
// epic: 8 — swap ComingSoonPanel for the real class analytics surface.
import { type ReactElement } from 'react'
import { ComingSoonPanel } from '../components/ComingSoonPanel'

export default function AnalyticsTab(): ReactElement {
  return (
    <ComingSoonPanel
      titleKey="classes.detail.comingSoon.analytics.title"
      bodyKey="classes.detail.comingSoon.analytics.body"
      testid="class-tab-analytics-coming-soon"
    />
  )
}
