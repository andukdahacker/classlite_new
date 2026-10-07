/**
 * notificationMapping — Story 10-1b DD2 / DD3 (AC3 / AC8a).
 *
 * The anti-corruption seam between the backend `NotificationType` (7-enum) and
 * the 1d-4 `InboxRowType` DISPLAY taxonomy. `toInboxRow` is a pure, total,
 * compile-time-exhaustive function: a future `NotificationType` fails `tsc -b`
 * at the `never` default arm rather than silently falling through (Winston — the
 * real anti-drift lever, not test coverage).
 *
 * Why NOT reuse the 1d-4 `inboxRow.{role}.*.main` keys: those placeholders bake
 * in vars the REAL 10-1a metadata never carries (`band`, `plan`, billing
 * `status`, integration `action`, `exercise`). This story renders through a
 * null-safe `inboxRow.{lane}.title` / `.titleGeneric` catalog instead, derived
 * from the fields the ruled event payloads actually populate. Treat EVERY
 * metadata field as runtime-nullable regardless of the DD1b "required" wording
 * until FU-10-1-METADATA-ENRICH lands (the generated type keeps them nullable,
 * so TS forces the guard).
 *
 * Render path: the inbox renders from `type` + `metadata` through this bilingual
 * catalog, NEVER the server's EN `title`/`body` (UX-2 VN co-primary). The ONE
 * exception is the flagged all-thin escape hatch (INBOX_FALLBACK_KEY) — a
 * greppable, P0-tested conscious i18n-model escape, only reachable if an unknown
 * type arrives (contract skew), since every known type has a typed variant.
 */
import i18n from '@/lib/i18n'
import { relativeTime } from '@/lib/relativeTime'

import type { components } from '@/lib/api/client'
import type { InboxRowData, InboxRowType } from '@/components/domain/InboxRow'

type Notification = components['schemas']['Notification']
type NotificationType = components['schemas']['NotificationType']
type NotificationMetadata = components['schemas']['NotificationMetadata']

/**
 * INBOX_FALLBACK_KEY — the greppable sentinel for the all-thin / unknown-type
 * escape hatch. A row carrying this key renders the server EN `body` verbatim
 * (`mainTextVars.body`) — the single path that bypasses the bilingual catalog.
 */
export const INBOX_FALLBACK_KEY = 'inboxRow.fallback'

/** The exhaustive `NotificationType → InboxRowType` lane map (DD2). */
const LANE: Record<NotificationType, InboxRowType> = {
  grade_released: 'grade',
  assignment_created: 'assignment',
  schedule_changed: 'schedule',
  question_asked: 'question',
  enrollment_changed: 'enrolment',
  payment_failed: 'billing',
  // TODO(10-1b): storage_threshold shares the `integration` glyph with the
  // Google-reauth lane — a reasonable v1 default but a semantic collision.
  // Give storage a dedicated glyph when FU-10-1-METADATA-ENRICH lands.
  storage_threshold: 'integration',
}

/** The row fields that don't depend on the typed variant. */
type RowBase = Pick<
  InboxRowData,
  'id' | 'occurredAt' | 'occurredAtLabel' | 'unread' | 'metaKey' | 'metaVars'
>

/** The secondary meta line: class + absolute date when a class name is present,
 *  else just the absolute date (the relative label lives in the row's `<time>`). */
function buildMeta(metadata: NotificationMetadata, createdAt: string): Pick<RowBase, 'metaKey' | 'metaVars'> {
  const className = metadata.className ?? null
  if (className) {
    return { metaKey: 'inboxRow.meta.classDate', metaVars: { class: className, date: createdAt } }
  }
  return { metaKey: 'inboxRow.meta.date', metaVars: { date: createdAt } }
}

/** Storage fill percent from the ruled usedBytes/limitBytes, or null when thin. */
function storagePercent(metadata: NotificationMetadata): number | null {
  const used = metadata.usedBytes
  const limit = metadata.limitBytes
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return null
  // Clamp at 100 — an over-quota row (usedBytes > limitBytes) must not render
  // "Storage is 150% full" (code-review 10-1b P7).
  return Math.min(100, Math.round((used / limit) * 100))
}

type MainText = { mainTextKey: string; mainTextVars: Record<string, string> }

/**
 * assertNever — compile-time exhaustiveness guard. `type` is `never` here as
 * long as the switch handles every NotificationType; adding one without a case
 * makes this call a `tsc -b` error. At RUNTIME it is the defensive flagged
 * fallback for a contract-skew unknown type (greppable via INBOX_FALLBACK_KEY).
 */
function assertNever(type: never, notification: Notification, base: RowBase): InboxRowData {
  void type
  return {
    ...base,
    type: 'integration',
    mainTextKey: INBOX_FALLBACK_KEY,
    mainTextVars: { body: notification.body },
  }
}

/** toInboxRow maps one wire Notification to the 1d-4 InboxRow chrome shape. */
export function toInboxRow(notification: Notification): InboxRowData {
  const metadata = notification.metadata
  const base: RowBase = {
    id: notification.id,
    occurredAt: notification.createdAt,
    occurredAtLabel: relativeTime(notification.createdAt, i18n.t, i18n.language),
    unread: notification.readAt == null,
    ...buildMeta(metadata, notification.createdAt),
  }

  let main: MainText
  switch (notification.type) {
    case 'grade_released': {
      const assignment = metadata.assignmentTitle ?? null
      main = assignment
        ? { mainTextKey: 'inboxRow.grade.title', mainTextVars: { assignment } }
        : { mainTextKey: 'inboxRow.grade.titleGeneric', mainTextVars: {} }
      break
    }
    case 'assignment_created': {
      const assignment = metadata.assignmentTitle ?? null
      main = assignment
        ? { mainTextKey: 'inboxRow.assignment.title', mainTextVars: { assignment } }
        : { mainTextKey: 'inboxRow.assignment.titleGeneric', mainTextVars: {} }
      break
    }
    case 'schedule_changed': {
      // No action/old/new time and (today) no class name → ONE generic variant
      // for reschedule/cancel/delete alike (10-1a defer).
      const className = metadata.className ?? null
      main = className
        ? { mainTextKey: 'inboxRow.schedule.title', mainTextVars: { class: className } }
        : { mainTextKey: 'inboxRow.schedule.titleGeneric', mainTextVars: {} }
      break
    }
    case 'question_asked': {
      const student = metadata.studentName ?? null
      main = student
        ? { mainTextKey: 'inboxRow.question.title', mainTextVars: { student } }
        : { mainTextKey: 'inboxRow.question.titleGeneric', mainTextVars: {} }
      break
    }
    case 'enrollment_changed': {
      // class IDs only (ids-only, no names) — never leak an id as a name.
      const student = metadata.studentName ?? null
      main = student
        ? { mainTextKey: 'inboxRow.enrolment.title', mainTextVars: { student } }
        : { mainTextKey: 'inboxRow.enrolment.titleGeneric', mainTextVars: {} }
      break
    }
    case 'payment_failed':
      main = { mainTextKey: 'inboxRow.billing.title', mainTextVars: {} }
      break
    case 'storage_threshold': {
      const percent = storagePercent(metadata)
      main = percent != null
        ? { mainTextKey: 'inboxRow.storage.title', mainTextVars: { percent: String(percent) } }
        : { mainTextKey: 'inboxRow.storage.titleGeneric', mainTextVars: {} }
      break
    }
    default:
      return assertNever(notification.type, notification, base)
  }

  return { ...base, type: LANE[notification.type], ...main }
}
