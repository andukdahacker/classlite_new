// ATDD RED-PHASE fixtures + MSW handlers for Story 7-1b — the staff surface.
//
// This file is VALID TypeScript on its own and imports the ALREADY-SHIPPED
// generated 7-1a wire types (`components['schemas'][…]` from '@/lib/api/client').
// Typing the fixtures against the generated shapes is deliberate: it is the
// D16 contract co-finalization guard — if any 7-1a staff shape drifts under a
// codegen re-run, these fixtures stop compiling, surfacing the drift before the
// UI silently mis-renders. The RED signal for the *.test.tsx consumers is the
// missing page/component modules (StaffListPage / StaffDetailPage /
// InviteStaffModal / OwnerActionsCard), NOT this file.
//
// Convention: [[reference_atdd_red_convention]] — FE red-phase = import a
// not-yet-existing module → `tsc -b` + Vitest import failure. No `test.skip()`.
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type StaffRoster = components['schemas']['StaffRoster']
type StaffMember = components['schemas']['StaffMember']
type StaffLoad = components['schemas']['StaffLoad']
type PendingInvite = components['schemas']['PendingInvite']
type StaffMemberDetail = components['schemas']['StaffMemberDetail']
type InviteResult = components['schemas']['InviteResult']
type AssignClassResult = components['schemas']['AssignClassResult']
type ArchiveStaffResult = components['schemas']['ArchiveStaffResult']
type ForceLogoutResult = components['schemas']['ForceLogoutResult']

// Deterministic IDs (mirrors the classes handlers' fixed-ID discipline so
// negative assertions can name a specific absent row).
export const DEFAULT_CENTER_ID = 'c-1'
export const ADMIN_A_ID = 'user-admin-a'
export const TEACHER_ACTIVE_ID = 'user-teacher-active'
export const TEACHER_HEAVY_ID = 'user-teacher-heavy'
export const TEACHER_ARCHIVED_ID = 'user-teacher-archived'
export const PENDING_INVITE_ID = 'inv-pending-1'
export const ASSIGN_CLASS_ID = 'cls-assign-1'

/** The staff envelopes carry NO meta block (EnvelopeStaffRoster = { data }). */
function envelope<T>(data: T): { data: T } {
  return { data }
}

// --- Load builder --------------------------------------------------------
export function staffLoad(overrides: Partial<StaffLoad> = {}): StaffLoad {
  return {
    nextSevenDaysSessionCount: 7,
    weeklyCapacity: 10,
    heavy: false,
    ...overrides,
  }
}

// --- StaffMember builders (role ∈ admin|teacher — owners are EXCLUDED, AC6) --
export function staffMember(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    userId: TEACHER_ACTIVE_ID,
    name: 'Active Teacher',
    email: 'active@example.com',
    avatarUrl: null,
    role: 'teacher',
    status: 'active',
    classesAssigned: 2,
    load: staffLoad(),
    lastActiveAt: '2026-08-29T10:00:00Z',
    ...overrides,
  }
}

export const memberActiveTeacher = staffMember({
  userId: TEACHER_ACTIVE_ID,
  name: 'Active Teacher',
  email: 'active@example.com',
  role: 'teacher',
  status: 'active',
  load: staffLoad({ nextSevenDaysSessionCount: 7, weeklyCapacity: 10, heavy: false }),
})

/** Heavy-load member — LoadMeter must turn amber iff server `load.heavy` (D8). */
export const memberHeavyTeacher = staffMember({
  userId: TEACHER_HEAVY_ID,
  name: 'Heavy Teacher',
  email: 'heavy@example.com',
  role: 'teacher',
  status: 'active',
  classesAssigned: 5,
  load: staffLoad({ nextSevenDaysSessionCount: 9, weeklyCapacity: 10, heavy: true }),
  lastActiveAt: null, // force-logout snaps lastActiveAt to null — "—" (D6/D15)
})

export const memberAdmin = staffMember({
  userId: ADMIN_A_ID,
  name: 'Center Admin',
  email: 'admin@example.com',
  role: 'admin',
  status: 'active',
  classesAssigned: 0,
  load: staffLoad({ nextSevenDaysSessionCount: 0, weeklyCapacity: 10, heavy: false }),
})

export const memberArchivedTeacher = staffMember({
  userId: TEACHER_ARCHIVED_ID,
  name: 'Archived Teacher',
  email: 'archived@example.com',
  role: 'teacher',
  status: 'archived',
  classesAssigned: 1,
  load: staffLoad({ nextSevenDaysSessionCount: 0, weeklyCapacity: 10, heavy: false }),
})

