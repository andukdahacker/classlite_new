/**
 * notificationMapping.golden.test.ts — Story 10-1b · AC3 / AC8(a) / DD2 / DD3.
 *
 * RED (FE convention: imports a not-yet-existing module → `tsc -b` fails). The
 * COMPILE SEAM is `../notificationMapping` (`toInboxRow`). Dev greens by shipping
 * `src/features/inbox/lib/notificationMapping.ts`.
 *
 * This is the FE-OWNED risk-6 gate (party-mode, Murat): `toInboxRow` is pure FE
 * logic with no server guard, so a mis-routed lane or an `undefined` interpolation
 * is a FE-only defect. The golden pins:
 *   - exhaustive type→InboxRowType lane routing (all 7 NotificationTypes),
 *   - i18n render in BOTH locales (en + vi — UX-2 VN co-primary) with NO
 *     `undefined` / empty-interpolation / dangling-connective residue
 *     (value-scan on the RENDERED string, not key presence — GO-5 wire sends null),
 *   - the per-field null MATRIX (each optional field independently null, DD3),
 *   - the all-thin → server `body` fallback is FLAGGED/greppable, never silent.
 *
 * GREEN SEAM — `toInboxRow(n: Notification): InboxRowData`:
 *   - type→InboxRowType: grade_released→grade · assignment_created→assignment ·
 *     schedule_changed→schedule · question_asked→question · enrollment_changed→
 *     enrolment · payment_failed→billing · storage_threshold→integration.
 *   - MUST be a compile-time-exhaustive switch with a `never` default (assertNever)
 *     so a future NotificationType fails `tsc -b` rather than silently fallback.
 *   - builds mainTextKey/metaKey (inboxRow.* — 1d-4 keys) + vars from metadata,
 *     null-safe (omit band clause, generic schedule variant, neutral class label).
 *   - all-thin escape hatch → mainTextKey = INBOX_FALLBACK_KEY ('inboxRow.fallback')
 *     carrying { body: n.body } (the ONE path rendering the EN snapshot — flagged).
 */
import { describe, expect, it } from 'vitest'

import type { components } from '@/lib/api/client'
import type { InboxRowType } from '@/components/domain/InboxRow'
import i18n from '@/lib/i18n'

// COMPILE SEAM (red): this module does not exist yet.
import { toInboxRow, INBOX_FALLBACK_KEY } from '../notificationMapping'

type Notification = components['schemas']['Notification']
type NotificationType = components['schemas']['NotificationType']
type NotificationMetadata = components['schemas']['NotificationMetadata']

/** A fully-populated metadata superset; override per case to null-out fields. */
const FULL_META: NotificationMetadata = {
  schemaVersion: 1,
  actorId: 'actor-1',
  submissionId: 'sub-1',
  assignmentId: 'asg-1',
  assignmentTitle: 'IELTS Task 2 — Essay',
  className: 'Evening B2',
  dueAt: '2026-10-10T09:00:00Z',
  questionId: 'q-1',
  studentId: 'stu-1',
  studentName: 'Linh Nguyen',
  sessionId: 'sess-1',
  action: null,
  fromClassId: null,
  toClassId: null,
  enrollmentId: 'enr-1',
  usedBytes: 95_000_000,
  limitBytes: 100_000_000,
}

function makeNotif(
  type: NotificationType,
  metadata: NotificationMetadata = FULL_META,
): Notification {
  return {
    id: `n-${type}`,
    type,
    title: `EN snapshot title for ${type}`,
    body: `EN snapshot body for ${type}`,
    link: '/somewhere',
    metadata,
    readAt: null,
    archivedAt: null,
    createdAt: '2026-10-07T12:00:00Z',
  }
}

const LANE: Record<NotificationType, InboxRowType> = {
  grade_released: 'grade',
  assignment_created: 'assignment',
  schedule_changed: 'schedule',
  question_asked: 'question',
  enrollment_changed: 'enrolment',
  payment_failed: 'billing',
  storage_threshold: 'integration',
}

const ALL_TYPES = Object.keys(LANE) as NotificationType[]

