/**
 * FW-7 placement check tests — Story 1d-1 AC7.
 *
 * Validates the rule rejects every legitimate violation and accepts each
 * of the three permitted tiers. The negative fixture is also asserted —
 * mirrors the AC3 teeth pattern so the rule cannot be silently weakened.
 */
import { describe, expect, test } from 'vitest'
import { checkFw7Placement } from './fw7-placement'

describe('checkFw7Placement — permitted tiers', () => {
  test.each([
    'src/components/ui/Button.stories.tsx',
    'src/components/domain/SidebarShell.stories.tsx',
    'src/features/grading/components/GradingCard.stories.tsx',
    'src/features/students/components/StudentTable.stories.tsx',
    // Repo-relative or absolute paths both work because the check
    // anchors on the `src/...` segment rather than the full prefix.
    '/abs/path/classlite-web/src/components/ui/Input.stories.tsx',
  ])('%s is allowed', (path) => {
    expect(checkFw7Placement(path)).toEqual({ ok: true, reason: null })
  })

  test('Windows-style separators are normalized', () => {
    const result = checkFw7Placement(
      'src\\components\\domain\\SidebarShell.stories.tsx',
    )
    expect(result.ok).toBe(true)
  })
})

describe('checkFw7Placement — forbidden placements', () => {
  test.each([
    'src/stories/Button.stories.tsx', // storybook init default — explicitly out
    'src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx', // negative fixture lives outside the discovery roots
    'src/utils/Helper.stories.tsx',
    'src/components/Button.stories.tsx', // skipped a tier level
    'src/features/grading/GradingCard.stories.tsx', // missing /components/ segment
    'src/features/grading/widgets/Foo.stories.tsx', // wrong subdir under feature
  ])('%s is rejected', (path) => {
    const result = checkFw7Placement(path)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(path)
  })
})