// --- PendingInvite builder (Pending tab; dimmed `??` avatar, AC4) -----------
export function pendingInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    inviteId: PENDING_INVITE_ID,
    name: 'Invited Person',
    email: 'invited@example.com',
    role: 'teacher',
    invitedAt: '2026-08-28T09:00:00Z',
    expiresAt: '2026-09-04T09:00:00Z',
    pendingClassId: null,
    ...overrides,
  }
}

export const pendingInviteFixture = pendingInvite()

/** Full roster: 3 members (2 active + 1 archived + 1 admin) + 1 pending. */
export const rosterFull: StaffRoster = {
  members: [memberActiveTeacher, memberHeavyTeacher, memberAdmin, memberArchivedTeacher],
  pendingInvites: [pendingInviteFixture],
}

/** Empty roster — exercises the s39 empty state (AC5). */
export const rosterEmpty: StaffRoster = { members: [], pendingInvites: [] }

// --- StaffMemberDetail builder ---------------------------------------------
export function staffMemberDetail(
  overrides: Partial<StaffMemberDetail> = {},
): StaffMemberDetail {
  return {
    userId: TEACHER_ACTIVE_ID,
    name: 'Active Teacher',
    email: 'active@example.com',
    avatarUrl: null,
    languagePref: 'en',
    role: 'teacher',
    status: 'active',
    assignedClasses: [
      { classId: 'cls-1', name: 'IELTS Foundation A' },
      { classId: 'cls-2', name: 'IELTS Advanced B' },
    ],
    scheduleGlance: [
      {
        sessionId: 'ses-1',
        classId: 'cls-1',
        className: 'IELTS Foundation A',
        startsAt: '2026-08-31T02:00:00Z',
        endsAt: '2026-08-31T03:30:00Z',
      },
    ],
    load: staffLoad({ nextSevenDaysSessionCount: 7, weeklyCapacity: 10, heavy: false }),
    lastActiveAt: '2026-08-29T10:00:00Z',
    recentActivity: [
      { event: 'session.graded', entityType: 'submission', at: '2026-08-29T08:00:00Z' },
    ],
    ...overrides,
  }
}

/** Detail fixture with >0 assigned classes — drives the D14 archive ghost warning. */
export const detailWithClasses = staffMemberDetail({ userId: TEACHER_ACTIVE_ID })

/** Detail fixture with zero assigned classes — no ghost warning path. */
export const detailNoClasses = staffMemberDetail({
  userId: TEACHER_HEAVY_ID,
  name: 'Heavy Teacher',
  email: 'heavy@example.com',
  assignedClasses: [],
  scheduleGlance: [],
  recentActivity: [],
  lastActiveAt: null,
  load: staffLoad({ nextSevenDaysSessionCount: 9, weeklyCapacity: 10, heavy: true }),
})

// ============================ HANDLERS =====================================

// --- GET /api/staff (roster) ----------------------------------------------
export function rosterHandlers(roster: StaffRoster = rosterFull) {
  return [http.get('/api/staff', () => HttpResponse.json(envelope(roster)))]
}

export const rosterEmptyHandlers = [
  http.get('/api/staff', () => HttpResponse.json(envelope(rosterEmpty))),
]

export const roster500Handlers = [
  http.get('/api/staff', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-staff-500', details: null } },
      { status: 500 },
    ),
  ),
]

// --- GET /api/staff/{userId} (detail) -------------------------------------
export function detailHandlers(detail: StaffMemberDetail = detailWithClasses) {
  return [
    http.get('/api/staff/:userId', () => HttpResponse.json(envelope(detail))),
  ]
}

/** 404 STAFF_NOT_FOUND — absent / cross-tenant / non-disclosure (AC8). */
export const detail404Handlers = [
  http.get('/api/staff/:userId', () =>
    HttpResponse.json(
      { error: { code: 'STAFF_NOT_FOUND', message: 'not found', requestId: 'req-detail-404', details: null } },
      { status: 404 },
    ),
  ),
]

export const detail500Handlers = [
  http.get('/api/staff/:userId', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-detail-500', details: null } },
      { status: 500 },
    ),
  ),
]

// --- Owner actions --------------------------------------------------------
export function assignClassResult(overrides: Partial<AssignClassResult> = {}): AssignClassResult {
  return { userId: TEACHER_ACTIVE_ID, classId: ASSIGN_CLASS_ID, ...overrides }
}

