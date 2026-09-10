// ATDD RED-PHASE fixtures + MSW handlers for Story 7-3b — the s43 enrolment console.
//
// This file is VALID TypeScript on its own and imports the ALREADY-SHIPPED
// generated 7-3a wire types (`components['schemas'][…]` from '@/lib/api/client').
// Typing the fixtures against the generated shapes is a drift guard: if any
// 7-3a enrollment read/write shape drifts under a future codegen re-run, these
// fixtures stop compiling, surfacing the drift before the UI mis-renders. The
// 7-3a contract is STABLE (no PROVISIONAL markers) so this story runs no codegen
// (story D13) — the guard is a standing tripwire, not a co-finalization gate.
//
// The RED signal for the *.test.tsx consumers is the missing page/component
// modules (EnrolmentPage / EnrolmentComposer / NeedsAttentionList /
// EnrolmentHistoryTable), NOT this file.
//
// Convention: [[reference_atdd_red_convention]] — FE red-phase = import a
// not-yet-existing module → `tsc -b` + Vitest import failure. No `test.skip()`.
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'
import { classWire } from '@/features/classes/api/__tests__/handlers'

type Enrollment = components['schemas']['Enrollment']
type EnrollmentActionRequest = components['schemas']['EnrollmentActionRequest']
type EnrollmentHistoryEntry = components['schemas']['EnrollmentHistoryEntry']
type EnvelopeMetaPagination = components['schemas']['EnvelopeMetaPagination']
type PaginationMeta = components['schemas']['PaginationMeta']
type NeedsAttention = components['schemas']['NeedsAttention']
type EnrollmentAttentionStudent = components['schemas']['EnrollmentAttentionStudent']
type EnrollmentOverCapacityClass = components['schemas']['EnrollmentOverCapacityClass']

// Deterministic IDs (mirrors the staff/student handlers' fixed-ID discipline so
// negative assertions can name a specific absent/present row).
export const DEFAULT_CENTER_ID = 'c-1'
export const CLASS_A_ID = 'cls-1' // "IELTS Writing 6.5" — matches studentHandlers enrolledClass
export const CLASS_B_ID = 'cls-2' // "IELTS Reading R60"
export const CLASS_OVER_CAP_ID = 'cls-over'
export const STUDENT_ID = 'stu-normal' // matches studentHandlers STUDENT_NORMAL_ID (1 active class)
export const HISTORY_ADD_ID = 'hist-add'
export const HISTORY_TRANSFER_ID = 'hist-transfer'
export const HISTORY_WITHDRAW_ID = 'hist-withdraw'
export const HISTORY_GENESIS_ID = 'hist-genesis' // performerName === null → renders "System"

const SERVER_TIME = '2026-09-09T00:00:00Z'

// ---------- envelope helpers ----------
function envelope<T>(data: T): { data: T; meta: { serverTime: string } } {
  return { data, meta: { serverTime: SERVER_TIME } }
}

function pagination(overrides: Partial<PaginationMeta> = {}): PaginationMeta {
  return { page: 1, pageSize: 20, total: 0, totalPages: 1, ...overrides }
}

function historyListEnvelope(
  data: EnrollmentHistoryEntry[],
  paginationOverrides: Partial<PaginationMeta> = {},
): { data: EnrollmentHistoryEntry[]; meta: EnvelopeMetaPagination } {
  return {
    data,
    meta: {
      serverTime: SERVER_TIME,
      pagination: pagination({ total: data.length, ...paginationOverrides }),
    },
  }
}

function errorBody(code: string, requestId: string) {
  return { error: { code, message: `${code} (fixture)`, requestId, details: null } }
}

// ---------- Enrollment (POST response) ----------
export function enrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enr-1',
    centerId: DEFAULT_CENTER_ID,
    studentId: STUDENT_ID,
    classId: CLASS_A_ID,
    studentName: 'Normal Student',
    studentEmail: 'normal@example.com',
    enrolledAt: '2026-09-09T01:00:00Z',
    withdrawnAt: null,
    status: 'active',
    ...overrides,
  }
}

