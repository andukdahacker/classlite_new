/**
 * Shared MSW fixture builders for Story 2-3b — Murat-I1 party-mode fold.
 * Consumed by TemplateSelectPage / ClassSpawnPage / SoloFirstClassPage tests
 * AND by the eventual Story 2.3c completion-screen tests (which will read
 * `spawnResult.classes[]` for the summary).
 *
 * Contract locked to the Go API per §"MSW handler contract inventory" in
 * story-2-3b Dev Notes. If these builders drift, tests pass while prod
 * breaks — mirror the fold Murat-B2 already landed at 2-3a.
 *
 * All builders return typed objects derived from generated client.ts
 * schemas — a stray field-name typo fails at compile-time, not runtime.
 */
import type { components } from '@/lib/api/client'

type Template = components['schemas']['Template']
type ListTemplatesResult = components['schemas']['ListTemplatesResult']
type SpawnedClass = components['schemas']['SpawnedClass']
type SpawnInviteEntry = components['schemas']['SpawnInviteEntry']
type SpawnResult = components['schemas']['SpawnResult']
type SpawnClassInput = components['schemas']['SpawnClassInput']

// --- System seed template UUIDs (Story 2.2 AC1b fixed IDs) ---
export const SYSTEM_TEMPLATE_IDS = {
  writingBootcamp: '11111111-2222-3333-4444-555555555501',
  speakingMastery: '11111111-2222-3333-4444-555555555502',
  foundationListeningReading: '11111111-2222-3333-4444-555555555503',
  starterBand55: '11111111-2222-3333-4444-555555555504',
  academicReading: '11111111-2222-3333-4444-555555555505',
} as const

// --- Individual template factories ---
// Template.color values in api.yaml are opaque wire values (hex strings);
// same posture as brand-color in `centerSetupSchema.ts` (FU-2-3a-C).
/* eslint-disable no-restricted-syntax -- template.color wire values */
export const systemTemplates: Template[] = [
  {
    id: SYSTEM_TEMPLATE_IDS.writingBootcamp,
    name: 'Writing Bootcamp 6.5',
    targetBand: 6.5,
    primarySkill: 'writing',
    sessionCount: 12,
    color: '#f59e0b',
    scope: 'system',
    usedCount: 0,
  },
  {
    id: SYSTEM_TEMPLATE_IDS.speakingMastery,
    name: 'Speaking Mastery 7+',
    targetBand: 7.0,
    primarySkill: 'speaking',
    sessionCount: 12,
    color: '#3b82f6',
    scope: 'system',
    usedCount: 0,
  },
  {
    id: SYSTEM_TEMPLATE_IDS.foundationListeningReading,
    name: 'Foundation Listening + Reading',
    targetBand: 5.5,
    primarySkill: 'listening_reading',
    sessionCount: 10,
    color: '#10b981',
    scope: 'system',
    usedCount: 0,
  },
  {
    id: SYSTEM_TEMPLATE_IDS.starterBand55,
    name: 'Starter Band 5.5 All Skills',
    targetBand: 5.5,
    primarySkill: 'all_skills',
    sessionCount: 8,
    color: '#8b5cf6',
    scope: 'system',
    usedCount: 0,
  },
  {
    id: SYSTEM_TEMPLATE_IDS.academicReading,
    name: 'Academic Reading 6.5',
    targetBand: 6.5,
    primarySkill: 'reading',
    sessionCount: 10,
    color: '#14b8a6',
    scope: 'system',
    usedCount: 0,
  },
]
/* eslint-enable no-restricted-syntax */

// --- ListTemplatesResult builders ---
export function mockTemplateList(
  overrides: {
    systemCount?: number
    centerTemplates?: Template[]
  } = {},
): ListTemplatesResult {
  const systemCount = overrides.systemCount ?? systemTemplates.length
  return {
    templates: [
      ...systemTemplates.slice(0, systemCount),
      ...(overrides.centerTemplates ?? []),
    ],
  }
}

export function centerTemplate(
  overrides: Partial<Template> = {},
): Template {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
    name: 'IELTS Weekend Special',
    targetBand: 6.0,
    primarySkill: 'writing',
    sessionCount: 8,
    // eslint-disable-next-line no-restricted-syntax -- template.color wire value
    color: '#ec4899',
    scope: 'center',
    usedCount: 0,
    ...overrides,
  }
}

// --- SpawnResult builders ---

/**
 * Derives the server-side teacherAssignmentReason for a given spawn payload.
 * Encodes Branch A/B/C/D logic per Story 2.2 AC4 — shared between fixture
 * and assertions so tests survive contract evolution (Winston-S7 fold).
 *
 * @param persona — persona of the caller (Founder auto-assign kicks in only for `founder`)
 * @param payload — the spawn input for a single class row
 * @param callerEmail — the authenticated user's email (for explicit_self detection)
 * @param existingMembers — set of emails that ARE members of THIS center (Branch B check)
 */
