// ATDD RED-PHASE fixtures + MSW handlers for Story 8-1b — the role-scoped
// /api/dashboard read (s06 teacher · s48 owner · s29 student · s62 welcome).
//
// This file is VALID TypeScript on its own and imports the ALREADY-SHIPPED
// generated 8-1a wire types (`components['schemas']['Dashboard*']` from
// '@/lib/api/client'). Typing the fixtures against the generated shapes is
// deliberate: it is the D13 contract co-finalization guard — if any 8-1a
// dashboard shape drifts under a codegen re-run (including the PROVISIONAL→
// final strip), these fixtures stop compiling, surfacing the drift BEFORE the
// UI silently mis-renders. The RED signal for the *.test.tsx consumers is the
// missing modules (DashboardRoute / OwnerDashboard / the real StudentDashboard
// body / useDashboard / useStudentWelcome / DashboardWeekStrip …), NOT this file.
//
// Convention: [[reference_atdd_red_convention]] — FE red-phase = import a
// not-yet-existing module → `tsc -b` + Vitest import failure. No `test.skip()`.
//
// D13 gaps CO-FINALIZED (8-1b code-review, RULED "add all 4" — Ducdo 2026-09-18):
//   • at-risk item carries pendingCount
//   • question-rail item carries className (resolved from classId)
//   • due item carries classId + className
//   • owner needsAttention carries overCapacityClasses (a count + top-N zone)
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type DashboardData = components['schemas']['DashboardData']
type DashboardTeacher = components['schemas']['DashboardTeacher']
type DashboardOwner = components['schemas']['DashboardOwner']
type DashboardStudent = components['schemas']['DashboardStudent']
type DashboardSessionLite = components['schemas']['DashboardSessionLite']
type DashboardGradingItem = components['schemas']['DashboardGradingItem']
type DashboardQuestionRailItem = components['schemas']['DashboardQuestionRailItem']
type DashboardAtRiskItem = components['schemas']['DashboardAtRiskItem']
type DashboardOwnerPulse = components['schemas']['DashboardOwnerPulse']
type DashboardNeedsAttention = components['schemas']['DashboardNeedsAttention']
type DashboardCapacity = components['schemas']['DashboardCapacity']
type DashboardDueItem = components['schemas']['DashboardDueItem']
type DashboardFeedbackItem = components['schemas']['DashboardFeedbackItem']
type DashboardQuestionThreadLite = components['schemas']['DashboardQuestionThreadLite']
type EnvelopeMeta = components['schemas']['EnvelopeMeta']

// ---------------------------------------------------------------------------
// The clock. ALL relative-time assertions (D16 — live-now / countdown / "N ago")
// resolve against THIS injected serverTime, never Date.now(). Sessions/items
// below are positioned deterministically around it.
// ---------------------------------------------------------------------------
export const FIXED_SERVER_TIME = '2026-09-16T10:00:00.000Z'

/** EnvelopeDashboard = { data, meta } — apiFetchWithMeta returns { data, meta }. */
function dashboardEnvelope(
  data: DashboardData,
  serverTime: string = FIXED_SERVER_TIME,
): { data: DashboardData; meta: EnvelopeMeta } {
  return { data, meta: { serverTime } }
}

// ---------------------------------------------------------------------------
// Deterministic IDs (fixed-ID discipline so negative assertions can name a
// specific absent row / a specific live-vs-past session).
// ---------------------------------------------------------------------------
export const DEFAULT_CENTER_ID = 'c-1'
export const STUDENT_USER_ID = 'user-student-1'
export const TEACHER_USER_ID = 'user-teacher-1'
export const OWNER_USER_ID = 'user-owner-1'
export const ADMIN_USER_ID = 'user-admin-1'

// session ids used for live-now vs past assertions (owner.todaySessions)
export const SESSION_LIVE_ID = 'ses-live' // 09:30–10:30Z → live at 10:00Z serverTime
export const SESSION_PAST_ID = 'ses-past' // 08:00–09:00Z → NOT live
export const SESSION_UPCOMING_ID = 'ses-upcoming' // 14:00–15:00Z → later today

export const AT_RISK_STUDENT_ID = 'stu-at-risk'
export const UNASSIGNED_STUDENT_ID = 'stu-unassigned'
export const OVER_CAPACITY_CLASS_ID = 'cls-over-capacity'
export const GRADING_SUBMISSION_ID = 'sub-grade-1'
export const QUESTION_ID = 'q-1'
export const DUE_ASSIGNMENT_DRAFTED_ID = 'asg-drafted' // submissionId != null → Continue writing
export const DUE_ASSIGNMENT_UNSTARTED_ID = 'asg-unstarted' // submissionId == null → Start
export const DRAFT_SUBMISSION_ID = 'sub-draft-1'
export const FEEDBACK_SUBMISSION_ID = 'sub-feedback-1'
export const MY_QUESTION_ID = 'q-mine-1'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export function sessionLite(
  overrides: Partial<DashboardSessionLite> = {},
): DashboardSessionLite {
  return {
    sessionId: SESSION_UPCOMING_ID,
    classId: 'cls-1',
    className: 'IELTS Foundation A',
    // eslint-disable-next-line no-restricted-syntax -- session color is a hex on the wire (DashboardSessionLite.color)
    color: '#3B82F6',
    topic: 'Task 2 essay structure',
    startsAt: '2026-09-16T14:00:00.000Z',
    endsAt: '2026-09-16T15:00:00.000Z',
    status: 'scheduled',
    teacherName: null,
    enrolledCount: null,
    ...overrides,
  }
}

