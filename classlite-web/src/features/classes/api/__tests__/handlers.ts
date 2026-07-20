// ATDD RED-PHASE fixtures + MSW handlers for Story 3.1 — /api/classes.
//
// This file is valid TypeScript on its own (it declares a lean inline wire-shape
// alias since the generated `Class` schema does not exist until api.yaml + codegen
// land in Task 3). It is consumed by ClassesPage.test.tsx, whose RED signal is the
// missing `@/features/classes/ClassesPage` module — NOT this file.
import { HttpResponse, http } from 'msw'

export const DEFAULT_CENTER_ID = 'c-1'
export const TEACHER_A_ID = 'user-teacher-a'
export const TEACHER_B_ID = 'user-teacher-b'

const FIXED_SERVER_TIME = '2026-07-19T00:00:00Z'

/** Lean wire alias — mirrors the AC1 Class contract (explicit nulls, GO-5). */
export interface ClassWire {
  id: string
  centerId: string
  templateId: string | null
  name: string
  description: string | null
  targetBand: number | null
  primarySkill: string | null
  sessionCount: number | null
  capacity: number | null
  status: 'upcoming' | 'active' | 'paused' | 'ended'
  teacherId: string | null
  pendingTeacherEmail: string | null
  startDate: string | null
  endDate: string | null
  color: string | null
  dueDatesEnabled: boolean
  createdAt: string
  updatedAt: string
}

function envelope<T>(data: T): { data: T; meta: { serverTime: string } } {
  return { data, meta: { serverTime: FIXED_SERVER_TIME } }
}

export function classWire(overrides: Partial<ClassWire> = {}): ClassWire {
  return {
    id: 'cls-default',
    centerId: DEFAULT_CENTER_ID,
    templateId: null,
    name: 'Untitled Cohort',
    description: null,
    targetBand: 6.5,
    primarySkill: 'writing',
    sessionCount: 12,
    capacity: null,
    status: 'active',
    teacherId: null,
    pendingTeacherEmail: null,
    startDate: '2026-08-01',
    endDate: null,
    color: null,
    dueDatesEnabled: false,
    createdAt: '2026-07-19T00:00:00Z',
    updatedAt: '2026-07-19T00:00:00Z',
    ...overrides,
  }
}

export const classTeacherA = classWire({
  id: 'cls-a',
  name: 'IELTS Foundation A',
  teacherId: TEACHER_A_ID,
  status: 'active',
})

export const classTeacherB = classWire({
  id: 'cls-b',
  name: 'IELTS Advanced B',
  teacherId: TEACHER_B_ID,
  status: 'active',
})

/** Owner/admin scope: server returns ALL center classes. */
export const allClasses: ClassWire[] = [classTeacherA, classTeacherB]

/** Teacher scope: server returns ONLY the caller-teacher's classes (AC5). */
export const teacherAScopedClasses: ClassWire[] = [classTeacherA]

/** Default (owner/admin) list handler. */
export const classesHandlers = [
  http.get('/api/classes', () => HttpResponse.json(envelope(allClasses))),
]

/** Teacher-scoped list handler — models the server's teacher_id=caller branch. */
export const teacherScopedClassesHandlers = [
  http.get('/api/classes', () =>
    HttpResponse.json(envelope(teacherAScopedClasses)),
  ),
]

export const errorHandlers = {
  listClasses500: () =>
    http.get('/api/classes', () =>
      HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-classes-500',
            details: null,
          },
        },
        { status: 500 },
      ),
    ),
}

// ---------------------------------------------------------------------
// Story 3.2 — GET /api/classes/{id} (single-class detail read). The only
// network read the detail shell performs. Fixtures carry full metadata so the
// Overview tab (AC2) can assert every shipped field.
// ---------------------------------------------------------------------

export const CLASS_DETAIL_ID = 'cls-detail-1'
export const FOREIGN_CLASS_ID = 'cls-foreign-1'

/** Rich single-class fixture — every shipped Overview field populated. */
export const classDetailFull: ClassWire = classWire({
  id: CLASS_DETAIL_ID,
  name: 'IELTS Intensive Evening',
  templateId: null,
  description: 'Evening cohort targeting Band 7.0 across all skills.',
  targetBand: 7,
  primarySkill: 'all_skills',
  sessionCount: 24,
  capacity: 18,
  status: 'active',
  teacherId: null,
  pendingTeacherEmail: 'invited-teacher@example.com',
  startDate: '2026-09-01',
  endDate: '2026-12-15',
  color: null,
  dueDatesEnabled: true,
})

/** Happy-path detail handler — returns `cls` for any :id. */
export function classDetailHandlers(cls: ClassWire = classDetailFull) {
  return [
    http.get('/api/classes/:id', () => HttpResponse.json(envelope(cls))),
  ]
}

/**
 * 404 CLASS_NOT_FOUND — models BOTH the absent-class case AND the
 * teacher-targeting-a-foreign-class case (3.1 AC6 teacher-scope 404). The two
 * are indistinguishable on the wire, which is the AC6 non-leak invariant.
 */
export function classDetail404Handlers() {
  return [
    http.get('/api/classes/:id', () =>
      HttpResponse.json(
        {
          error: {
            code: 'CLASS_NOT_FOUND',
            message: 'class not found',
            requestId: 'req-detail-404',
            details: null,
          },
        },
        { status: 404 },
      ),
    ),
  ]
}

/** Non-404 server error — exercises the shell's inline error+retry state. */
export function classDetail500Handlers() {
  return [
    http.get('/api/classes/:id', () =>
      HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-detail-500',
            details: null,
          },
        },
        { status: 500 },
      ),
    ),
  ]
}
