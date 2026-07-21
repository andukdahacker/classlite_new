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

// --- Story 3.3: templates management (s19 index) -----------------------------
// Consumed by TemplatesIndexPage.test.tsx, whose RED signal is the missing
// `@/features/classes/TemplatesIndexPage` module — NOT this file.

export const SEED_TEMPLATE_ID = 'tmpl-seed-1'
export const CENTER_TEMPLATE_ID = 'tmpl-center-1'

/** Lean templates-list wire alias incl. the new `usedCount` (AC2). */
export interface TemplateWire {
  id: string
  name: string
  targetBand: number | null
  primarySkill: string | null
  sessionCount: number
  color: string | null
  scope: 'system' | 'center'
  usedCount: number
}

export function templateWire(overrides: Partial<TemplateWire> = {}): TemplateWire {
  return {
    id: 'tmpl-default',
    name: 'Untitled Template',
    targetBand: 6.5,
    primarySkill: 'writing',
    sessionCount: 12,
    // eslint-disable-next-line no-restricted-syntax -- template.color is an opaque hex wire value
    color: '#f59e0b',
    scope: 'center',
    usedCount: 0,
    ...overrides,
  }
}

/** A read-only system seed (scope:"system") — no edit/delete affordance (AC1). */
export const templateSeed = templateWire({
  id: SEED_TEMPLATE_ID,
  name: 'Writing Bootcamp 6.5',
  scope: 'system',
  usedCount: 3,
})

/** A tenant-owned template (scope:"center") — editable/deletable (AC1). */
export const templateCustom = templateWire({
  id: CENTER_TEMPLATE_ID,
  name: 'My Custom Template',
  scope: 'center',
  usedCount: 1,
})

export const allTemplates: TemplateWire[] = [templateSeed, templateCustom]

export const templatesHandlers = [
  http.get('/api/templates', () => HttpResponse.json(envelope({ templates: allTemplates }))),
]

/** Failed list read — exercises the s19 trilogy error state. */
export function templatesErrorHandlers() {
  return [
    http.get('/api/templates', () =>
      HttpResponse.json(
        {
          error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: 'req-tpl-500', details: null },
        },
        { status: 500 },
      ),
    ),
  ]
}

// --- Story 3.3: detail (s20) + mutations (s21) -------------------------------

export interface TemplateSessionWire {
  id: string
  title: string
  description: string | null
  sessionOrder: number
  duration: number | null
}

export interface TemplateDetailWire extends TemplateWire {
  sessions: TemplateSessionWire[]
}

export function templateDetail(
  overrides: Partial<TemplateDetailWire> = {},
): TemplateDetailWire {
  return {
    ...templateCustom,
    sessions: [
      { id: 's1', title: 'Session One', description: 'Intro', sessionOrder: 0, duration: 60 },
      { id: 's2', title: 'Session Two', description: null, sessionOrder: 1, duration: null },
    ],
    ...overrides,
  }
}

/** GET detail handler for a given fixture (default: the center template). */
export function getTemplateHandlers(detail: TemplateDetailWire = templateDetail()) {
  return [
    http.get(`/api/templates/${detail.id}`, () =>
      HttpResponse.json(envelope(detail)),
    ),
  ]
}

/** GET detail → 404 TEMPLATE_NOT_FOUND (absent / soft-deleted / cross-tenant). */
export function getTemplateNotFoundHandlers(id: string) {
  return [
    http.get(`/api/templates/${id}`, () =>
      HttpResponse.json(
        { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Not found', requestId: 'req-404', details: null } },
        { status: 404 },
      ),
    ),
  ]
}
