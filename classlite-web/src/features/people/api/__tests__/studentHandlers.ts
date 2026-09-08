// ATDD RED-PHASE fixtures + MSW handlers for Story 7-2b — the student surface.
//
// This file is VALID TypeScript on its own and imports the ALREADY-SHIPPED
// generated 7-2a wire types (`components['schemas'][…]` from '@/lib/api/client').
// Typing the fixtures against the generated shapes is deliberate: it is the
// D13 contract co-finalization guard — if any 7-2a student READ shape drifts
// under a codegen re-run (the PROVISIONAL markers get stripped in Task 9), these
// fixtures stop compiling, surfacing the drift before the UI silently mis-renders.
// The RED signal for the *.test.tsx consumers is the missing page/component
// modules (StudentsTeacherPage / StudentsCenterPage / StudentDetailPage /
// StudentNotesPanel), NOT this file.
//
// Convention: [[reference_atdd_red_convention]] — FE red-phase = import a
// not-yet-existing module → `tsc -b` + Vitest import failure. No `test.skip()`.
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type StudentListItem = components['schemas']['StudentListItem']
type StudentEnrolledClassLite = components['schemas']['StudentEnrolledClassLite']
type EnvelopeMetaPagination = components['schemas']['EnvelopeMetaPagination']
type StudentDetail = components['schemas']['StudentDetail']
type StudentPerSkill = components['schemas']['StudentPerSkill']
type StudentNote = components['schemas']['StudentNote']

// Deterministic IDs (mirrors the staff handlers' fixed-ID discipline so negative
// assertions can name a specific absent row).
export const DEFAULT_CENTER_ID = 'c-1'
export const STUDENT_GOOD_ID = 'stu-good'
export const STUDENT_NORMAL_ID = 'stu-normal'
export const STUDENT_AT_RISK_ID = 'stu-at-risk'
export const STUDENT_NEW_ID = 'stu-new'
export const STUDENT_UNASSIGNED_ID = 'stu-unassigned'
export const STUDENT_ARCHIVED_ID = 'stu-archived'
/** A student a TEACHER caller must NOT see (out of their class scope). */
export const STUDENT_OUT_OF_SCOPE_ID = 'stu-other-teacher'
export const NOTE_PLAIN_ID = 'note-plain'
export const NOTE_FLAGGED_ID = 'note-flagged'
export const NOTE_BY_OTHER_AUTHOR_ID = 'note-other-author'

/** The list envelope carries meta.pagination; detail/note envelopes carry only { data }. */
function listEnvelope(
  data: StudentListItem[],
  paginationOverrides: Partial<EnvelopeMetaPagination['pagination']> = {},
): { data: StudentListItem[]; meta: EnvelopeMetaPagination } {
  return {
    data,
    meta: {
      serverTime: '2026-09-07T00:00:00Z',
      pagination: {
        page: 1,
        pageSize: 100,
        total: data.length,
        totalPages: 1,
        ...paginationOverrides,
      },
    },
  }
}

function envelope<T>(data: T): { data: T } {
  return { data }
}

// --- builders --------------------------------------------------------------
function enrolledClass(
  overrides: Partial<StudentEnrolledClassLite> = {},
): StudentEnrolledClassLite {
  return { classId: 'cls-1', className: 'IELTS Writing 6.5', teacherName: 'Minh N.', ...overrides }
}

