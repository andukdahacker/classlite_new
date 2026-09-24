/**
 * buildShareSummaryModel — the SINGLE own-data-only projection behind BOTH share
 * exports (clipboard text + the @media print layout) (Story 8-3b, Task 5, AC14,
 * R-C). By construction it reads ONLY the student's own fields — studentName,
 * targetBand, per-skill overall bands, on-time rate, graded count — and NEVER a
 * cohort/peer field (`classAvgBand`, `affectedStudentCount`). The R-C egress test
 * asserts on THIS model's output, so no export can leak a peer value by
 * construction, even if the wire leaks one (FR-50 defence-in-depth).
 */
import type { StudentPerformance } from '../api/useStudentPerformance'

export interface ShareSummarySkillBand {
  skill: string
  band: number | null
}

export interface ShareSummaryModel {
  studentName: string
  overallBand: number | null
  targetBand: number | null
  perSkillBands: ShareSummarySkillBand[]
  onTimeRate: number | null
  gradedSubmissionCount: number
}

export function buildShareSummaryModel(
  perf: StudentPerformance,
  _locale: string,
): ShareSummaryModel {
  // ONLY the own overall band is read from each skill — classAvgBand is never touched.
  const perSkillBands: ShareSummarySkillBand[] = perf.skillBreakdown.map((s) => ({
    skill: s.skill,
    band: s.overallBand,
  }))
  const bands = perSkillBands
    .map((s) => s.band)
    .filter((b): b is number => b !== null)
  const overallBand = bands.length
    ? bands.reduce((sum, b) => sum + b, 0) / bands.length
    : null
  return {
    studentName: perf.studentName,
    overallBand,
    targetBand: perf.targetBand,
    perSkillBands,
    onTimeRate: perf.submissionStats.submissionRate.rate,
    gradedSubmissionCount: perf.submissionStats.gradedSubmissionCount,
  }
}