export function deriveTeacherAssignmentReason(
  persona: 'operator' | 'founder' | 'solo_teacher' | null,
  payload: SpawnClassInput,
  classIndex: number,
  callerEmail: string,
  existingMembers: ReadonlySet<string> = new Set(),
): SpawnedClass['teacherAssignmentReason'] {
  const email = payload.teacherEmail?.toLowerCase().trim() ?? null
  // R1-C3-P5 — normalize BOTH sides. Payload email is lowercased + trimmed
  // above; callerEmail must match. A test passing ` owner@example.com ` (or
  // mixed case) would otherwise miss Branch A `explicit_self`.
  const callerNormalized = callerEmail.trim().toLowerCase()

  // Branch A — explicit self
  if (email && email === callerNormalized) {
    return 'explicit_self'
  }

  // AC6 Founder auto-assign — server derives when row 0 teacherEmail is empty
  if (
    persona === 'founder' &&
    classIndex === 0 &&
    (email === null || email === '')
  ) {
    return 'founder_auto'
  }

  // Branch B — existing member of THIS center
  if (email && existingMembers.has(email)) {
    return 'explicit_member'
  }

  // Branch C — non-member, will be invited
  if (email) {
    return 'invited'
  }

  // Branch D — no email, no auto-assign → unassigned
  return 'unassigned'
}

export function mockSpawnedClass(
  overrides: Partial<SpawnedClass> = {},
): SpawnedClass {
  return {
    id: `class-${overrides.id ?? '00000001'}`,
    name: overrides.name ?? 'IELTS Morning',
    startDate: overrides.startDate ?? '2026-07-15',
    teacherId: null,
    teacherEmail: null,
    pendingTeacherEmail: null,
    teacherStatus: 'unassigned',
    teacherAssignmentReason: 'unassigned',
    ...overrides,
  }
}

export function mockInviteEntry(
  overrides: Partial<SpawnInviteEntry> = {},
): SpawnInviteEntry {
  return {
    email: 'invited@example.com',
    classIndices: [0],
    enqueued: true,
    reusedExistingInvite: false,
    expiresAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Build a full SpawnResult from the classes-input payload.
 * Applies Branch A/B/C/D derivation per class.
 */
export function mockSpawnSuccess(options: {
  payload: SpawnClassInput[]
  persona: 'operator' | 'founder' | 'solo_teacher' | null
  callerEmail: string
  callerUserId?: string
  existingMembers?: ReadonlySet<string>
}): SpawnResult {
  const {
    payload,
    persona,
    callerEmail,
    callerUserId = 'user-caller-uuid',
    existingMembers = new Set(),
  } = options

  const classes: SpawnedClass[] = payload.map((row, index) => {
    const reason = deriveTeacherAssignmentReason(
      persona,
      row,
      index,
      callerEmail,
      existingMembers,
    )
    const emailNormalized = row.teacherEmail?.toLowerCase().trim() ?? null

    if (reason === 'explicit_self' || reason === 'founder_auto') {
      return mockSpawnedClass({
        id: `${String(index + 1).padStart(8, '0')}`,
        name: row.cohortName,
        startDate: row.startDate,
        teacherId: callerUserId,
        teacherEmail: callerEmail,
        pendingTeacherEmail: null,
        teacherStatus: 'assigned',
        teacherAssignmentReason: reason,
      })
    }
    if (reason === 'explicit_member') {
      return mockSpawnedClass({
        id: `${String(index + 1).padStart(8, '0')}`,
        name: row.cohortName,
        startDate: row.startDate,
        teacherId: `user-${emailNormalized}-uuid`,
        teacherEmail: emailNormalized,
        pendingTeacherEmail: null,
        teacherStatus: 'assigned',
        teacherAssignmentReason: 'explicit_member',
      })
    }
    if (reason === 'invited') {
      return mockSpawnedClass({
        id: `${String(index + 1).padStart(8, '0')}`,
        name: row.cohortName,
        startDate: row.startDate,
        teacherId: null,
        teacherEmail: null, // privacy — see api.yaml SpawnedClass.teacherEmail description
        pendingTeacherEmail: emailNormalized,
        teacherStatus: 'invited',
        teacherAssignmentReason: 'invited',
      })
    }
    return mockSpawnedClass({
      id: `${String(index + 1).padStart(8, '0')}`,
      name: row.cohortName,
      startDate: row.startDate,
    })
  })

  const invitedEmails = classes
    .filter((c) => c.teacherAssignmentReason === 'invited')
    .map((c) => c.pendingTeacherEmail)
    .filter((e): e is string => e !== null)
  const uniqueInvitedEmails = Array.from(new Set(invitedEmails))
  const invites: SpawnInviteEntry[] = uniqueInvitedEmails.map((email) =>
    mockInviteEntry({
      email,
      classIndices: classes
        .map((c, i) => (c.pendingTeacherEmail === email ? i : -1))
        .filter((i) => i >= 0),
    }),
  )

  return {
    classes,
    invites,
    invitesSent: invites.filter((i) => i.enqueued && !i.reusedExistingInvite)
      .length,
  }
}

// --- 429 fixture with Retry-After variants (Murat-B2 fold) ---
export type RetryAfterVariant = 'short' | 'zero' | 'missing' | 'malformed'

export function retryAfterValue(variant: RetryAfterVariant): string | null {
  if (variant === 'short') return '12'
  if (variant === 'zero') return '0'
  if (variant === 'missing') return null
  return 'abc' // malformed
}

// --- Class spawn input builder ---
export function mockSpawnInput(
  overrides: Partial<SpawnClassInput> = {},
): SpawnClassInput {
  return {
    cohortName: 'IELTS Morning',
    startDate: '2026-07-15',
    teacherEmail: null,
    ...overrides,
  }
}