export function studentListItem(overrides: Partial<StudentListItem> = {}): StudentListItem {
  return {
    studentId: STUDENT_NORMAL_ID,
    name: 'Normal Student',
    email: 'normal@example.com',
    avatarUrl: null,
    enrolledClasses: [enrolledClass()],
    teachers: ['Minh N.'],
    overallBand: 6.0,
    atRiskStatus: 'normal',
    atRiskReasons: [],
    activeEnrollmentCount: 1,
    archivedAt: null,
    joinedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

export const studentGood = studentListItem({
  studentId: STUDENT_GOOD_ID,
  name: 'Good Student',
  email: 'good@example.com',
  overallBand: 7.0,
  atRiskStatus: 'good',
  teachers: ['Minh N.', 'Lan P.'],
  enrolledClasses: [
    enrolledClass({ classId: 'cls-1', className: 'IELTS Writing 6.5', teacherName: 'Minh N.' }),
    enrolledClass({ classId: 'cls-2', className: 'IELTS Reading R60', teacherName: 'Lan P.' }),
  ],
  activeEnrollmentCount: 2,
})

export const studentNormal = studentListItem()

/** At-risk — PerfPill perf-risk + At-risk tab + reasons surfaced (D12). */
export const studentAtRisk = studentListItem({
  studentId: STUDENT_AT_RISK_ID,
  name: 'AtRisk Student',
  email: 'atrisk@example.com',
  overallBand: 4.5,
  atRiskStatus: 'at_risk',
  atRiskReasons: ['attendance_below_floor', 'consecutive_missed'],
})

/** New — joinedAt within NEW_STUDENT_WINDOW_DAYS of the injected clock (D5). */
export const studentNew = studentListItem({
  studentId: STUDENT_NEW_ID,
  name: 'New Student',
  email: 'new@example.com',
  joinedAt: '2026-09-05T00:00:00Z',
  atRiskStatus: 'normal',
})

/** Unassigned — activeEnrollmentCount===0 → amber row treatment (s42 only, D12). */
export const studentUnassigned = studentListItem({
  studentId: STUDENT_UNASSIGNED_ID,
  name: 'Unassigned Student',
  email: 'unassigned@example.com',
  enrolledClasses: [],
  teachers: [],
  overallBand: null,
  atRiskStatus: 'normal',
  activeEnrollmentCount: 0,
})

/** Archived — archivedAt non-null → Archived tab (s42 only, D5). */
export const studentArchived = studentListItem({
  studentId: STUDENT_ARCHIVED_ID,
  name: 'Archived Student',
  email: 'archived@example.com',
  archivedAt: '2026-07-01T00:00:00Z',
  atRiskStatus: 'normal',
})

/** Full center roster (s42): good + normal + at-risk + new + unassigned + archived. */
export const rosterCenter: StudentListItem[] = [
  studentGood,
  studentNormal,
  studentAtRisk,
  studentNew,
  studentUnassigned,
  studentArchived,
]

/**
 * Teacher-scoped roster (s10a): ONLY the caller-teacher's own-class students.
 * The out-of-scope student is deliberately EXCLUDED here — a component test
 * proves the teacher variant renders exactly the server-scoped set; the true
 * enforcement is server-side (7-2a D3, teacher = classes.teacher_id = caller).
 */
export const rosterTeacher: StudentListItem[] = [studentGood, studentNormal, studentAtRisk, studentNew]

// --- StudentDetail builders ------------------------------------------------
function perSkill(overrides: Partial<StudentPerSkill> = {}): StudentPerSkill {
  return { reading: 6.0, listening: 6.5, writing: 5.5, speaking: null, ...overrides }
}

export function studentNote(overrides: Partial<StudentNote> = {}): StudentNote {
  return {
    noteId: NOTE_PLAIN_ID,
    authorId: 'user-viewer', // matches the seeded session user id so the author-gated delete shows
    authorName: 'Viewer',
    content: 'Steady progress on Task 2 essays.',
    flagged: false,
    createdAt: '2026-09-01T02:00:00Z',
    ...overrides,
  }
}

export const notePlain = studentNote()
export const noteFlagged = studentNote({
  noteId: NOTE_FLAGGED_ID,
  content: 'Missed two consecutive submissions — follow up.',
  flagged: true,
  createdAt: '2026-09-03T02:00:00Z',
})
/** Authored by someone else — a non-owner teacher must NOT see a delete control (D11). */
export const noteByOtherAuthor = studentNote({
  noteId: NOTE_BY_OTHER_AUTHOR_ID,
  authorId: 'user-other', // ≠ the seeded session user id → a non-owner teacher gets NO delete control
  authorName: 'Another Teacher',
  content: 'Spoke with the student about attendance.',
  flagged: false,
  createdAt: '2026-09-02T02:00:00Z',
})

export function studentDetail(overrides: Partial<StudentDetail> = {}): StudentDetail {
  return {
    profile: {
      studentId: STUDENT_NORMAL_ID,
      name: 'Normal Student',
      email: 'normal@example.com',
      avatarUrl: null,
      languagePref: 'vi',
      joinedAt: '2026-08-01T00:00:00Z',
    },
    enrolledClasses: [
      { classId: 'cls-1', className: 'IELTS Writing 6.5', teacherName: 'Minh N.', targetBand: 6.5 },
    ],
    performanceSummary: {
      overallBand: 6.0,
      perSkill: perSkill(),
      attendanceRate: 0.88,
      pendingCount: 1,
      missingCount: 2,
      onTimeRate: 0.8,
      currentVsFirstDelta: 0.3,
    },
    atRisk: { status: 'normal', reasons: [] },
    notes: [notePlain, noteByOtherAuthor, noteFlagged],
    ...overrides,
  }
}

export const detailNormal = studentDetail()

/** At-risk detail with a null skill (speaking) + null currentVsFirstDelta (< 2 released → omit delta, D10). */
export const detailAtRisk = studentDetail({
  profile: {
    studentId: STUDENT_AT_RISK_ID,
    name: 'AtRisk Student',
    email: 'atrisk@example.com',
    avatarUrl: null,
    languagePref: 'vi',
    joinedAt: '2026-08-01T00:00:00Z',
  },
  performanceSummary: {
    overallBand: 4.5,
    perSkill: perSkill({ speaking: null, writing: null }),
    attendanceRate: null, // total_marked=0 → "—" never "0%"
    pendingCount: 0,
    missingCount: 3,
    onTimeRate: null,
    currentVsFirstDelta: null, // < 2 released → the "vs first month" delta is OMITTED (D10)
  },
  atRisk: { status: 'at_risk', reasons: ['attendance_below_floor', 'band_drop'] },
  notes: [],
})

// ============================ HANDLERS =====================================

// --- GET /api/students (roster, paginated → apiFetchWithMeta) --------------
export function centerRosterHandlers(
  data: StudentListItem[] = rosterCenter,
  paginationOverrides: Partial<EnvelopeMetaPagination['pagination']> = {},
) {
  return [http.get('/api/students', () => HttpResponse.json(listEnvelope(data, paginationOverrides)))]
}

export function teacherRosterHandlers(data: StudentListItem[] = rosterTeacher) {
  return [http.get('/api/students', () => HttpResponse.json(listEnvelope(data)))]
}

export const rosterEmptyHandlers = [
  http.get('/api/students', () => HttpResponse.json(listEnvelope([]))),
]

/** total=250 with pageSize=100 → the >100 pager + "counts reflect loaded page" note (AC10/D6). */
export const rosterOverflowHandlers = [
  http.get('/api/students', () =>
    HttpResponse.json(listEnvelope(rosterCenter, { total: 250, totalPages: 3, pageSize: 100 })),
  ),
]

export const roster500Handlers = [
  http.get('/api/students', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-stu-500', details: null } },
      { status: 500 },
    ),
  ),
]

// --- GET /api/students/{id} (detail) ---------------------------------------
export function detailHandlers(detail: StudentDetail = detailNormal) {
  return [http.get('/api/students/:id', () => HttpResponse.json(envelope(detail)))]
}

/** 404 STUDENT_NOT_FOUND — absent / cross-tenant / teacher out-of-scope non-disclosure (AC3/AC11). */
export const detail404Handlers = [
  http.get('/api/students/:id', () =>
    HttpResponse.json(
      { error: { code: 'STUDENT_NOT_FOUND', message: 'not found', requestId: 'req-detail-404', details: null } },
      { status: 404 },
    ),
  ),
]

export const detail500Handlers = [
  http.get('/api/students/:id', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-detail-500', details: null } },
      { status: 500 },
    ),
  ),
]

