/**
 * Storybook test-runner config — Story 1d-1 AC3 + AC7.
 *
 * The `setup` hook runs once in Node before Playwright launches. We use
 * it to scan every `*.stories.tsx` file under the discovery roots and
 * assert two rules:
 *
 *   1. AC3 — required exports per file (three-state Default + Loading +
 *      Empty + Error for every story outside `src/components/ui/`,
 *      unless the file opts out via `// storybook-rule: no-three-state`).
 *   2. AC7 — FW-7 component-placement (story files MUST live under
 *      `src/components/ui/`, `src/components/domain/`, or
 *      `src/features/<area>/components/`).
 *
 * Both rules are error-on-merge: any failure throws an Error in setup,
 * which fails the test-runner run before any browser test executes.
 * The setup ALSO throws when zero files are discovered — a silent
 * "validated nothing" pass would let a future refactor strip
 * enforcement without anyone noticing.
 *
 * The pure check functions live under `src/test/storybook-rules/` so
 * Vitest can exercise them in isolation against the canonical negative
 * fixture (`src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx`).
 * If a future dev disables either rule by reducing its required set,
 * the unit tests in that directory will fail loudly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestRunnerConfig } from '@storybook/test-runner'

import {
  checkRequiredExports,
  extractExportedNames,
} from '../src/test/storybook-rules/required-exports.ts'
import { checkFw7Placement } from '../src/test/storybook-rules/fw7-placement.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '..')
const storyRoots = ['src/components', 'src/features']

function walkForStoryFiles(dir: string): string[] {
  const absoluteDir = join(repoRoot, dir)
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true, recursive: true })
  } catch (err: unknown) {
    // ENOENT for a missing root is OK on a fresh checkout (e.g. before
    // `src/features/` ships). Any other error means the walk would silently
    // under-report, so re-throw to fail loudly rather than mask coverage.
    const code = (err as { code?: string } | null)?.code
    if (code === 'ENOENT') return []
    throw err
  }
  const matches: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name
    if (!name.endsWith('.stories.tsx') && !name.endsWith('.stories.ts')) continue
    // Node 22+ exposes `parentPath` on Dirent when `recursive: true` is
    // set. CI pins Node 22 and the project requires it for Storybook 10.
    const parent = (entry as unknown as { parentPath: string }).parentPath
    matches.push(relative(repoRoot, join(parent, name)))
  }
  return matches
}

function collectStoryFiles(): string[] {
  return storyRoots.flatMap(walkForStoryFiles)
}

const config: TestRunnerConfig = {
  setup() {
    const storyFiles = collectStoryFiles()

    if (storyFiles.length === 0) {
      throw new Error(
        [
          'Storybook test-runner refused to start: no story files discovered.',
          `Searched roots: ${storyRoots.join(', ')}`,
          'Either no stories exist yet (this is a fresh checkout before any',
          "story has shipped — fine for 1d-1 once Button.stories.tsx is in),",
          'OR the discovery roots have drifted from .storybook/main.ts.',
          'Validate against the conventions doc § 2 and the main.ts story globs.',
        ].join('\n'),
      )
    }

    const failures: string[] = []

    for (const filePath of storyFiles) {
      const placement = checkFw7Placement(filePath)
      if (!placement.ok) {
        failures.push(
          `  [AC7 placement] ${filePath} — ${placement.reason ?? 'misplaced'}`,
        )
      }
      const source = readFileSync(join(repoRoot, filePath), 'utf8')
      const exported = extractExportedNames(source)
      const result = checkRequiredExports(filePath, exported, source)
      if (!result.ok) {
        failures.push(
          `  [AC3 three-state] ${filePath} — missing exports: ${result.missing.join(', ')}`,
        )
      }
    }

    if (failures.length > 0) {
      const message = [
        `Storybook test-runner refused to start: ${failures.length} story file rule violation(s).`,
        '',
        ...failures,
        '',
        'See classlite-web/docs/storybook-conventions.md § 3 (required exports) and § 2 (placement).',
      ].join('\n')
      throw new Error(message)
    }
  },
}

export default config
