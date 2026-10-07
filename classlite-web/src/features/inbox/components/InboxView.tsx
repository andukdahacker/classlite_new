/**
 * InboxView — Story 10-1b. The ONE shared inbox surface the four role views mount
 * (DRY — four near-identical copies are the copy-paste-drift failure mode Murat
 * flagged). It derives its chips from `role` (DD8), fetches the active page
 * (`useInbox`), maps rows via the anti-corruption `toInboxRow` (DD2), and wires
 * the optimistic actions (DD5) + the LEt trilogy (DD9). Role-specific behavior is
 * narrow: `enableTeacherReply` opens the inline composer for `question_asked`
 * rows; everything else rides `n.link` navigation (full-screen push, not a modal —
 * DD10). Role-scope is a 10-1a WRITE invariant — the view never re-filters by role,
 * it renders what arrives (OD6 faithful renderer).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { Role } from '@/features/auth/api/authKeys'
import { InboxListShell } from '@/components/domain/InboxListShell'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-fetch'

import { deriveInboxChips, chipFilter } from '../lib/inboxChips'
import { toInboxRow } from '../lib/notificationMapping'
import { inboxKeys, INBOX_PAGE_SIZE, type InboxListParams } from '../api/inboxKeys'
import { useInbox } from '../api/useInbox'
import { useInboxActions, ARCHIVE_UNDO_WINDOW_MS } from '../api/useInboxActions'
import type { UnreadCount } from '../api/useInboxCount'
import { InboxEmpty, InboxErrorAlert, InboxFilterEmpty, InboxSkeleton, type InboxEmptyLens } from './InboxStates'
import { InboxReplyComposer } from './InboxReplyComposer'

/** Debounce before read-on-view marks the visible unread rows read (DD7). */
const READ_ON_VIEW_DEBOUNCE_MS = 2_000

export interface InboxViewProps {
  role: Role
  emptyLens: InboxEmptyLens
  /** Teacher-only: intercept `question_asked` rows to open the reply composer. */
  enableTeacherReply?: boolean
}