// ---------- EnrollmentHistoryEntry builders ----------
export function historyEntry(
  overrides: Partial<EnrollmentHistoryEntry> = {},
): EnrollmentHistoryEntry {
  return {
    id: HISTORY_ADD_ID,
    centerId: DEFAULT_CENTER_ID,
    studentId: STUDENT_ID,
    studentName: 'Normal Student',
    action: 'add',
    fromClassId: null,
    fromClassName: null,
    toClassId: CLASS_A_ID,
    toClassName: 'IELTS Writing 6.5',
    effectiveDate: '2026-09-08',
    note: 'Placed into writing track.',
    performedBy: 'user-owner',
    performerName: 'Center Owner',
    performedAt: '2026-09-08T02:00:00Z',
    ...overrides,
  }
}

export const historyAdd = historyEntry()

export const historyTransfer = historyEntry({
  id: HISTORY_TRANSFER_ID,
  action: 'transfer',
  fromClassId: CLASS_A_ID,
  fromClassName: 'IELTS Writing 6.5',
  toClassId: CLASS_B_ID,
  toClassName: 'IELTS Reading R60',
  effectiveDate: '2026-09-07',
  note: null,
  performedAt: '2026-09-07T02:00:00Z',
})

export const historyWithdraw = historyEntry({
  id: HISTORY_WITHDRAW_ID,
  action: 'withdraw',
  fromClassId: CLASS_B_ID,
  fromClassName: 'IELTS Reading R60',
  toClassId: null,
  toClassName: null,
  effectiveDate: '2026-09-06',
  note: 'Student paused study.',
  performedAt: '2026-09-06T02:00:00Z',
})

/** Genesis backfill row (7-3a AC10): performer NULL → the table renders "System". */
export const historyGenesis = historyEntry({
  id: HISTORY_GENESIS_ID,
  action: 'add',
  effectiveDate: '2026-01-01',
  note: '(system)',
  performedBy: null,
  performerName: null,
  performedAt: '2026-01-01T00:00:00Z',
})

/** Newest-first, mixed actions + a null-performer genesis row. */
export const historyRows: EnrollmentHistoryEntry[] = [
  historyAdd,
  historyTransfer,
  historyWithdraw,
  historyGenesis,
]

// ---------- NeedsAttention builders ----------
export function attentionStudent(
  overrides: Partial<EnrollmentAttentionStudent> = {},
): EnrollmentAttentionStudent {
  return {
    studentId: 'stu-unassigned',
    studentName: 'Unassigned Student',
    studentEmail: 'unassigned@example.com',
    ...overrides,
  }
}

export function overCapacityClass(
  overrides: Partial<EnrollmentOverCapacityClass> = {},
): EnrollmentOverCapacityClass {
  return {
    classId: CLASS_OVER_CAP_ID,
    className: 'IELTS Speaking Intensive',
    capacity: 10,
    activeCount: 12,
    ...overrides,
  }
}

export function needsAttention(
  overrides: {
    unassigned?: EnrollmentAttentionStudent[]
    overCapacity?: EnrollmentOverCapacityClass[]
    unassignedPagination?: Partial<PaginationMeta>
    overCapacityPagination?: Partial<PaginationMeta>
  } = {},
): NeedsAttention {
  const unassigned = overrides.unassigned ?? [attentionStudent()]
  const overCapacity = overrides.overCapacity ?? [overCapacityClass()]
  return {
    unassigned: {
      items: unassigned,
      pagination: pagination({ total: unassigned.length, ...overrides.unassignedPagination }),
    },
    overCapacity: {
      items: overCapacity,
      pagination: pagination({ total: overCapacity.length, ...overrides.overCapacityPagination }),
    },
  }
}

// ---------- Enrolment-canonical classes (GET /api/classes) -----------------
// The compose row's target-class picker sources from `useClasses`. The shared
// `classesHandlers` fixture (Story 3.1) serves cls-a/cls-b, which do NOT match
// the classes the enrolment scenarios reference (cls-1 "IELTS Writing 6.5",
// cls-2 "IELTS Reading R60" — the same ids/names on studentHandlers'
// `enrolledClasses`, so source-class resolution and the self-transfer guard line
// up). These handlers give the composer's `useClasses` a fixture that actually
// contains those classes so the target picker can offer them.
export const enrolmentClassWriting = classWire({
  id: CLASS_A_ID,
  name: 'IELTS Writing 6.5',
  status: 'active',
})
export const enrolmentClassReading = classWire({
  id: CLASS_B_ID,
  name: 'IELTS Reading R60',
  status: 'active',
})
export const enrolmentClasses = [enrolmentClassWriting, enrolmentClassReading]

export const enrolmentClassesHandlers = [
  http.get('/api/classes', () =>
    HttpResponse.json({ data: enrolmentClasses, meta: { serverTime: SERVER_TIME } }),
  ),
]