// --- Notes: GET / POST / PATCH / DELETE ------------------------------------
export function notesListHandlers(notes: StudentNote[] = [notePlain, noteByOtherAuthor, noteFlagged]) {
  return [http.get('/api/students/:id/notes', () => HttpResponse.json(envelope(notes)))]
}

export const notesEmptyHandlers = [
  http.get('/api/students/:id/notes', () => HttpResponse.json(envelope([] as StudentNote[]))),
]

export const notes500Handlers = [
  http.get('/api/students/:id/notes', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-notes-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** POST → 201 EnvelopeStudentNote. Echoes a new note built from the request body. */
export function createNoteHandlers(result: StudentNote = studentNote({ noteId: 'note-created', content: 'brand new note' })) {
  return [
    http.post('/api/students/:id/notes', () => HttpResponse.json(envelope(result), { status: 201 })),
  ]
}

/** 422 VALIDATION_ERROR — empty/whitespace content (server guard mirror). */
export const createNote422Handlers = [
  http.post('/api/students/:id/notes', () =>
    HttpResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'empty content', requestId: 'req-note-422', details: null } },
      { status: 422 },
    ),
  ),
]

/** PATCH → 200 EnvelopeStudentNote (flag toggled). */
export function setNoteFlagHandlers(result: StudentNote = studentNote({ noteId: NOTE_PLAIN_ID, flagged: true })) {
  return [
    http.patch('/api/students/:id/notes/:noteId', () => HttpResponse.json(envelope(result))),
  ]
}

/** DELETE → 204 (author OR owner/admin). */
export const deleteNoteHandlers = [
  http.delete('/api/students/:id/notes/:noteId', () => new HttpResponse(null, { status: 204 })),
]

/** 403 FORBIDDEN — a non-author teacher's delete (control is hidden; mapping is defense-in-depth, D11). */
export const deleteNote403Handlers = [
  http.delete('/api/students/:id/notes/:noteId', () =>
    HttpResponse.json(
      { error: { code: 'FORBIDDEN', message: 'not author', requestId: 'req-note-403', details: null } },
      { status: 403 },
    ),
  ),
]