export function InboxView({ role, emptyLens, enableTeacherReply = false }: InboxViewProps): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const chips = useMemo(() => deriveInboxChips(role), [role])
  const defaultChip = chips[0]?.key ?? ''
  const [activeChip, setActiveChip] = useState<string>(() => defaultChip)
  const [page, setPage] = useState(1)
  const [activeReply, setActiveReply] = useState<{ rowId: string; questionId: string } | null>(null)

  const filter = chipFilter(activeChip)
  const isFiltered = Boolean(filter.type || filter.unreadOnly)
  const params: InboxListParams = {
    type: filter.type,
    unreadOnly: filter.unreadOnly,
    page,
    pageSize: INBOX_PAGE_SIZE,
  }

  const query = useInbox(params)
  const actions = useInboxActions()
  const { markRead } = actions

  // Read the global unread count from cache (populated by AppLayout's single
  // poller — AC4) WITHOUT a second poll: a disabled observer reads + stays reactive.
  const countQuery = useQuery({
    queryKey: inboxKeys.count(),
    queryFn: () => apiFetch<UnreadCount>('/api/inbox/count'),
    enabled: false,
    staleTime: Infinity,
  })

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const rows = useMemo(() => items.map(toInboxRow), [items])
  const total = query.data?.pagination?.total ?? 0
  const totalPages = query.data?.pagination?.totalPages ?? 1
  const pageUnread = items.filter((n) => n.readAt == null).length
  const globalUnread = countQuery.data?.unread ?? pageUnread

  // Switching filters resets to page 1 (else you land on page 3 of a 1-page filter).
  const handleToggleFilter = useCallback(
    (key: string) => {
      // Clicking the ACTIVE chip (its rendered "X") clears back to the default
      // chip rather than re-selecting the same filter (code-review 10-1b P4).
      setActiveChip((current) => (key === current && key !== defaultChip ? defaultChip : key))
      setPage(1)
    },
    [defaultChip],
  )

  // read-on-view (DD7) — after a debounce, mark the visible unread rows read. A
  // permitted debounced mutation-trigger effect (FW-4 addendum), keyed on the
  // STABLE `markRead` callback + a stable id string. Skipped on the Unread filter
  // (else the list self-empties as you look at it). Guards: does NOT fire while the
  // tab is backgrounded, and records an id only on SUCCESS so a rolled-back mark is
  // retried (code-review 10-1b P9).
  const markedRef = useRef<Set<string>>(new Set())
  const unreadIdsKey = items
    .filter((n) => n.readAt == null)
    .map((n) => n.id)
    .join(',')
  useEffect(() => {
    if (filter.unreadOnly || unreadIdsKey === '') return
    const ids = unreadIdsKey.split(',')
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      for (const id of ids) {
        if (!markedRef.current.has(id)) {
          markedRef.current.add(id)
          markRead(id, { onError: () => markedRef.current.delete(id) })
        }
      }
    }, READ_ON_VIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [unreadIdsKey, filter.unreadOnly, markRead])

  const handlePrimaryAction = useCallback(
    (rowId: string) => {
      const notification = items.find((n) => n.id === rowId)
      if (!notification) return
      if (
        enableTeacherReply &&
        notification.type === 'question_asked' &&
        notification.metadata.questionId
      ) {
        setActiveReply({ rowId, questionId: notification.metadata.questionId })
        return
      }
      if (notification.link) navigate(notification.link)
    },
    [items, enableTeacherReply, navigate],
  )

  const handleArchive = useCallback(
    (rowId: string) => {
      const { undo } = actions.archive(rowId)
      toast(t('inbox.toast.archived'), {
        // The toast must outlive the deferred commit window so Undo stays
        // actionable for the full window (code-review 10-1b P6).
        duration: ARCHIVE_UNDO_WINDOW_MS,
        action: { label: t('inbox.toast.undo'), onClick: undo },
      })
    },
    [actions, t],
  )

  if (query.isPending) return <InboxSkeleton />
  if (query.isError) {
    return <InboxErrorAlert onRetry={() => void query.refetch()} />
  }

  return (
    <div data-testid={`inbox-view-${role}`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-[var(--cl-font-display)] text-2xl text-[color:var(--cl-ink)]">
            {t('inbox.page.title')}
          </h1>
          {total > 0 ? (
            <p data-testid="inbox-header-count" className="text-sm text-[color:var(--cl-ink-soft)]">
              {/* Under an active filter the GLOBAL unread count cannot be paired
                  with the FILTERED total (it would read "5 unread · 2 total") —
                  show just the filtered total (code-review 10-1b P/D2b). */}
              {isFiltered
                ? t('inbox.header.total', { total })
                : t('inbox.header.unreadTotal', { unread: globalUnread, total })}
            </p>
          ) : null}
        </div>
        {total > 0 ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="inbox-mark-all-read"
            onClick={() => actions.markAllRead()}
            disabled={actions.isMarkingAllRead}
          >
            {t('inbox.action.markAllRead')}
          </Button>
        ) : null}
      </header>

      {activeReply ? (
        <InboxReplyComposer
          // Key by questionId so switching rows gives a FRESH composer — otherwise
          // the draft + visibility state bleed onto the next question (a privacy
          // leak — code-review 10-1b P3).
          key={activeReply.questionId}
          questionId={activeReply.questionId}
          onReplied={() => {
            markRead(activeReply.rowId)
            setActiveReply(null)
          }}
        />
      ) : null}

      <InboxListShell
        rows={rows}
        role={role}
        filters={chips}
        activeFilters={[activeChip]}
        onToggleFilter={handleToggleFilter}
        onRowPrimaryAction={handlePrimaryAction}
        onRowArchive={handleArchive}
        emptyState={isFiltered ? <InboxFilterEmpty /> : <InboxEmpty lens={emptyLens} />}
      />

      {totalPages > 1 ? (
        <nav
          data-testid="inbox-pager"
          aria-label={t('inbox.pager.label')}
          className="flex items-center justify-center gap-3"
        >
          <Button
            variant="outline"
            size="sm"
            data-testid="inbox-pager-prev"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            {t('inbox.pager.prev')}
          </Button>
          <span className="text-sm text-[color:var(--cl-ink-soft)]">
            {t('inbox.pager.status', { page, totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="inbox-pager-next"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
          >
            {t('inbox.pager.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
