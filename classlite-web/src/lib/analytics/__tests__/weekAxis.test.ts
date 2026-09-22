// ATDD RED-PHASE — Story 8-2b, Task 2 (shared week→x axis fn, D14d).
// AC16/AC22b (P1) — the SHARED pure `week → x` function both charts consume so
// the heatmap columns and the sparkline points align BY CONSTRUCTION (not a
// shared pixel scale). Unit-testing it in isolation is the ideal AC22b assertion:
// a lazy per-chart axis can't fake a shared function.
//
// RED signal: `@/lib/analytics/weekAxis` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • src/lib/analytics/weekAxis.ts:
//       export interface WeekAxis {
//         x(weekStart: string): number   // center x for that week's column/point
//         step: number                    // px between adjacent week centers
//         weeks: readonly string[]
//       }
//       export function createWeekAxis(weeks: readonly string[], innerWidth: number): WeekAxis
//     Contract: x() is monotonic increasing in `weeks` order, deterministic
//     (same args → same x), every x within [0, innerWidth]. BOTH <SkillWeekHeatmap>
//     and <BandTrendChart> build their axis via this fn from `skillHeatmap.weeks`.
import { describe, expect, test } from 'vitest'
import { createWeekAxis } from '@/lib/analytics/weekAxis'
import { WEEKS } from '@/features/analytics/api/__tests__/handlers'

const WIDTH = 320

describe('createWeekAxis — pure shared week→x (P1)', () => {
  test('P1 x is strictly monotonic increasing across weeks in order', () => {
    const axis = createWeekAxis(WEEKS, WIDTH)
    expect(axis.x(WEEKS[0])).toBeLessThan(axis.x(WEEKS[1]))
    expect(axis.x(WEEKS[1])).toBeLessThan(axis.x(WEEKS[2]))
  })

  test('P1 every week x is finite and within [0, innerWidth]', () => {
    const axis = createWeekAxis(WEEKS, WIDTH)
    for (const w of WEEKS) {
      const x = axis.x(w)
      expect(Number.isFinite(x)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(WIDTH)
    }
  })

  test('P1 deterministic — same weekStart maps to the same x, and two axes agree (the shared-fn guarantee)', () => {
    const a = createWeekAxis(WEEKS, WIDTH)
    const b = createWeekAxis(WEEKS, WIDTH)
    for (const w of WEEKS) {
      expect(a.x(w)).toBe(a.x(w)) // idempotent
      expect(a.x(w)).toBe(b.x(w)) // two independent charts consuming it agree
    }
  })
})