export function assignClassHandlers(result: AssignClassResult = assignClassResult()) {
  return [
    http.post('/api/staff/:userId/assign-class', () =>
      HttpResponse.json(envelope(result)),
    ),
  ]
}

export const assignClass404Handlers = [
  http.post('/api/staff/:userId/assign-class', () =>
    HttpResponse.json(
      { error: { code: 'CLASS_NOT_FOUND', message: 'no class', requestId: 'req-assign-404', details: null } },
      { status: 404 },
    ),
  ),
]

export function archiveResult(overrides: Partial<ArchiveStaffResult> = {}): ArchiveStaffResult {
  return { userId: TEACHER_ACTIVE_ID, status: 'archived', assignedClassCount: 2, ...overrides }
}

export function archiveHandlers(result: ArchiveStaffResult = archiveResult()) {
  return [
    http.post('/api/staff/:userId/archive', () => HttpResponse.json(envelope(result))),
  ]
}

/** 409 CANNOT_ARCHIVE_SELF (AC12). */
export const archiveSelfConflictHandlers = [
  http.post('/api/staff/:userId/archive', () =>
    HttpResponse.json(
      { error: { code: 'CANNOT_ARCHIVE_SELF', message: 'no self', requestId: 'req-arch-self', details: null } },
      { status: 409 },
    ),
  ),
]

/** 409 STAFF_ALREADY_ARCHIVED (AC12). */
export const archiveAlreadyConflictHandlers = [
  http.post('/api/staff/:userId/archive', () =>
    HttpResponse.json(
      { error: { code: 'STAFF_ALREADY_ARCHIVED', message: 'already', requestId: 'req-arch-dupe', details: null } },
      { status: 409 },
    ),
  ),
]

/** 204 no-body reset-password (AC13). */
export const resetPasswordHandlers = [
  http.post('/api/staff/:userId/reset-password', () => new HttpResponse(null, { status: 204 })),
]

export function forceLogoutResult(overrides: Partial<ForceLogoutResult> = {}): ForceLogoutResult {
  return { forcedLogout: true, sessionsRevoked: 3, ...overrides }
}

/** Reuses the SHIPPED /api/admin/users/{userId}/force-logout (AC14 / D15). */
export function forceLogoutHandlers(result: ForceLogoutResult = forceLogoutResult()) {
  return [
    http.post('/api/admin/users/:userId/force-logout', () =>
      HttpResponse.json(envelope(result)),
    ),
  ]
}

// --- POST /api/centers/{centerId}/invites (s41 invite) ---------------------
export function inviteResult(overrides: Partial<InviteResult> = {}): InviteResult {
  return {
    id: 'inv-new-1',
    email: 'newhire@example.com',
    role: 'teacher',
    expiresAt: '2026-09-06T00:00:00Z',
    ...overrides,
  }
}

export function inviteHandlers(result: InviteResult = inviteResult()) {
  return [
    http.post('/api/centers/:centerId/invites', () =>
      HttpResponse.json(envelope(result), { status: 201 }),
    ),
  ]
}

/** 409 INVITE_EMAIL_TAKEN → people.invite.error.emailTaken (field=email, AC18). */
export const invite409EmailTakenHandlers = [
  http.post('/api/centers/:centerId/invites', () =>
    HttpResponse.json(
      { error: { code: 'INVITE_EMAIL_TAKEN', message: 'taken', requestId: 'req-inv-409', details: null } },
      { status: 409 },
    ),
  ),
]

/** 403 ROLE_ASSIGNMENT_FORBIDDEN → people.invite.error.roleAssignmentForbidden (AC18). */
export const invite403RoleForbiddenHandlers = [
  http.post('/api/centers/:centerId/invites', () =>
    HttpResponse.json(
      { error: { code: 'ROLE_ASSIGNMENT_FORBIDDEN', message: 'no owner', requestId: 'req-inv-403', details: null } },
      { status: 403 },
    ),
  ),
]

// --- GET /api/classes (assign-class picker reuse, D13) ---------------------
// Minimal shape the picker needs — mirrors the shipped classes-list envelope.
export const assignPickerClassesHandlers = [
  http.get('/api/classes', () =>
    HttpResponse.json({
      data: [
        { id: ASSIGN_CLASS_ID, name: 'Assignable Class', status: 'active' },
        { id: 'cls-other', name: 'Another Class', status: 'active' },
      ],
      meta: { serverTime: '2026-08-30T00:00:00Z' },
    }),
  ),
]
