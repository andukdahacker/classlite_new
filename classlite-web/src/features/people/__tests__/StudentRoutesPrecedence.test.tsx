// Story 7-2b, Task 1 (AC3) — route-precedence guard.
//
// `/students/import` (Story 2.7 bulk import) MUST keep resolving to the import
// page even though this story adds `/students/:id` (the shared detail). React
// Router v7 ranks the static `import` segment above the `:id` param, so the
// detail never swallows "import". This asserts that ranking against the REAL
// router config (not a hand-built mimic) so a future reorder can't regress it.
import { matchRoutes } from 'react-router'
import { describe, expect, test } from 'vitest'
import { router } from '@/routes'

/** The `path` of every route in the matched branch (index routes contribute undefined). */
function matchedPaths(pathname: string): Array<string | undefined> {
  const matches = matchRoutes(router.routes, pathname)
  return (matches ?? []).map((match) => match.route.path)
}

describe('Student route precedence (AC3)', () => {
  test('P0 /students/import resolves to the import route, NOT the :id detail', () => {
    const paths = matchedPaths('/students/import')
    expect(paths).toContain('/students/import')
    expect(paths).not.toContain(':id')
  })

  test('P0 /students/{id} resolves to the shared detail (:id) under /students', () => {
    const paths = matchedPaths('/students/stu-123')
    expect(paths).toContain('/students')
    expect(paths).toContain(':id')
  })

  test('P1 /people/students/{id} resolves to the :id detail under /people/students', () => {
    const paths = matchedPaths('/people/students/stu-123')
    expect(paths).toContain('/people/students')
    expect(paths).toContain(':id')
  })

  test('P1 /students resolves to the teacher roster index (no :id)', () => {
    const paths = matchedPaths('/students')
    expect(paths).toContain('/students')
    expect(paths).not.toContain(':id')
  })
})
