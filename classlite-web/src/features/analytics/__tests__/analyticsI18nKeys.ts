// Story 8-2b i18n key ratchet — the COMPLETE enumeration of the `analytics.*`
// keys this story ships, plus the existing keys it reuses. Extracted into a
// plain (non-`.test`) module at code-review 2026-09-22 so the master ratchet
// (`i18n-parity-coverage.test.ts`) can import the list WITHOUT importing a
// `.test` file — importing a spec module re-executes its `describe/test`
// registrations, running the analytics i18n suite twice.
//
// This list must stay EXHAUSTIVE: every `analytics.*` key added to en.json /
// vi.json belongs here so the parity + interpolation-token ratchet guards it
// (a vi-only omission of any listed key fails CI).

/** NEW analytics keys this story introduces (both locales, co-primary). */
export const STORY_8_2B_KEYS: readonly string[] = [
  // shared placeholder + states
  'analytics.placeholder.dash',
  'analytics.error.retry',
  'analytics.error.message',
  'analytics.desktopHint',
  // home s45
  'analytics.home.title',
  'analytics.home.subtitle',
  'analytics.home.empty.headline',
  'analytics.home.empty.action',
  'analytics.home.empty.teacherHint',
  'analytics.home.teacherPerf.title',
  'analytics.home.teacherPerf.comingSoon',
  'analytics.home.teacherPerf.notVisibleTag',
  // scope bar (presentational, D15)
  'analytics.scope.period',
  // class summary card mini-stats (home)
  'analytics.summary.avgBand',
  'analytics.summary.students',
  'analytics.summary.atRisk',
  'analytics.summary.onTime',
  'analytics.summary.onTrack',
  // class perf s46 — stats + target
  'analytics.stat.cohortAvg',
  'analytics.stat.delta',
  'analytics.stat.target',
  'analytics.stat.atRisk',
  'analytics.stat.onTime',
  'analytics.noTarget.headline',
  'analytics.noTarget.action',
  'analytics.class.notFound',
  // zone headings
  'analytics.zone.stats',
  'analytics.zone.trend',
  'analytics.zone.heatmap',
  'analytics.zone.mistakes',
  'analytics.zone.atRisk',
  'analytics.zone.onTime',
  // heatmap
  'analytics.heatmap.criterionColumn',
  'analytics.heatmap.cellLabel',
  'analytics.heatmap.noGrade',
  'analytics.heatmap.legend.target',
  'analytics.heatmap.legend.atTarget',
  'analytics.heatmap.legend.farFromTarget',
  'analytics.heatmap.noWriting',
  // band trend
  'analytics.trend.ariaLabel',
  'analytics.trend.noTarget',
  'analytics.trend.empty',
  // mistakes
  'analytics.mistakes.type.recurring',
  'analytics.mistakes.type.strength',
  'analytics.mistakes.trend.improving',
  'analytics.mistakes.trend.worsening',
  'analytics.mistakes.trend.stable',
  'analytics.mistakes.frequency',
  'analytics.mistakes.affected',
  'analytics.mistakes.excludedNote',
  'analytics.mistakes.empty',
  // skill source tags
  'analytics.skillSource.writing',
  'analytics.skillSource.speaking',
  // at-risk
  'analytics.atRisk.attendance',
  'analytics.atRisk.band',
  'analytics.atRisk.empty',
  // on-time zone
  'analytics.onTime.detail',
  // my-performance placeholder (student redirect target)
  'analytics.myPerformance.empty.headline',
  'analytics.myPerformance.empty.body',
  'analytics.myPerformance.empty.disclaimer',
]

/** EXISTING keys the story REUSES (must NOT be duplicated under analytics.*). */
export const STORY_8_2B_REUSED_KEYS: readonly string[] = [
  'scopeBar.scope.mine',
  'scopeBar.classPicker.label',
  'people.student.status.atRisk',
  'dashboard.atRisk.reason.attendance_below_floor',
  'dashboard.atRisk.reason.consecutive_missed',
  'dashboard.atRisk.reason.band_drop',
]
