/**
 * heatmapScale — the DISTANCE-from-target colour model for `SkillWeekHeatmap`
 * (Story 8-2b, D2 / D11 / AC13 / AC22a). The falsifiable core of the heatmap:
 * a pure function that maps a cell's `(avgBand, targetBand)` to an intensity
 * BUCKET, so the ramp direction is testable via ordering (never a literal hex).
 *
 * Ramp semantics (D2, direction FLIPPED at party-mode 2026-09-21 per Sally):
 *   - pale / low bucket   = AT or NEAR the class target
 *   - saturated / high    = FAR from target (draws the eye to where to act)
 * This deliberately inverts "darker = closer": saturated ≡ attention ≡
 * act-here is 15 years of dashboard muscle memory; distance-encoding restores
 * the intuitive read.
 *
 * A `null` avgBand is a DISTINCT kind (`'empty'`) — never a coloured 0 — so the
 * component can render it as a hatch/blank with a "no grade" label (WCAG 1.4.1).
 * When the class has no `targetBand` (D11) the ramp falls back to a neutral
 * ABSOLUTE-band scale (low band → low bucket) so the grid is never meaningless.
 */

/** 0 = pale (at target / low band), 4 = saturated (far from target / high band). */
export type HeatmapBucket = 0 | 1 | 2 | 3 | 4

export type HeatmapCellStyle =
  | { kind: 'graded'; bucket: HeatmapBucket }
  | { kind: 'empty' }

/** Distance thresholds (band points from target) → bucket. Symmetric by |·|. */
function distanceBucket(distance: number): HeatmapBucket {
  if (distance < 0.5) return 0
  if (distance < 1.5) return 1
  if (distance < 2.5) return 2
  if (distance < 3.5) return 3
  return 4
}

/** Absolute-band thresholds (D11 target-agnostic fallback) → bucket, low→high. */
function absoluteBucket(band: number): HeatmapBucket {
  if (band < 3) return 0
  if (band < 4.5) return 1
  if (band < 6) return 2
  if (band < 7.5) return 3
  return 4
}

/**
 * Maps a heatmap cell to its render style.
 *
 * @param avgBand - the cell's avg band, or `null` for an empty/no-grade cell
 * @param targetBand - the class target band, or `null` (D11 neutral fallback)
 * @returns `{ kind: 'empty' }` for a null band, else `{ kind: 'graded', bucket }`
 */
export function heatmapCellStyle(
  avgBand: number | null,
  targetBand: number | null,
): HeatmapCellStyle {
  if (avgBand === null) return { kind: 'empty' }
  if (targetBand === null) {
    return { kind: 'graded', bucket: absoluteBucket(avgBand) }
  }
  return { kind: 'graded', bucket: distanceBucket(Math.abs(avgBand - targetBand)) }
}