// ============================ HANDLERS =====================================

// --- POST /api/enrollments (action endpoint) -------------------------------
/** 201 add. Optionally capture the request body to assert the wire shape (AC6). */
export function actionAddHandlers(
  onBody?: (body: EnrollmentActionRequest) => void,
  result: Enrollment = enrollment(),
) {
  return [
    http.post('/api/enrollments', async ({ request }) => {
      if (onBody) onBody((await request.json()) as EnrollmentActionRequest)
      return HttpResponse.json(envelope(result), { status: 201 })
    }),
  ]
}

/** 200 transfer/withdraw. */
export function actionOkHandlers(
  onBody?: (body: EnrollmentActionRequest) => void,
  result: Enrollment = enrollment({ status: 'transferred' }),
) {
  return [
    http.post('/api/enrollments', async ({ request }) => {
      if (onBody) onBody((await request.json()) as EnrollmentActionRequest)
      return HttpResponse.json(envelope(result))
    }),
  ]
}

/** Error-code handlers — one per 7-3a error the composer must map to i18n copy (AC7). */
export const actionClassNotEnrollable422 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('CLASS_NOT_ENROLLABLE', 'req-enr-422a'), { status: 422 }),
  ),
]
export const actionNotEnrolledInSource422 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('NOT_ENROLLED_IN_SOURCE', 'req-enr-422b'), { status: 422 }),
  ),
]
export const actionNotAStudentMember422 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('NOT_A_STUDENT_MEMBER', 'req-enr-422c'), { status: 422 }),
  ),
]
export const actionValidationError422 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('VALIDATION_ERROR', 'req-enr-422d'), { status: 422 }),
  ),
]
export const actionAlreadyEnrolled409 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('ALREADY_ENROLLED', 'req-enr-409'), { status: 409 }),
  ),
]
export const actionClassNotFound404 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('CLASS_NOT_FOUND', 'req-enr-404'), { status: 404 }),
  ),
]
export const actionInsufficientRole403 = [
  http.post('/api/enrollments', () =>
    HttpResponse.json(errorBody('INSUFFICIENT_ROLE', 'req-enr-403'), { status: 403 }),
  ),
]

// --- GET /api/enrollments/history (paginated → apiFetchWithMeta) -----------
export function historyHandlers(
  data: EnrollmentHistoryEntry[] = historyRows,
  paginationOverrides: Partial<PaginationMeta> = {},
) {
  return [
    http.get('/api/enrollments/history', () =>
      HttpResponse.json(historyListEnvelope(data, paginationOverrides)),
    ),
  ]
}

export const historyEmptyHandlers = [
  http.get('/api/enrollments/history', () => HttpResponse.json(historyListEnvelope([]))),
]

/** total=45 with pageSize=20 → the pager renders (AC12). */
export const historyPagedHandlers = [
  http.get('/api/enrollments/history', () =>
    HttpResponse.json(historyListEnvelope(historyRows, { total: 45, totalPages: 3, pageSize: 20 })),
  ),
]

export const history500Handlers = [
  http.get('/api/enrollments/history', () =>
    HttpResponse.json(errorBody('INTERNAL_ERROR', 'req-hist-500'), { status: 500 }),
  ),
]

// --- GET /api/enrollments/attention ----------------------------------------
export function attentionHandlers(data: NeedsAttention = needsAttention()) {
  return [http.get('/api/enrollments/attention', () => HttpResponse.json(envelope(data)))]
}

export const attentionEmptyHandlers = [
  http.get('/api/enrollments/attention', () =>
    HttpResponse.json(envelope(needsAttention({ unassigned: [], overCapacity: [] }))),
  ),
]

/** Unassigned zone total=30, pageSize=10 → the per-zone pager renders (AC8/D11). */
export const attentionUnassignedPagedHandlers = [
  http.get('/api/enrollments/attention', () =>
    HttpResponse.json(
      envelope(
        needsAttention({
          unassigned: [attentionStudent(), attentionStudent({ studentId: 'stu-u2', studentName: 'Second Unassigned', studentEmail: 'u2@example.com' })],
          unassignedPagination: { total: 30, totalPages: 3, pageSize: 10 },
        }),
      ),
    ),
  ),
]

export const attention500Handlers = [
  http.get('/api/enrollments/attention', () =>
    HttpResponse.json(errorBody('INTERNAL_ERROR', 'req-att-500'), { status: 500 }),
  ),
]
