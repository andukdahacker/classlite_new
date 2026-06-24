import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bell,
  BookOpen,
  Calendar as CalendarIcon,
  CheckSquare,
  CreditCard,
  HelpCircle,
  Inbox,
  Link as LinkIcon,
  MessageSquare,
  ReplyIcon,
  Star,
  UserPlus,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Role } from '@/hooks/useRole'

/**
 * InboxRow — `s50` / `s51` / `s52` role-scoped inbox row chrome.
 * Story 1d-4 AC6.
 *
 * Static visual identity only. Behavior — TanStack Query inbox polling,
 * action wiring, real notification routing — ships in Epic 10 Story 10.1.
 * The row taxonomy icon set is fixture-driven; the row text is i18n key
 * + interpolation vars resolved by react-i18next. Real notification
 * objects in Epic 10 will map server-side notification types to these
 * keys before render.
 */
export type InboxRowType =
  | 'question'
  | 'submission'
  | 'mention'
  | 'reply'
  | 'grade'
  | 'assignment'
  | 'schedule'
  | 'enrolment'
  | 'staff'
  | 'billing'
  | 'integration'

export interface InboxRowData {
  id: string
  type: InboxRowType
  /** i18n key for the main text. */
  mainTextKey: string
  mainTextVars: Record<string, string>
  /** i18n key for the meta line. */
  metaKey: string
  metaVars: Record<string, string>
  /** ISO timestamp — never `new Date()` per TS-6. */
  occurredAt: string
  /** Pre-formatted relative-time label (e.g. `2h ago`). Real i18n in Epic 10. */
  occurredAtLabel?: string
  unread?: boolean
}

export interface InboxRowProps {
  row: InboxRowData
  role: Role
  onPrimaryAction?: () => void
  onArchive?: () => void
}

const ROW_ICON: Record<InboxRowType, typeof HelpCircle> = {
  question: HelpCircle,
  submission: BookOpen,
  mention: MessageSquare,
  reply: ReplyIcon,
  grade: Star,
  assignment: CheckSquare,
  schedule: CalendarIcon,
  enrolment: UserPlus,
  staff: Users,
  billing: CreditCard,
  integration: LinkIcon,
}

const ROW_TONE: Record<InboxRowType, string> = {
  question: 'text-[color:var(--cl-accent)]',
  submission: 'text-[color:var(--cl-accent-2)]',
  mention: 'text-[color:var(--cl-accent)]',
  reply: 'text-[color:var(--cl-accent)]',
  grade: 'text-[color:var(--cl-green)]',
  assignment: 'text-[color:var(--cl-amber)]',
  schedule: 'text-[color:var(--cl-accent)]',
  enrolment: 'text-[color:var(--cl-accent)]',
  staff: 'text-[color:var(--cl-accent)]',
  billing: 'text-[color:var(--cl-amber)]',
  integration: 'text-[color:var(--cl-muted)]',
}

const PRIMARY_ACTION_KEY: Record<InboxRowType, string> = {
  question: 'inboxRow.action.reply',
  submission: 'inboxRow.action.grade',
  mention: 'inboxRow.action.reply',
  reply: 'inboxRow.action.view',
  grade: 'inboxRow.action.view',
  assignment: 'inboxRow.action.open',
  schedule: 'inboxRow.action.open',
  enrolment: 'inboxRow.action.review',
  staff: 'inboxRow.action.review',
  billing: 'inboxRow.action.review',
  integration: 'inboxRow.action.review',
}

export function InboxRow({ row, role, onPrimaryAction, onArchive }: InboxRowProps) {
  const { t } = useTranslation()
  const Icon = ROW_ICON[row.type] ?? Inbox
  const tone = ROW_TONE[row.type]
  const primaryActionKey = PRIMARY_ACTION_KEY[row.type]
  return (
    <li
      data-testid={`inbox-row-${row.id}`}
      data-row-type={row.type}
      data-row-role={role}
      data-unread={row.unread ? 'true' : 'false'}
      className={cn(
        'group flex items-start gap-3 border-b border-[color:var(--cl-line-soft)] px-4 py-3 last:border-b-0',
        // Match the CommentCard contrast pattern: bg-muted/40 stays above
        // the 4.5 contrast floor for the body `text-foreground` on the
        // card surface; tint-blue/40 was not re-audited and risks the
        // same regression Debug Log fixed elsewhere in 1d-4.
        row.unread && 'bg-muted/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted',
          tone,
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          data-testid={`inbox-row-${row.id}-main`}
          className="text-sm text-foreground"
        >
          {row.unread ? (
            <Bell
              className="mr-1 inline-block size-3 text-[color:var(--cl-accent)] align-text-bottom"
              aria-label={t('inboxRow.unread.aria')}
            />
          ) : null}
          {t(row.mainTextKey, row.mainTextVars)}
        </p>
        <p
          data-testid={`inbox-row-${row.id}-meta`}
          className="text-xs text-foreground"
        >
          {t(row.metaKey, row.metaVars)}
          <span aria-hidden="true"> · </span>
          <time dateTime={row.occurredAt}>
            {row.occurredAtLabel ?? row.occurredAt}
          </time>
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          data-testid={`inbox-row-${row.id}-primary`}
          onClick={onPrimaryAction}
        >
          {t(primaryActionKey)}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`${t('inboxRow.action.archive')}: ${t(row.mainTextKey, row.mainTextVars)}`}
          data-testid={`inbox-row-${row.id}-archive`}
          onClick={onArchive}
        >
          <Archive aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
