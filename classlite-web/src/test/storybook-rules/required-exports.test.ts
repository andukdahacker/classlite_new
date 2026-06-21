/**
 * Required-exports rule tests — Story 1d-1 AC3.
 *
 * Proves `checkRequiredExports()` actually fails on the canonical
 * negative fixture. Without this assertion, the rule has no teeth: a
 * silent regression could leave the postRender hook running against a
 * file that always passes (e.g. someone removes the pattern entries
 * thinking they're unused).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  checkRequiredExports,
  extractExportedNames,
  PRIMITIVE_EXEMPTION,
  PURE_LAYOUT_SHELL_ALLOWLIST,
} from './required-exports'

const NEGATIVE_FIXTURE = resolve(
  __dirname,
  '..',
  'fixtures',
  'lint-bait',
  'MissingEmptyTable.stories.tsx',
)

describe('checkRequiredExports — domain coverage', () => {
  test('full three-state set passes', () => {
    const result = checkRequiredExports(
      'src/components/domain/UserTable.stories.tsx',
      ['Default', 'Loading', 'Empty', 'Error'],
    )
    expect(result).toEqual({ ok: true, missing: [], enforced: true })
  })

  test('missing Empty fails with a precise diff', () => {
    const result = checkRequiredExports(
      'src/components/domain/UserTable.stories.tsx',
      ['Default', 'Loading', 'Error'],
    )
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Empty'])
    expect(result.enforced).toBe(true)
  })

  test.each([
    'src/components/domain/UserDirectory.stories.tsx',
    'src/components/domain/GradingPanel.stories.tsx',
    'src/components/domain/ClassRoster.stories.tsx',
    'src/components/domain/BandScoreChart.stories.tsx',
    'src/features/grading/components/SubmissionFeed.stories.tsx',
  ])('%s (non-suffix domain component) is enforced', (path) => {
    const result = checkRequiredExports(path, ['Default'])
    expect(result.enforced).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Loading', 'Empty', 'Error'])
  })
})

describe('checkRequiredExports — primitive exemption', () => {
  test('files under components/ui are exempt regardless of name', () => {
    const result = checkRequiredExports(
      'src/components/ui/Button.stories.tsx',
      ['Default'],
    )
    expect(result).toEqual({ ok: true, missing: [], enforced: false })
    expect(PRIMITIVE_EXEMPTION.test('src/components/ui/Button.stories.tsx')).toBe(true)
  })

  test('Windows backslash separators are normalized', () => {
    const result = checkRequiredExports(
      'src\\components\\ui\\Button.stories.tsx',
      ['Default'],
    )
    expect(result.enforced).toBe(false)
  })
})

describe('checkRequiredExports — opt-out directive', () => {
  test('honors `// storybook-rule: no-three-state` in source', () => {
    const result = checkRequiredExports(
      'src/components/domain/PresentationOnly.stories.tsx',
      ['Default'],
      '// storybook-rule: no-three-state\nexport const Default = {}',
    )
    expect(result).toEqual({ ok: true, missing: [], enforced: false })
  })

  test('still fires without the directive', () => {
    const result = checkRequiredExports(
      'src/components/domain/PresentationOnly.stories.tsx',
      ['Default'],
      'export const Default = {}',
    )
    expect(result.enforced).toBe(true)
    expect(result.ok).toBe(false)
  })
})

describe('extractExportedNames — story-file export parser', () => {
  test('matches `export const Xxx`', () => {
    const names = extractExportedNames(
      `export const Default = {}\nexport const Loading = {}\n`,
    )
    expect(names).toEqual(['Default', 'Loading'])
  })

  test('matches `export async function`', () => {
    expect(extractExportedNames(`export async function Empty() {}\n`)).toEqual(['Empty'])
  })

  test('matches `export { Foo, Bar as Renamed }` named re-exports', () => {
    const names = extractExportedNames(
      `export { Loading, Empty as EmptyStory, Error as ErrorStory }`,
    )
    expect(names).toEqual(['Loading', 'EmptyStory', 'ErrorStory'])
  })

  test('skips non-export declarations', () => {
    const names = extractExportedNames(`const local = 1\nexport const Default = {}\n`)
    expect(names).toEqual(['Default'])
  })

  test('ignores default exports (CSF3 meta block)', () => {
    const source = `
      export default {
        title: 'Foo',
      }
      export const Default = {}
    `
    expect(extractExportedNames(source)).toEqual(['Default'])
  })

  test('ignores export keywords inside block comments', () => {
    const source = `
      /**
       * Example: export const Empty = {} — should NOT be detected.
       */
      export const Default = {}
    `
    expect(extractExportedNames(source)).toEqual(['Default'])
  })

  test('ignores export keywords inside line comments', () => {
    const source = `// export const Empty = {}\nexport const Default = {}`
    expect(extractExportedNames(source)).toEqual(['Default'])
  })

  test('ignores export keywords inside string literals', () => {
    const source = `const example = "export const Empty = {}"\nexport const Default = {}`
    expect(extractExportedNames(source)).toEqual(['Default'])
  })

  test('deduplicates names when both a declaration and re-export appear', () => {
    const source = `export const Default = {}\nexport { Default }`
    expect(extractExportedNames(source)).toEqual(['Default'])
  })
})

describe('Pure-layout shell allowlist (Story 1d-3 — closed 2026-06-18)', () => {
  test.each(['AppShell', 'SidebarShell', 'TopbarShell'])(
    '%s.stories.tsx is exempt from the three-state requirement',
    (componentName) => {
      const result = checkRequiredExports(
        `src/components/domain/${componentName}.stories.tsx`,
        ['Default'],
      )
      expect(result).toEqual({ ok: true, missing: [], enforced: false })
    },
  )

  test('the closed set is the exact triple {AppShell, SidebarShell, TopbarShell}', () => {
    expect([...PURE_LAYOUT_SHELL_ALLOWLIST].sort()).toEqual([
      'AppShell',
      'SidebarShell',
      'TopbarShell',
    ])
  })

  test('a non-allowlisted *Shell file is still enforced', () => {
    const result = checkRequiredExports(
      'src/components/domain/OnboardingShell.stories.tsx',
      ['Default'],
    )
    expect(result.enforced).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Loading', 'Empty', 'Error'])
  })
})

describe('Negative fixture — proof the rule has teeth', () => {
  test('MissingEmptyTable.stories.tsx FAILS the three-state check', () => {
    const source = readFileSync(NEGATIVE_FIXTURE, 'utf8')
    const exported = extractExportedNames(source)
    const result = checkRequiredExports(NEGATIVE_FIXTURE, exported, source)

    // Sanity: the fixture's own exports must shape the way the doc claims.
    expect(exported).toEqual(['Default', 'Loading'])

    // The actual teeth assertion.
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Empty', 'Error'])
    expect(result.enforced).toBe(true)
  })
})
