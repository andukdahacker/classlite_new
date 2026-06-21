/**
 * Story 1d-1 AC3 — required exports per component pattern.
 *
 * Pure file-path + export-set check, exported separately from the
 * test-runner so Vitest can exercise it against the negative fixture in
 * `src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx` without
 * spawning the full Storybook pipeline. The test-runner imports this
 * function from its `setup` hook (see `.storybook/test-runner.ts`).
 *
 * Coverage policy:
 *
 *   - Primitives under `src/components/ui/` are exempt — they only
 *     export `Default` plus variants relevant to their own API.
 *   - Any other story file under `src/components/domain/` or
 *     `src/features/<area>/components/` is treated as a data-rendering
 *     component and required to export Default + Loading + Empty + Error
 *     (the three-state set). This catches Roster / Directory / Panel /
 *     other non-suffixed names that an explicit pattern list would miss.
 *   - A file may opt out with `// storybook-rule: no-three-state` (e.g.
 *     a pure-presentational component that legitimately renders no data
 *     branches). The opt-out is greppable and visible in code review.
 */

/**
 * Comment + string stripping is shared with `scripts/i18n-parity.mjs`
 * via `scripts/lib/strip-comments-and-strings.mjs`. The two scanners
 * used to drift independently — each had its own copy of the same
 * function and shared the same JSDoc-apostrophe bug (Story 1d-3
 * party-mode review, Winston 2026-06-21). The shared util is the
 * single source of truth.
 */
import { stripCommentsAndStrings } from '../../../scripts/lib/strip-comments-and-strings.mjs'

export type RequiredExportsCheck = {
  ok: boolean
  /** Required exports that are missing from the story file. */
  missing: string[]
  /** True when the file participates in three-state enforcement. */
  enforced: boolean
}

/** Primitive directory — three-state requirement does not apply. */
export const PRIMITIVE_EXEMPTION = /\/components\/ui\//

const THREE_STATE_REQUIRED = ['Default', 'Loading', 'Empty', 'Error'] as const
const OPT_OUT_DIRECTIVE = 'storybook-rule: no-three-state'

/**
 * Pure-layout shell allowlist — Story 1d-3 (closed 2026-06-18 by Ducdo:
 * Option A — predicate-gated closed set).
 *
 * `*Shell.stories.tsx` files normally require the three-state set
 * (`Default` / `Loading` / `Empty` / `Error`) because the rule was
 * authored anticipating data-rendering shells (`GradingShell`,
 * `EditorShell`). Pure-layout shells — `AppShell`, `SidebarShell`,
 * `TopbarShell` — own no fetches and therefore have no Loading / Empty /
 * Error branches to render. Forcing contrived stub stories on them adds
 * noise without catching anything.
 *
 * Predicate (Winston + Murat, party-mode 2026-06-18):
 *   1. Component owns NO data fetching — no `useQuery` /
 *      `useSuspenseQuery` / `useMutation` / `fetch` / `apiFetch`.
 *   2. Component exposes ONLY slot props + role-variant props + UI-state
 *      props (e.g., `collapsed`). NEVER render-from-fetched-data.
 *   3. Component renders NO conditional branches on user data.
 *   4. Every addition is justified inline in `storybook-conventions.md` §3
 *      citing this predicate.
 *
 * CODEOWNERS rule on this file makes TEA (Murat) a required reviewer; a
 * standalone allowlist-only PR is auto-rejected so additions land in the
 * same PR as the exempt component. Future `*Shell` components that ARE
 * data-rendering (`OnboardingShell`, `GradingQueueShell`, `InboxListShell`,
 * etc.) WILL ship the three-state set — the allowlist is not a dumping
 * ground.
 */
export const PURE_LAYOUT_SHELL_ALLOWLIST: ReadonlySet<string> = new Set([
  'AppShell',
  'SidebarShell',
  'TopbarShell',
])

function isAllowlistedShell(storyFilePath: string): boolean {
  const normalized = normalizePath(storyFilePath)
  const match = normalized.match(/\/([A-Za-z0-9_]+)\.stories\.tsx?$/)
  if (!match) return false
  return PURE_LAYOUT_SHELL_ALLOWLIST.has(match[1])
}

/** Normalize path separators so callers don't need to. */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/**
 * Run the required-exports check for one story file.
 *
 * @param storyFilePath  Repo-relative or absolute path to the .stories.tsx file.
 * @param exportedNames  All top-level named exports in the file.
 * @param source         Optional raw source of the file — when supplied,
 *                       the `// storybook-rule: no-three-state` opt-out
 *                       directive is honored.
 */
export function checkRequiredExports(
  storyFilePath: string,
  exportedNames: readonly string[],
  source?: string,
): RequiredExportsCheck {
  const normalized = normalizePath(storyFilePath)
  if (PRIMITIVE_EXEMPTION.test(normalized)) {
    return { ok: true, missing: [], enforced: false }
  }
  if (source && source.includes(OPT_OUT_DIRECTIVE)) {
    return { ok: true, missing: [], enforced: false }
  }
  if (isAllowlistedShell(normalized)) {
    // Pure-layout shells (AppShell / SidebarShell / TopbarShell — closed
    // 2026-06-18 by Ducdo) are exempt from the three-state requirement.
    // See `PURE_LAYOUT_SHELL_ALLOWLIST` above + storybook-conventions.md § 3.
    return { ok: true, missing: [], enforced: false }
  }
  const missing = THREE_STATE_REQUIRED.filter((name) => !exportedNames.includes(name))
  return { ok: missing.length === 0, missing, enforced: true }
}

/**
 * Extract top-level export names from raw TypeScript source. Covers:
 *
 *   - `export const Default = {}`
 *   - `export function Loading() {}` (and `export async function`)
 *   - `export let / export var` (used by some code generators)
 *   - `export { Empty, Error as ErrorStory }` (named re-exports)
 *
 * Block and line comments are stripped first so
 * a JSDoc example block like `* export const Empty = ...` does not yield
 * a false positive. String and template literals are stripped for the
 * same reason. `export type` / `export interface` / `export default` are
 * deliberately ignored — they are not stories.
 */
export function extractExportedNames(source: string): string[] {
  const stripped = stripCommentsAndStrings(source)
  const names = new Set<string>()

  const declarationPattern =
    /^\s*export\s+(?:async\s+)?(?:const|function|let|var)\s+([A-Za-z_$][\w$]*)/gm
  let match: RegExpExecArray | null
  while ((match = declarationPattern.exec(stripped)) !== null) {
    names.add(match[1])
  }

  const namedReexportPattern = /^\s*export\s*\{([^}]*)\}/gm
  while ((match = namedReexportPattern.exec(stripped)) !== null) {
    for (const segment of match[1].split(',')) {
      const trimmed = segment.trim()
      if (!trimmed) continue
      // `Foo` or `Foo as Bar` — the externally-visible name is the part
      // after `as` (or the whole token).
      const asMatch = trimmed.match(/^\S+\s+as\s+([A-Za-z_$][\w$]*)/)
      if (asMatch) {
        names.add(asMatch[1])
        continue
      }
      const bareMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/)
      if (bareMatch) names.add(bareMatch[1])
    }
  }

  return [...names]
}

