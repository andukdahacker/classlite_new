/**
 * sampleAIGrade — hardcoded IELTS Writing Task 2 fixture for Story 2-4
 * FirstAIGradeCard (AC7). The essay excerpt, per-criterion breakdown,
 * feedback quote, and disclaimer are drafted in English + Vietnamese and
 * lifted via i18n keys — this file just pins the numeric shape.
 *
 * When Epic 6 (FU-2-4-F) ships the live "Run AI grading" pipeline, this
 * fixture stays as the marketing/onboarding placeholder; the runtime
 * grade uses the wire endpoint instead.
 */
export interface CriterionScore {
  key: 'taskResponse' | 'coherence' | 'lexical' | 'grammar'
  label: string
  band: number
}

export interface SampleAIGrade {
  overallBand: number
  criteria: CriterionScore[]
}

export const sampleAIGrade: SampleAIGrade = {
  overallBand: 6.5,
  criteria: [
    { key: 'taskResponse', label: 'Task Response', band: 6.5 },
    { key: 'coherence', label: 'Coherence', band: 6.0 },
    { key: 'lexical', label: 'Lexical', band: 7.0 },
    { key: 'grammar', label: 'Grammar', band: 6.5 },
  ],
}
