/**
 * speakingOverallBand — Story 6.3a (AC4 · D8). The TWINNED client overall-band math for
 * SPEAKING, over SPEAKING_CRITERION_KEYS. It MIRRORS the server scorer
 * (grading.OverallBandFromFour) and the writing twin (computeOverallBand) on the SAME
 * eight-fraction table — the live preview must never disagree with the persisted server
 * value, but it is NEVER sent (the server computes + ignores any client value).
 *
 * D8: the writing math iterates the hardcoded writing CRITERION_KEYS, so this is a twin
 * over the speaking keys — NOT a reuse of the writing key array. isValidBand is
 * per-scalar and is reused from computeOverallBand.
 */

/** The four SPEAKING criterion keys in order — the single source for iteration + i18n. */
export const SPEAKING_CRITERION_KEYS = [
  'fluencyCoherence',
  'lexicalResource',
  'grammaticalRange',
  'pronunciation',
] as const

export type SpeakingCriterionKey = (typeof SPEAKING_CRITERION_KEYS)[number]
export type SpeakingCriterionScores = Record<SpeakingCriterionKey, number>

/**
 * The server-mirrored overall band. Precondition: each score is a half-band; the
 * eighth-space arithmetic is exact for those inputs (no float rounding can flip
 * 6.0↔6.5).
 */
export function computeSpeakingOverallBand(scores: SpeakingCriterionScores): number {
  const sumEighths = SPEAKING_CRITERION_KEYS.reduce(
    (sum, key) => sum + Math.round(scores[key] * 8),
    0,
  )
  const meanEighths = Math.trunc(sumEighths / 4) // exact: sumEighths is a multiple of 4
  const whole = Math.trunc(meanEighths / 8)
  const frac = meanEighths % 8

  let halfAdd: number
  if (frac <= 1) halfAdd = 0
  else if (frac <= 5) halfAdd = 1
  else halfAdd = 2

  return (whole * 2 + halfAdd) / 2
}

/**
 * The raw arithmetic mean (un-rounded) + rounded band — for the "shows its math"
 * affordance (AC4). Returns null when a score is missing.
 */
export function speakingOverallBandMath(
  scores: Partial<SpeakingCriterionScores>,
): { avg: number; band: number } | null {
  const values = SPEAKING_CRITERION_KEYS.map((key) => scores[key])
  if (values.some((v) => typeof v !== 'number')) return null
  const complete = scores as SpeakingCriterionScores
  const avg =
    SPEAKING_CRITERION_KEYS.reduce((sum, key) => sum + complete[key], 0) /
    SPEAKING_CRITERION_KEYS.length
  return { avg, band: computeSpeakingOverallBand(complete) }
}