export function gradingItem(
  overrides: Partial<DashboardGradingItem> = {},
): DashboardGradingItem {
  return {
    submissionId: GRADING_SUBMISSION_ID,
    studentName: 'Nguyen An',
    assignmentTitle: 'Writing Task 2 — Environment',
    className: 'IELTS Foundation A',
    overdue: false,
    ...overrides,
  }
}

export function questionRailItem(
  overrides: Partial<DashboardQuestionRailItem> = {},
): DashboardQuestionRailItem {
  return {
    questionId: QUESTION_ID,
    content: 'How do I structure a two-part question?',
    anchorExcerpt: '…the second body paragraph should…',
    classId: 'cls-1',
    className: 'IELTS Foundation A',
    createdAt: '2026-09-16T09:30:00.000Z', // 30 min before serverTime → "30 minutes ago"
    ...overrides,
  }
}

export function atRiskItem(
  overrides: Partial<DashboardAtRiskItem> = {},
): DashboardAtRiskItem {
  return {
    studentId: AT_RISK_STUDENT_ID,
    name: 'Tran Binh',
    attendanceRate: 0.62,
    overallBand: 5.5,
    reasons: ['attendance_below_floor', 'band_drop'],
    pendingCount: 2,
    ...overrides,
  }
}

export function ownerPulse(
  overrides: Partial<DashboardOwnerPulse> = {},
): DashboardOwnerPulse {
  return {
    activeClasses: 12,
    studentsEnrolled: 148,
    staffActiveToday: 5,
    sessionsThisWeek: 34,
    sessionsToday: 6,
    ...overrides,
  }
}

export function capacity(
  overrides: Partial<DashboardCapacity> = {},
): DashboardCapacity {
  return {
    storageUsedBytes: 3_221_225_472, // 3 GiB
    storageLimitBytes: 5_368_709_120, // 5 GiB
    percentUsed: 0.6, // 0..1 FRACTION (D7) → display 60%
    approaching: false,
    ...overrides,
  }
}

/** Capacity in the amber "approaching" band (percentUsed a fraction; ≥ threshold). */
export const capacityApproaching = capacity({
  storageUsedBytes: 4_939_212_390,
  percentUsed: 0.92, // → 92%
  approaching: true,
})

export function dueItem(overrides: Partial<DashboardDueItem> = {}): DashboardDueItem {
  return {
    assignmentId: DUE_ASSIGNMENT_DRAFTED_ID,
    title: 'Writing Task 1 — Line graph',
    skill: 'writing',
    deadlineAt: '2026-09-16T12:00:00.000Z', // 2h after serverTime → countdown "2h"
    classId: 'cls-1',
    className: 'IELTS Foundation A',
    submissionId: DRAFT_SUBMISSION_ID, // != null → "Continue writing" deep-link (D15)
    submissionStatus: 'draft',
    ...overrides,
  }
}

/** Unstarted due item — submissionId null → "Start" deep-link (D15). */
export const dueItemUnstarted = dueItem({
  assignmentId: DUE_ASSIGNMENT_UNSTARTED_ID,
  title: 'Speaking Part 2 — Describe a place',
  skill: 'speaking',
  deadlineAt: '2026-09-16T18:00:00.000Z',
  submissionId: null,
  submissionStatus: null,
})

export function feedbackItem(
  overrides: Partial<DashboardFeedbackItem> = {},
): DashboardFeedbackItem {
  return {
    submissionId: FEEDBACK_SUBMISSION_ID,
    assignmentTitle: 'Writing Task 2 — Technology',
    overallBand: 6.5,
    releasedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  }
}

