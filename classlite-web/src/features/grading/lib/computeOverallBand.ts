/**
 * computeOverallBand — Story 6.1 (AC7/AC14). The CLIENT preview of the overall IELTS
 * Writing band. It MIRRORS the server scorer EXACTLY (integer eighth-band space, no
 * float rounding) so the live preview never disagrees with the persisted value — but
 * it is NEVER sent to the server (the server computes + ignores any client value).
 *
 * The rounding is nearest-half with two IELTS special cases (.25 → .5 up,
 * .75 → next whole up): fractions .0/.125 → .0; .25/.375/.5/.625 → .5;
 * .75/.875 → next whole.
 */
export interface CriterionScores {
  taskResponse: number
  coherenceCohesion: number
  lexicalResource: number
  grammaticalRange: number
}

/** The four criterion keys in order — the single source used for iteration + i18n. */
export const CRITERION_KEYS: ReadonlyArray<keyof CriterionScores> = [
  'taskResponse',
  'coherenceCohesion',
  'lexicalResource',
  'grammaticalRange',
]

/** Valid band inputs: 1.0–9.0 on the 0.5 grid. */
export const MIN_BAND = 1.0
export const MAX_BAND = 9.0
export const BAND_STEP = 0.5

/**
 * The server-mirrored overall band. Precondition: each score is a half-band; the
 * eighth-space arithmetic is exact for those inputs.
 */
export function computeOverallBand(scores: CriterionScores): number {
  const sumEighths = CRITERION_KEYS.reduce(
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
 * The raw arithmetic mean (un-rounded) — for the "shows its math" affordance
 * (AC14, e.g. "avg 6.38 → 6.5"). Returns null when a score is missing.
 */
export function overallBandMath(
  scores: Partial<CriterionScores>,
): { avg: number; band: number } | null {
  const values = CRITERION_KEYS.map((key) => scores[key])
  if (values.some((v) => typeof v !== 'number')) return null
  const complete = scores as CriterionScores
  const avg =
    CRITERION_KEYS.reduce((sum, key) => sum + complete[key], 0) / CRITERION_KEYS.length
  return { avg, band: computeOverallBand(complete) }
}

/** Whether v is a valid criterion band (1.0–9.0 on the 0.5 grid). */
export function isValidBand(v: number): boolean {
  return v >= MIN_BAND && v <= MAX_BAND && Number.isInteger(v * 2)
}
