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

/**
 * Story 8-3b — student-performance views. NEW analytics.* keys this story adds
 * (teacher s47 detail + softened student s37 + D12 reading|listening skillSource
 * + objective questionType labels + share summary). Every key here is guarded by
 * the master i18n parity + interpolation ratchet.
 */
export const STORY_8_3B_KEYS: readonly string[] = [
  'analytics.skillSource.reading',
  'analytics.skillSource.listening',
  // questionType keys are keyed on the CANONICAL snake_case QuestionGroupType wire
  // values (questionTypes.ts / grading.QuestionTypesByRef) — the backend emits these
  // verbatim into answer_errors[].questionType, so the label must resolve on them, not
  // on camelCase (code-review 2026-09-23 P1: camelCase keys rendered raw tokens).
  'analytics.questionType.true_false_not_given',
  'analytics.questionType.multiple_choice',
  'analytics.questionType.matching',
  'analytics.questionType.fill_in_blank',
  'analytics.questionType.short_answer',
  'analytics.questionType.other',
  'analytics.studentPerformance.title',
  'analytics.studentPerformance.tab.overview',
  'analytics.studentPerformance.tab.mistakes',
  'analytics.studentPerformance.notFound',
  'analytics.studentPerformance.forbidden',
  'analytics.studentPerformance.overview.trendZone',
  'analytics.studentPerformance.overview.breakdownZone',
  'analytics.studentPerformance.overview.statsZone',
  'analytics.studentPerformance.overview.zoneEmpty',
  'analytics.studentPerformance.overview.classAvg',
  'analytics.studentPerformance.overview.overallBand',
  'analytics.studentPerformance.overview.targetGoal',
  'analytics.studentPerformance.stat.graded',
  'analytics.studentPerformance.stat.total',
  'analytics.studentPerformance.stat.onTime',
  'analytics.studentPerformance.stat.praisePins',
  'analytics.studentPerformance.stat.errorPins',
  'analytics.studentPerformance.mistakes.recurringType',
  'analytics.studentPerformance.mistakes.strengthType',
  'analytics.studentPerformance.mistakes.empty',
  'analytics.studentPerformance.mistakes.filterLabel',
  'analytics.studentPerformance.mistakes.filter.all',
  'analytics.studentPerformance.mistakes.frequency',
  'analytics.studentPerformance.mistakes.exampleLabel',
  'analytics.studentPerformance.mistakes.noteLabel',
  'analytics.studentPerformance.mistakes.autoGradedHint',
  'analytics.studentPerformance.trend.improving',
  'analytics.studentPerformance.trend.worsening',
  'analytics.studentPerformance.trend.stable',
  'analytics.studentPerformance.ghosted.banner',
  'analytics.myPerformance.title',
  'analytics.myPerformance.tab.overview',
  'analytics.myPerformance.tab.patterns',
  'analytics.myPerformance.overview.overallBand',
  'analytics.myPerformance.overview.goal',
  'analytics.myPerformance.overview.trendZone',
  'analytics.myPerformance.overview.breakdownZone',
  'analytics.myPerformance.overview.statsZone',
  'analytics.myPerformance.overview.zoneEmpty',
  'analytics.myPerformance.patterns.focusType',
  'analytics.myPerformance.patterns.strengthType',
  'analytics.myPerformance.patterns.empty',
  'analytics.myPerformance.patterns.filterLabel',
  'analytics.myPerformance.patterns.filter.all',
  'analytics.myPerformance.patterns.frequency',
  'analytics.myPerformance.patterns.exampleLabel',
  'analytics.myPerformance.patterns.noteLabel',
  'analytics.myPerformance.patterns.ownDataNote',
  'analytics.myPerformance.patterns.focusTrend',
  'analytics.myPerformance.patterns.improvingTrend',
  'analytics.myPerformance.patterns.stableTrend',
  'analytics.myPerformance.ghosted.banner',
  'analytics.share.button',
  'analytics.share.copy',
  'analytics.share.copied',
  'analytics.share.exportPdf',
  'analytics.share.busy',
  'analytics.share.error',
  'analytics.share.title',
  'analytics.share.line.overallBand',
  'analytics.share.line.skill',
  'analytics.share.line.onTime',
  'analytics.share.line.graded',
  'analytics.share.line.goal',
]
