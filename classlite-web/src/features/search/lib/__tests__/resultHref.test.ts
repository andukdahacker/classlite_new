// Story 8-4b, Task 3 (AC9, R-4) — the audited deep-link table. One href fn, one
// table test over all 5 types × the student role-branch, with NEGATIVE rows (a
// class item never yields an exercise href, etc.) so a mis-wired branch reddens.
import { describe, expect, test } from 'vitest'
import type { Role } from '@/hooks/useRole'
import { resultHref, seeAllHref } from '@/features/search/lib/resultHref'
import {
  assignmentItem,
  classItem,
  exerciseItem,
  fileItem,
  studentItem,
  ASSIGNMENT_CLASS_ID,
  CLASS_ID,
  EXERCISE_ID,
  FILE_SLUG,
  STUDENT_ID,
  searchResultItem,
} from '@/features/search/api/__tests__/handlers'

describe('resultHref — the 5-type deep-link table (AC9)', () => {
  test('class → /classes/:id', () => {
    expect(resultHref(classItem, 'owner')).toBe(`/classes/${CLASS_ID}`)
  })

  test('exercise → /exercises/:id/edit', () => {
    expect(resultHref(exerciseItem, 'teacher')).toBe(`/exercises/${EXERCISE_ID}/edit`)
  })

  test('assignment → /classes/:classId/assignments (uses classId, NOT id)', () => {
    expect(resultHref(assignmentItem, 'teacher')).toBe(
      `/classes/${ASSIGNMENT_CLASS_ID}/assignments`,
    )
    // Contract: classId is non-null for an assignment — the href must not embed the item id.
    expect(assignmentItem.classId).not.toBeNull()
    expect(resultHref(assignmentItem, 'teacher')).not.toContain(assignmentItem.id)
  })

  test('file → /knowledge-hub/files/:slug (uses slug, NOT id)', () => {
    expect(resultHref(fileItem, 'owner')).toBe(`/knowledge-hub/files/${FILE_SLUG}`)
    expect(fileItem.slug).not.toBeNull()
    expect(resultHref(fileItem, 'owner')).not.toContain(fileItem.id)
  })

  describe('student → role-branched detail route', () => {
    test.each<[Role, string]>([
      ['teacher', `/students/${STUDENT_ID}`],
      ['owner', `/people/students/${STUDENT_ID}`],
      ['admin', `/people/students/${STUDENT_ID}`],
    ])('role=%s → %s', (role, href) => {
      expect(resultHref(studentItem, role)).toBe(href)
    })
  })

  describe('NEGATIVE rows — the wrong href is never produced', () => {
    test('a class item never yields an exercise/edit or assignments href', () => {
      const href = resultHref(classItem, 'owner')
      expect(href).not.toContain('/edit')
      expect(href).not.toContain('/assignments')
      expect(href).not.toContain('/knowledge-hub')
    })

    test('an exercise item never yields the read-only class detail route', () => {
      expect(resultHref(exerciseItem, 'owner')).not.toBe(`/classes/${EXERCISE_ID}`)
    })

    test('a teacher never lands on the owner /people/students route', () => {
      expect(resultHref(studentItem, 'teacher')).not.toContain('/people/')
    })
  })

  describe('defensive fallbacks (contract-guaranteed non-null, but never break the URL)', () => {
    test('assignment with a null classId: staff → /classes, student → /assignments', () => {
      const orphan = searchResultItem({ type: 'assignment', classId: null })
      expect(resultHref(orphan, 'teacher')).toBe('/classes')
      expect(resultHref(orphan, 'student')).toBe('/assignments')
    })

    test('file with a null slug falls back to the hub, not /files/null', () => {
      const orphan = searchResultItem({ type: 'file', slug: null })
      expect(resultHref(orphan, 'owner')).toBe('/knowledge-hub')
    })
  })

  // Code review 2026-09-28 (Ducdo: "pragmatic audience-aware resolver"). A route
  // the caller's role cannot reach is a PermissionDenied, not a deep-link. These
  // rows assert REACHABILITY per role, not just the route string.
  describe('audience-aware routing — every target is reachable by the role that gets it', () => {
    test('student class result is NON-navigable (no student class route exists)', () => {
      // /classes/:id is staff-gated; there is no student class-detail route yet
      // (FU-8-4-STUDENT-ROUTES). null → the caller no-ops the selection.
      expect(resultHref(classItem, 'student')).toBeNull()
    })

    test('staff class result → the staff-gated /classes/:id detail', () => {
      for (const role of ['owner', 'admin', 'teacher'] as const) {
        expect(resultHref(classItem, role)).toBe(`/classes/${CLASS_ID}`)
      }
    })

    test('student assignment → their own /assignments list (NOT the staff per-class tab)', () => {
      const href = resultHref(assignmentItem, 'student')
      expect(href).toBe('/assignments')
      // NEGATIVE: never the staff-gated /classes/:classId/assignments route.
      expect(href).not.toContain('/classes/')
    })

    test('staff assignment → the staff-gated /classes/:classId/assignments tab', () => {
      for (const role of ['owner', 'admin', 'teacher'] as const) {
        expect(resultHref(assignmentItem, role)).toBe(
          `/classes/${ASSIGNMENT_CLASS_ID}/assignments`,
        )
      }
    })
  })
})

describe('seeAllHref — the doorway targets the existing list view (AC10)', () => {
  // Staff-reachable, role-agnostic doorways (both /exercises and /knowledge-hub
  // are gated owner|admin|teacher).
  test.each<['exercises' | 'files', string]>([
    ['exercises', '/exercises'],
    ['files', '/knowledge-hub'],
  ])('%s → %s (role-agnostic, staff-reachable)', (category, href) => {
    expect(seeAllHref(category, 'owner')).toBe(href)
    expect(seeAllHref(category, 'teacher')).toBe(href)
  })

  test.each<[Role, string]>([
    ['teacher', '/students'],
    ['owner', '/people/students'],
    ['admin', '/people/students'],
  ])('students doorway is role-branched: role=%s → %s', (role, href) => {
    expect(seeAllHref('students', role)).toBe(href)
  })

  // Code review 2026-09-28 — audience-aware doorways (a doorway to a role-denied
  // route is a wall, exactly what D12 exists to avoid).
  describe('audience-aware doorways', () => {
    test('assignments: student → /assignments, staff → /classes (no staff assignments list)', () => {
      expect(seeAllHref('assignments', 'student')).toBe('/assignments')
      for (const role of ['owner', 'admin', 'teacher'] as const) {
        expect(seeAllHref('assignments', role)).toBe('/classes')
      }
    })

    test('classes: staff → /classes, student → null (no student classes list)', () => {
      for (const role of ['owner', 'admin', 'teacher'] as const) {
        expect(seeAllHref('classes', role)).toBe('/classes')
      }
      expect(seeAllHref('classes', 'student')).toBeNull()
    })
  })
})
