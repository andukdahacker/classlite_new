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
]

// Route-page tier shape — exactly one segment below the feature area (the page
// component + its story live at `features/<area>/<Name>.stories.tsx`). A deeper
// nested story (`features/<area>/foo/Bar.stories.tsx`) does not match and falls
// through to the catch-all rejection.
const ROUTE_PAGE_SHAPE =
  /(?:^|\/)src\/features\/([^/]+)\/([^/]+)\.stories\.tsx?$/

// The bare route-page SHAPE cannot distinguish a real route page (a target
// imported by routes.tsx, legitimately at the feature root) from a feature
// component whose story was misfiled above its `/components/` tier. So the
// route-page tier is gated on an EXPLICIT allowlist (Story 10.3 amendment, Ducdo
// 2026-10-08; narrowed in code review 2026-10-08 — the first draft allowed the
// shape unconditionally, which silently let any feature-root story through). A
// NEW feature-root story must be registered here (if it is a page) or moved into
// `/components/` (if it is not) — that decision is the FW-7 teeth. Keyed
// `<area>/<Name>` (no extension).
const ROUTE_PAGE_STORIES: ReadonlySet<string> = new Set([
  'auth/LoginPage',
  'auth/InviteAcceptancePage',
  'auth/ResetPasswordPage',
  'auth/ForgotPasswordPage',
  'auth/VerifyEmailPage',
  'dashboard/SampleDashboardPreview',
  'dashboard/FirstAIGradeCard',
  'dashboard/TeacherDashboard',
  'dashboard/YourClassesRow',
  'dashboard/FinishSetupCard',
  'onboarding/PersonaSelectPage',
  'onboarding/OnboardingDonePage',
  'onboarding/CenterSetupPage',
])

export function checkFw7Placement(storyFilePath: string): Fw7PlacementCheck {
  // Normalize Windows path separators so the same regex matches on every
  // platform. The check is path-shape only — no fs access.
  const normalized = storyFilePath.replace(/\\/g, '/')
  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(normalized)) return { ok: true, reason: null }
  }
  const routePage = ROUTE_PAGE_SHAPE.exec(normalized)
  if (routePage) {
    const key = `${routePage[1]}/${routePage[2]}`
    if (ROUTE_PAGE_STORIES.has(key)) return { ok: true, reason: null }
    return {
      ok: false,
      reason: `Feature-root story is not a registered route-page story: ${normalized}. If it is a route page, add "${key}" to ROUTE_PAGE_STORIES in fw7-placement.ts; otherwise move it under src/features/${routePage[1]}/components/.`,
    }
  }
  return {
    ok: false,
    reason: `Story file must live under src/components/ui/, src/components/domain/, src/features/<area>/components/, or a registered feature-root route-page tier. Got: ${normalized}`,
  }
}
