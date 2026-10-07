/**
 * teacherQueueMapping.golden.test.ts — Story 10-1c · AC8 / DD6.
 *
 * RED (FE convention: imports a not-yet-existing module → `tsc -b` fails). The
 * COMPILE SEAM is `../teacherQueueMapping` (`toInboxRowFromQueueItem`). Dev greens by
 * shipping `src/features/inbox/lib/teacherQueueMapping.ts`.
 *
 * WHY A SIBLING MAPPER (not a widened toInboxRow): teacher-queue items are a DERIVED
 * read over submissions — NOT `Notification` rows. `NotificationType` must stay a
 * 7-member enum and `toInboxRow`'s `never`-exhaustive switch must stay intact
 * (10-1b DD2). So the queue gets its own pure mapper into the shared `InboxRowData`.
 *
 * GREEN SEAM — `toInboxRowFromQueueItem(q): InboxRowData`:
 *   - type = 'submission' (the 1d-4 lane: BookOpen icon, inboxRow.action.grade).
 *   - mainTextKey = 'inboxRow.teacher.submission.main' (1d-4, shipped) with
 *       mainTextVars { student: q.studentName, exercise: q.assignmentTitle }.
 *   - metaKey selects the STRONGER signal (DD6): overdue → an overdue variant;
 *       else isLate → a late variant; else a neutral submitted-time variant. The
 *       three variants MUST be distinct keys (net-new, STORY_10_1C_KEYS, both locales).
 *   - occurredAt = q.submittedAt; unread unset (queue rows have no read state).
 *   - renders in BOTH en + vi with NO `undefined`/empty interpolation (value-scan).
 */
import { describe, expect, it } from 'vitest'

import type { InboxRowType } from '@/components/domain/InboxRow'
import i18n from '@/lib/i18n'

// COMPILE SEAM (red): this module does not exist yet.
import { toInboxRowFromQueueItem } from '../teacherQueueMapping'

// Structural shape of the api.yaml TeacherQueueItem (kept local so the ONLY missing
// import is the mapper — the generated `components['schemas']['TeacherQueueItem']`
// lands at green via codegen; structural typing accepts this fixture either way).
interface QueueItemLike {
  submissionId: string
  studentName: string
  assignmentTitle: string
  className: string
  isLate: boolean
  overdue: boolean
  submittedAt: string
  classId: string
  assignmentId: string
  link: string
}

const BASE: QueueItemLike = {
  submissionId: 'sub-1',
  studentName: 'Mai Nguyen',
  assignmentTitle: 'IELTS Task 2',
  className: 'IELTS Evening',
  isLate: false,
  overdue: false,
  submittedAt: '2026-10-06T09:00:00Z',
  classId: 'class-1',
  assignmentId: 'asg-1',
  link: '/classes/class-1/grading/asg-1/sub-1',
}

const LOCALES = ['en', 'vi'] as const

/** resolve a key+vars in a given locale and return the rendered string. */
function render(locale: (typeof LOCALES)[number], key: string, vars: Record<string, unknown>): string {
  return i18n.getFixedT(locale)(key, vars)
}

describe('toInboxRowFromQueueItem — queue → InboxRowData (AC8/DD6)', () => {
  it("maps to the 'submission' lane with the shipped main text + vars", () => {
    const row = toInboxRowFromQueueItem(BASE)
    expect(row.type).toBe<InboxRowType>('submission')
    expect(row.mainTextKey).toBe('inboxRow.teacher.submission.main')
    expect(row.mainTextVars).toMatchObject({ student: 'Mai Nguyen', exercise: 'IELTS Task 2' })
    expect(row.occurredAt).toBe(BASE.submittedAt)
    expect(row.unread ?? false).toBe(false) // queue rows carry no read/unread state
  })

  it('selects three DISTINCT meta variants by the stronger signal (overdue > late > neutral)', () => {
    const overdue = toInboxRowFromQueueItem({ ...BASE, overdue: true, isLate: true })
    const late = toInboxRowFromQueueItem({ ...BASE, overdue: false, isLate: true })
    const neutral = toInboxRowFromQueueItem({ ...BASE, overdue: false, isLate: false })

    // overdue outranks late when both are true (DD6 "stronger signal").
    expect(overdue.metaKey).not.toBe(late.metaKey)
    expect(late.metaKey).not.toBe(neutral.metaKey)
    expect(overdue.metaKey).not.toBe(neutral.metaKey)
  })

  it('renders main + every meta variant in BOTH locales with no undefined/empty interpolation', () => {
    const cases = [
      toInboxRowFromQueueItem({ ...BASE, overdue: true }),
      toInboxRowFromQueueItem({ ...BASE, isLate: true }),
      toInboxRowFromQueueItem({ ...BASE }),
    ]
    for (const locale of LOCALES) {
      for (const row of cases) {
        const main = render(locale, row.mainTextKey, row.mainTextVars)
        const meta = render(locale, row.metaKey, row.metaVars ?? {})
        for (const [label, out] of [['main', main], ['meta', meta]] as const) {
          expect(out, `${locale} ${label} non-empty`).not.toBe('')
          expect(out.toLowerCase(), `${locale} ${label} no undefined`).not.toContain('undefined')
          expect(out, `${locale} ${label} no dangling interpolation`).not.toMatch(/\{\{|\}\}/)
        }
        // main text actually interpolated the student + exercise.
        expect(main).toContain('Mai Nguyen')
        expect(main).toContain('IELTS Task 2')
      }
    }
  })
})
