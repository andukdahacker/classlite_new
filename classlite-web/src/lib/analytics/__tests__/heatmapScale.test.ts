// ATDD RED-PHASE — Story 8-2b, Task 5 (heatmap colour model, D2/D11).
// AC13/AC22a (P1) — the DISTANCE-from-target scale FUNCTION. This is the
// falsifiable core of the heatmap: assert ORDERING via the exported fn (never a
// literal hex), proving the ramp is (a) distance-encoded, (b) NOT inverted
// (pale = at/near target, saturated = far — D2, the direction FLIPPED at
// party-mode), and (c) that a null cell is a DISTINCT kind from any graded cell.
//
// RED signal: `@/lib/analytics/heatmapScale` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • src/lib/analytics/heatmapScale.ts:
//       export type HeatmapBucket = 0 | 1 | 2 | 3 | 4   // 0 = pale, 4 = saturated
//       export type HeatmapCellStyle =
//         | { kind: 'graded'; bucket: HeatmapBucket }
//         | { kind: 'empty' }
//       export function heatmapCellStyle(
//         avgBand: number | null, targetBand: number | null,
//       ): HeatmapCellStyle
//     Semantics:
//       • avgBand === null → { kind: 'empty' }  (never a coloured 0; distinct from graded)
//       • targetBand !== null → bucket by DISTANCE |avgBand - targetBand|:
//           at/near target → LOW bucket (pale);  far → HIGH bucket (saturated)
//       • targetBand === null (D11) → neutral ABSOLUTE-band ramp: low band → low
//           bucket, high band → high bucket (target-agnostic, monotonic in band)
import { describe, expect, test } from 'vitest'
import { heatmapCellStyle } from '@/lib/analytics/heatmapScale'

const TARGET = 6.5

describe('heatmapCellStyle — null vs graded (AC22a, P1)', () => {
  test('P1 a null-band cell is kind "empty" — DISTINCT from any graded cell', () => {
    expect(heatmapCellStyle(null, TARGET)).toEqual({ kind: 'empty' })
    expect(heatmapCellStyle(null, null)).toEqual({ kind: 'empty' })
    // A graded cell is a different kind entirely — they can never paint identically.
    expect(heatmapCellStyle(6.0, TARGET).kind).toBe('graded')
  })
})

describe('heatmapCellStyle — DISTANCE-from-target ramp, NOT inverted (D2, AC22a, P1)', () => {
  test('P1 at-target is PALER than far-from-target (proves ramp not inverted)', () => {
    const atTarget = heatmapCellStyle(TARGET, TARGET) // |0.0| → pale
    const farAway = heatmapCellStyle(3.0, TARGET) // |3.5| → saturated
    expect(atTarget.kind).toBe('graded')
    expect(farAway.kind).toBe('graded')
    if (atTarget.kind === 'graded' && farAway.kind === 'graded') {
      expect(atTarget.bucket).toBeLessThan(farAway.bucket)
    }
  })

  test('P1 bucket is monotonic in distance — nearer ≤ farther', () => {
    const near = heatmapCellStyle(6.0, TARGET) // |0.5|
    const mid = heatmapCellStyle(5.0, TARGET) // |1.5|
    const far = heatmapCellStyle(3.0, TARGET) // |3.5|
    if (near.kind === 'graded' && mid.kind === 'graded' && far.kind === 'graded') {
      expect(near.bucket).toBeLessThanOrEqual(mid.bucket)
      expect(mid.bucket).toBeLessThanOrEqual(far.bucket)
      expect(near.bucket).toBeLessThan(far.bucket) // strict end-to-end
    }
  })

  test('P1 distance is symmetric — above and below target by the same gap bucket equally', () => {
    const below = heatmapCellStyle(TARGET - 2, TARGET)
    const above = heatmapCellStyle(TARGET + 2, TARGET)
    if (below.kind === 'graded' && above.kind === 'graded') {
      expect(below.bucket).toBe(above.bucket)
    }
  })
})

describe('heatmapCellStyle — targetBand null neutral absolute ramp (D11, P1)', () => {
  test('P1 with no target, ramp is monotonic in ABSOLUTE band (low→high), not broken/flat', () => {
    const low = heatmapCellStyle(3.0, null)
    const high = heatmapCellStyle(7.0, null)
    expect(low.kind).toBe('graded')
    expect(high.kind).toBe('graded')
    if (low.kind === 'graded' && high.kind === 'graded') {
      expect(low.bucket).not.toBe(high.bucket) // not a flat/meaningless grid
      expect(low.bucket).toBeLessThan(high.bucket) // absolute ramp low→high
    }
  })
})
