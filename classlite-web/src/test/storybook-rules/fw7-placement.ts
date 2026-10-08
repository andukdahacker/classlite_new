/**
 * Story 1d-1 AC7 — FW-7 component placement check.
 *
 * Story files must live next to their component in one of the three
 * permitted tiers from project-context `FW-7`:
 *
 *   - `src/components/ui/`           — shadcn primitives (auto-generated).
 *   - `src/components/domain/`       — business-aware reusable components.
 *   - `src/features/<area>/components/` — feature-local components.
 *   - `src/features/<area>/`         — route-page tier (Story 10.3 amendment,
 *     Ducdo 2026-10-08): page components are route targets that live at the
 *     feature root (imported by routes.tsx), so their co-located stories do too.
 *     ONE segment below the area only — deeper misplacement still fails.
 *
 * Anywhere else is a violation. Exception: `src/test/fixtures/lint-bait/`
 * — that directory holds the AC3 negative fixture and is intentionally
 * excluded from `.storybook/main.ts`'s discovery globs, so the
 * test-runner never sees it. The check function below still rejects it
 * if someone moves it into a discovery root by accident.
 *
 * Pure function — exported separately so Vitest can exercise the rule
 * against the negative fixtures without launching Storybook.
 */

export type Fw7PlacementCheck = {
  ok: boolean
  /** Why the path violates FW-7, when `ok` is false. */
  reason: string | null
}

const ALLOWED_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)src\/components\/ui\/.+\.stories\.tsx?$/,
  /(?:^|\/)src\/components\/domain\/.+\.stories\.tsx?$/,
  /(?:^|\/)src\/features\/[^/]+\/components\/.+\.stories\.tsx?$/,
  // Route-page tier — exactly one segment below the feature area (the page
  // component + its story live at `features/<area>/`). A deeper nested story
  // (e.g. `features/<area>/foo/Bar.stories.tsx`) still fails.
  /(?:^|\/)src\/features\/[^/]+\/[^/]+\.stories\.tsx?$/,
]

export function checkFw7Placement(storyFilePath: string): Fw7PlacementCheck {
  // Normalize Windows path separators so the same regex matches on every
  // platform. The check is path-shape only — no fs access.
  const normalized = storyFilePath.replace(/\\/g, '/')
  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(normalized)) return { ok: true, reason: null }
  }
  return {
    ok: false,
    reason: `Story file must live under src/components/ui/, src/components/domain/, or src/features/<area>/components/. Got: ${normalized}`,
  }
}