export function myQuestion(
  overrides: Partial<DashboardQuestionThreadLite> = {},
): DashboardQuestionThreadLite {
  return {
    questionId: MY_QUESTION_ID,
    content: 'Can you clarify the band 7 criteria for coherence?',
    status: 'open',
    createdAt: '2026-09-16T09:00:00.000Z', // 1h before serverTime
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Full role payloads (exactly ONE block non-null — DashboardData invariant)
// ---------------------------------------------------------------------------
export function teacherBlock(
  overrides: Partial<DashboardTeacher> = {},
): DashboardTeacher {
  return {
    weekSessions: [
      sessionLite({ sessionId: SESSION_PAST_ID, startsAt: '2026-09-16T08:00:00.000Z', endsAt: '2026-09-16T09:00:00.000Z' }),
      sessionLite({ sessionId: SESSION_UPCOMING_ID }),
    ],
    needsGrading: { count: 8, items: [gradingItem(), gradingItem({ submissionId: 'sub-grade-2', studentName: 'Le Chi', overdue: true })] },
    unansweredQuestions: { count: 3, items: [questionRailItem()] },
    atRiskStudents: { count: 2, items: [atRiskItem()] },
    ...overrides,
  }
}

export function ownerBlock(overrides: Partial<DashboardOwner> = {}): DashboardOwner {
  return {
    pulse: ownerPulse(),
    todaySessions: [
      sessionLite({
        sessionId: SESSION_LIVE_ID,
        startsAt: '2026-09-16T09:30:00.000Z',
        endsAt: '2026-09-16T10:30:00.000Z', // 09:30 <= 10:00 < 10:30 → LIVE
        teacherName: 'Pham Teacher',
        enrolledCount: 18,
      }),
      sessionLite({
        sessionId: SESSION_PAST_ID,
        startsAt: '2026-09-16T08:00:00.000Z',
        endsAt: '2026-09-16T09:00:00.000Z', // ended → NOT live
        teacherName: 'Vo Teacher',
        enrolledCount: 12,
      }),
    ],
    needsAttention: needsAttentionBlock(),
    ...overrides,
  }
}

export function needsAttentionBlock(
  overrides: Partial<DashboardNeedsAttention> = {},
): DashboardNeedsAttention {
  return {
    unassignedStudents: { count: 4, items: [{ studentId: UNASSIGNED_STUDENT_ID, name: 'Do Dung' }] },
    atRiskStudents: { count: 2, items: [atRiskItem()] },
    overCapacityClasses: {
      count: 1,
      items: [{ classId: OVER_CAPACITY_CLASS_ID, className: 'IELTS Advanced B', capacity: 15, activeCount: 18 }],
    },
    capacity: capacity(),
    pendingInvites: { count: 3 },
    ...overrides,
  }
}

export function studentBlock(
  overrides: Partial<DashboardStudent> = {},
): DashboardStudent {
  return {
    upcomingSessions: [sessionLite({ sessionId: SESSION_UPCOMING_ID })],
    dueSoon: [dueItem(), dueItemUnstarted],
    recentFeedback: [feedbackItem()],
    myQuestions: [myQuestion()],
    ...overrides,
  }
}

export const teacherData: DashboardData = { role: 'teacher', teacher: teacherBlock(), owner: null, student: null }
export const ownerData: DashboardData = { role: 'owner', teacher: null, owner: ownerBlock(), student: null }
export const adminData: DashboardData = { role: 'admin', teacher: null, owner: ownerBlock(), student: null }
export const studentData: DashboardData = { role: 'student', teacher: null, owner: null, student: studentBlock() }

/** Empty student payload — exercises the encouraging empty states + the s62
 *  negative test (all-empty + flag SET must render NO welcome; empty-inference
 *  is forbidden, D12). */
export const studentDataEmpty: DashboardData = {
  role: 'student',
  teacher: null,
  owner: null,
  student: { upcomingSessions: [], dueSoon: [], recentFeedback: [], myQuestions: [] },
}

/** Empty teacher payload — onboarding-complete-but-zero-data (D2 flag → real
 *  dashboard with UX-1 empty states, not the ghost preview). */
export const teacherDataEmpty: DashboardData = {
  role: 'teacher',
  teacher: {
    weekSessions: [],
    needsGrading: { count: 0, items: [] },
    unansweredQuestions: { count: 0, items: [] },
    atRiskStudents: { count: 0, items: [] },
  },
  owner: null,
  student: null,
}

export const ownerDataEmpty: DashboardData = {
  role: 'owner',
  teacher: null,
  owner: {
    pulse: ownerPulse({ activeClasses: 0, studentsEnrolled: 0, staffActiveToday: 0, sessionsThisWeek: 0, sessionsToday: 0 }),
    todaySessions: [],
    needsAttention: {
      unassignedStudents: { count: 0, items: [] },
      atRiskStudents: { count: 0, items: [] },
      overCapacityClasses: { count: 0, items: [] },
      capacity: capacity({ storageUsedBytes: 0, percentUsed: 0, approaching: false }),
      pendingInvites: { count: 0 },
    },
  },
  student: null,
}

// ---------------------------------------------------------------------------
// Handlers — GET /api/dashboard (the SINGLE call the page makes, AC3)
// ---------------------------------------------------------------------------
export function dashboardHandlers(
  data: DashboardData,
  serverTime: string = FIXED_SERVER_TIME,
) {
  return [http.get('/api/dashboard', () => HttpResponse.json(dashboardEnvelope(data, serverTime)))]
}

export const teacherHandlers = dashboardHandlers(teacherData)
export const ownerHandlers = dashboardHandlers(ownerData)
export const adminHandlers = dashboardHandlers(adminData)
export const studentHandlers = dashboardHandlers(studentData)

/** 500 — drives the inline `role="alert"` + retry→refetch trilogy branch. */
export const dashboard500Handlers = [
  http.get('/api/dashboard', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-dash-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** A never-resolving handler is intentionally NOT provided — loading-state
 *  tests assert the skeleton synchronously BEFORE MSW resolves (see the
 *  StaffListPage precedent: query is pending on first paint). */
