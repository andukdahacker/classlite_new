/**
 * ATDD RED-PHASE — Story 8-2b, Task 9/10 (AC25 / NFR-3 bundle budget).
 *
 * The analytics route ships TWO net-new hand-built SVG/CSS charts and NO chart
 * library (D4). AC25 makes that falsifiable: the analytics route must ship its
 * OWN lazy chunk, and that chunk must NOT have absorbed a heavy charting library
 * "just for the axis math". This build-artifact test mirrors the existing
 * route-bundle-boundaries.spec.ts convention (read dist/assets, positive testid
 * substring + cross-chunk negative), so it runs deterministically against
 * `dist/` with no dev server.
 *
 * RED signal: the `AnalyticsRoute`/`AnalyticsHome` chunk does not exist yet, so
 * the positive existence assertion fails until the route lands + `npm run build`.
 * No `test.skip()` ([[reference_atdd_red_convention]]).
 *
 * ── SEAMS the dev must expose to turn this green ────────────────────────────
 *   • routes.tsx registers /analytics as its OWN deep-imported lazy chunk
 *     (Rolldown emits `AnalyticsRoute-*.js` or `AnalyticsHome-*.js`).
 *   • the analytics home root carries data-testid="analytics-home-shell"
 *     (already the 1d-4 shell testid) so the chunk substring is assertable.
 *   • scripts/check-chunk-size.mjs gains a TARGETS entry with a hard
 *     maxGzippedBytes ceiling for the analytics chunk (the numeric budget gate —
 *     wired in `npm run build:check`, NOT here).
 *   • AC24 desktop-only hint (bidirectional: present below the breakpoint,
 *     ABSENT at/above) is verified separately once the seeded-auth E2E harness
 *     can reach /analytics/class/:id — a viewport spec, not a build-artifact one.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = resolve(HERE, '..', 'dist', 'assets')

// The chart libraries the hand-built rule (D4) forbids in the analytics chunk.
const FORBIDDEN_CHART_LIBS = ['recharts', 'victory', 'chart.js', 'chartjs', 'd3-scale', 'visx']

test.describe('Story 8-2b — analytics route bundle boundary (AC25 / NFR-3)', () => {
  test('the analytics route ships its own chunk carrying the home-shell testid', () => {
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const analyticsChunks = files.filter((f: string) =>
      /^(AnalyticsRoute|AnalyticsHome)-[\w-]+\.js$/.test(f),
    )
    expect(
      analyticsChunks.length,
      'expected a dedicated Analytics route chunk under dist/assets/',
    ).toBeGreaterThan(0)
    const contents = analyticsChunks
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    expect(
      contents,
      'analytics chunk missing `analytics-home-shell` testid',
    ).toContain('analytics-home-shell')
  })

  test('the analytics chunk does NOT bundle a charting library (hand-built rule, D4)', () => {
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const analyticsChunks = files.filter((f: string) =>
      /^(AnalyticsRoute|AnalyticsHome)-[\w-]+\.js$/.test(f),
    )
    expect(
      analyticsChunks.length,
      'analytics chunk missing from dist/',
    ).toBeGreaterThan(0)
    const contents = analyticsChunks
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    for (const lib of FORBIDDEN_CHART_LIBS) {
      expect(
        contents,
        `analytics chunk leaked a charting library "${lib}" — charts must be hand-built (D4)`,
      ).not.toContain(lib)
    }
  })
})