/** Fails if the rendered string leaks a null/undefined var or a dangling connective. */
function assertNoResidue(rendered: string, ctx: string) {
  expect(rendered, `${ctx}: literal "undefined"`).not.toMatch(/undefined/i)
  expect(rendered, `${ctx}: unresolved {{token}}`).not.toMatch(/\{\{.*?\}\}/)
  expect(rendered, `${ctx}: empty-value "null"`).not.toMatch(/\bnull\b/)
  // dangling connective — "graded by " / "in " with nothing after, trailing "·"
  expect(rendered.trim(), `${ctx}: dangling connective`).not.toMatch(/(?:by|in|·|—|-)\s*$/i)
  expect(rendered.trim().length, `${ctx}: non-empty`).toBeGreaterThan(0)
}

function renderBothLocales(row: { mainTextKey: string; mainTextVars: Record<string, string> }, ctx: string) {
  for (const lng of ['en', 'vi'] as const) {
    const t = i18n.getFixedT(lng)
    assertNoResidue(t(row.mainTextKey, row.mainTextVars), `${ctx} [${lng}]`)
  }
}

describe('toInboxRow — lane routing (AC8a; the FE-owned risk-6)', () => {
  it.each(ALL_TYPES)('routes %s to the correct display lane', (type) => {
    expect(toInboxRow(makeNotif(type)).type).toBe(LANE[type])
  })

  it('maps createdAt → occurredAt (ISO, TS-6) and readAt=null → unread', () => {
    const row = toInboxRow(makeNotif('grade_released'))
    expect(row.occurredAt).toBe('2026-10-07T12:00:00Z')
    expect(row.unread).toBe(true)
    expect(toInboxRow({ ...makeNotif('grade_released'), readAt: '2026-10-07T13:00:00Z' }).unread).toBe(false)
  })
})

describe('toInboxRow — i18n render, all 7 types, both locales (AC3)', () => {
  it.each(ALL_TYPES)('renders %s with no residue in en + vi', (type) => {
    renderBothLocales(toInboxRow(makeNotif(type)), type)
  })
})

describe('toInboxRow — per-field null MATRIX degrades gracefully (DD3)', () => {
  // grade_released: bandPreview is absent today (FU-10-1-METADATA-ENRICH) — but
  // assignmentTitle / className may ALSO be null independently.
  const grade = (over: Partial<NotificationMetadata>) =>
    toInboxRow(makeNotif('grade_released', { ...FULL_META, ...over }))

  it('grade_released with null assignmentTitle still renders (no residue)', () => {
    renderBothLocales(grade({ assignmentTitle: null }), 'grade/null-title')
  })
  it('grade_released with null className still renders', () => {
    renderBothLocales(grade({ className: null }), 'grade/null-class')
  })

  // schedule_changed carries NO action/old/new time and (today) no class NAME —
  // one generic variant for reschedule/cancel/delete alike (10-1a defer).
  it('schedule_changed fully degraded (null class, null times) renders the generic variant', () => {
    renderBothLocales(
      toInboxRow(makeNotif('schedule_changed', { ...FULL_META, className: null, sessionId: 'sess-1' })),
      'schedule/degraded',
    )
  })

  // enrollment_changed carries class IDs but not names (ids-only) — must not leak an id as a name.
  it('enrollment_changed with null class names renders', () => {
    renderBothLocales(
      toInboxRow(makeNotif('enrollment_changed', { ...FULL_META, className: null })),
      'enrolment/null-names',
    )
  })
})

describe('toInboxRow — all-thin fallback is FLAGGED, never silent (DD3, P0)', () => {
  it('a thin metadata (only schemaVersion) falls back to the server body via the greppable sentinel key', () => {
    const thin: NotificationMetadata = { schemaVersion: 1 } as NotificationMetadata
    // Simulate contract skew / unknown type reaching the defensive default arm.
    const row = toInboxRow({ ...makeNotif('grade_released', thin), body: 'server EN fallback body' })
    // If (and only if) the mapper cannot render a typed variant, it MUST use the
    // flagged fallback key + carry the server body — so the escape hatch is greppable.
    if (row.mainTextKey === INBOX_FALLBACK_KEY) {
      expect(row.mainTextVars.body).toBe('server EN fallback body')
    } else {
      // Otherwise a typed generic variant rendered — still no residue, both locales.
      renderBothLocales(row, 'grade/thin-generic')
    }
  })
})
