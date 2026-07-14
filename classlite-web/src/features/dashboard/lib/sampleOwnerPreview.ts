/**
 * sampleOwnerPreview — hardcoded 4-tile fixture for the Operator persona's
 * SampleDashboardPreview (Story 2-4 AC8).
 *
 * The tile labels are i18n keys resolved at render time; only the tile
 * ORDER + placeholder value glyph (`em-dash`) lives in this fixture.
 * When Epic 8 wires real center-pulse analytics, this fixture is
 * discarded — the card graduates to a live data component.
 */
export interface OwnerPreviewTile {
  key:
    | 'sessionsToday'
    | 'gradingQueue'
    | 'atRiskStudents'
    | 'attendance'
  labelKey: string
}

export const sampleOwnerPreview: OwnerPreviewTile[] = [
  {
    key: 'sessionsToday',
    labelKey: 'dashboard.samplePreview.stat.sessionsToday',
  },
  {
    key: 'gradingQueue',
    labelKey: 'dashboard.samplePreview.stat.gradingQueue',
  },
  {
    key: 'atRiskStudents',
    labelKey: 'dashboard.samplePreview.stat.atRiskStudents',
  },
  {
    key: 'attendance',
    labelKey: 'dashboard.samplePreview.stat.attendance',
  },
]

export const OWNER_PREVIEW_PLACEHOLDER = '—' // em-dash — UX §6.4 ghosted frame
