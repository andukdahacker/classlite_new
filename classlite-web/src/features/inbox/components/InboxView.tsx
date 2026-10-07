/**
 * InboxView — Story 10-1b + 10-1c. The ONE shared inbox surface the four role views
 * mount (DRY — four near-identical copies are the copy-paste-drift failure mode Murat
 * flagged). It derives its chips from `role` (DD8), fetches the active page
 * (`useInbox`), maps rows via the anti-corruption `toInboxRow` (DD2), and wires the
 * optimistic actions (DD5) + the LEt trilogy (DD9). Role-specific behavior is narrow:
 * `enableTeacherReply` opens the inline composer for `question_asked` rows; everything
 * else rides `n.link` navigation (full-screen push, not a modal — DD10). Role-scope is
 * a 10-1a WRITE invariant — the view never re-filters by role, it renders what arrives
 * (OD6 faithful renderer).
 *
 * Story 10-1c (teacher only): the teacher inbox is ONE merged time-sorted feed of
 * question notifications + grading-queue rows (Ducdo Q1). Two server-paginated sources
 * cannot share a coherent pager, so the teacher branch fetches BOTH at a bounded page
 * size (INBOX_QUEUE_FETCH_SIZE), maps each to InboxRowData, merges + sorts by
 * `occurredAt` DESC, and paginates the MERGED array client-side (DD3 — `total` = merged
 * length, coherent). Submission rows get the Grade action (→ navigate(link)) and
 * suppress archive/read (they leave the feed only when graded + released). The unread
 * badge stays notifications-only (Ducdo Q2). The Late chip filters server-side (Q3).
 * When a source's server `total` exceeds the bounded fetch, an honest seam is shown
 * (FU-10-1C-MERGE-PAGINATION) — never a silent truncation.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { Role } from '@/features/auth/api/authKeys'
import { InboxListShell, type InboxFilterChip } from '@/components/domain/InboxListShell'
import type { InboxRowData } from '@/components/domain/InboxRow'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-fetch'

import { deriveInboxChips, chipFilter, teacherQueueChip } from '../lib/inboxChips'
import { toInboxRow } from '../lib/notificationMapping'
import { toInboxRowFromQueueItem } from '../lib/teacherQueueMapping'
import { inboxKeys, INBOX_PAGE_SIZE, INBOX_QUEUE_FETCH_SIZE, type InboxListParams } from '../api/inboxKeys'
import { useInbox } from '../api/useInbox'
import { useTeacherQueue } from '../api/useTeacherQueue'
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

/** occurredAt DESC; rows with no timestamp sort last (deterministic merge — DD3). */
function byOccurredAtDesc(a: InboxRowData, b: InboxRowData): number {
  if (a.occurredAt === b.occurredAt) return 0
  if (!a.occurredAt) return 1
  if (!b.occurredAt) return -1
  return a.occurredAt < b.occurredAt ? 1 : -1
}

export function InboxView({ role, emptyLens, enableTeacherReply = false }: InboxViewProps): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const isTeacher = role === 'teacher'
  const chips = useMemo(() => deriveInboxChips(role), [role])
  const defaultChip = chips[0]?.key ?? ''
  const [activeChip, setActiveChip] = useState<string>(() => defaultChip)
  const [page, setPage] = useState(1)
  const [activeReply, setActiveReply] = useState<{ rowId: string; questionId: string } | null>(null)
  // Which failed-source signature the teacher has dismissed the partial-error banner for.
  const [dismissedErrorSignature, setDismissedErrorSignature] = useState('')

  const filter = chipFilter(activeChip)
  const isFiltered = Boolean(filter.type || filter.unreadOnly)

  // ── Teacher-queue source routing (10-1c DD3/DD4) ──────────────────────────────
  // `queueChip` is non-null on the Submissions/Late chips (queue-only); the merged
  // `all` chip is notification-sourced-but-empty-filter, so it shows BOTH sources.
  const queueChip = isTeacher ? teacherQueueChip(activeChip) : null
  const queueLateOnly = queueChip?.lateOnly ?? false
  const isMergedAll = isTeacher && !queueChip && !isFiltered
  // Notifications are shown on all/questions/unread (any non-queue teacher chip);
  // hidden on the queue-only chips. Non-teacher roles always show notifications.
  const notifShown = !isTeacher || !queueChip
  const queueShown = Boolean(queueChip) || isMergedAll

  // Notifications: teacher fetches a single bounded page (client-paginated in the
  // merge); other roles keep server pagination (DD3 only reshapes the teacher feed).
  const params: InboxListParams = {
    type: filter.type,
    unreadOnly: filter.unreadOnly,
    page: isTeacher ? 1 : page,
    pageSize: isTeacher ? INBOX_QUEUE_FETCH_SIZE : INBOX_PAGE_SIZE,
  }
  const query = useInbox(params)

  // The teacher grading-queue (derived read). Enabled only when a queue source is in
  // view (DD5 — the student/admin/owner views never mount it); lateOnly tracks the
  // active chip (SERVER-side filter, Q3). page=1 at the bounded fetch (DD3).
  const queueQuery = useTeacherQueue(
    { lateOnly: queueLateOnly, page: 1, pageSize: INBOX_QUEUE_FETCH_SIZE },
    isTeacher && queueShown,
  )

  const actions = useInboxActions()
  const { markRead } = actions

  // Read the global unread count from cache (populated by AppLayout's single poller —
  // AC4) WITHOUT a second poll: a disabled observer reads + stays reactive.
  const countQuery = useQuery({
    queryKey: inboxKeys.count(),
    queryFn: () => apiFetch<UnreadCount>('/api/inbox/count'),
    enabled: false,
    staleTime: Infinity,
  })

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const queueItems = useMemo(() => queueQuery.data?.items ?? [], [queueQuery.data])

  // The displayed rows. Teacher: merge the shown sources, sort newest-first, and
  // client-paginate the merged array (DD3). Other roles: the server page, as-is.
  const notifRows = useMemo(() => (notifShown ? items.map(toInboxRow) : []), [notifShown, items])
  const queueRows = useMemo(
    () => (queueShown ? queueItems.map(toInboxRowFromQueueItem) : []),
    [queueShown, queueItems],
  )
  const mergedRows = useMemo(
    () => (isTeacher ? [...notifRows, ...queueRows].sort(byOccurredAtDesc) : notifRows),
    [isTeacher, notifRows, queueRows],
  )

  const serverTotal = query.data?.pagination?.total ?? 0
  const serverTotalPages = query.data?.pagination?.totalPages ?? 1
  const total = isTeacher ? mergedRows.length : serverTotal
  const totalPages = isTeacher ? Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE)) : serverTotalPages
  // Clamp the teacher client-pager at render: when the merged set shrinks below the
  // active page offset (e.g. archiving rows while on page 2), `page` state can outrun
  // `totalPages`, which would slice to [] and strand the user on an empty body with a
  // positive header count and no pager (code-review 10-1c). Non-teacher pagination is
  // server-driven, so `effectivePage` === `page` there (no behavior change).
  const effectivePage = isTeacher ? Math.min(page, totalPages) : page
  const rows = useMemo(
    () =>
      isTeacher
        ? mergedRows.slice((effectivePage - 1) * INBOX_PAGE_SIZE, effectivePage * INBOX_PAGE_SIZE)
        : mergedRows,
    [isTeacher, mergedRows, effectivePage],
  )

  const pageUnread = items.filter((n) => n.readAt == null).length
  const globalUnread = countQuery.data?.unread ?? pageUnread

  // The in-feed ungraded-backlog count (Q2 — NOT the nav badge) + the chip counts.
  // We only run ONE queue query (the active chip's lateOnly), so the count lands on
  // the chip whose source matches it: Submissions when lateOnly=false (incl. the
  // merged All view), Late when lateOnly=true.
  const queueTotal = queueQuery.data?.pagination?.total
  const toGradeCount = isTeacher && queueShown && !queueLateOnly ? queueTotal : undefined
  const chipsWithCounts: InboxFilterChip[] = useMemo(() => {
    if (!isTeacher || typeof queueTotal !== 'number') return chips
    return chips.map((c) => {
      const q = teacherQueueChip(c.key)
      return q && q.lateOnly === queueLateOnly ? { ...c, count: queueTotal } : c
    })
  }, [isTeacher, chips, queueTotal, queueLateOnly])

  // The DD3 ceiling seam: a source whose server total exceeds the bounded fetch is
  // only partially shown — flag it honestly rather than silently truncating.
  const notifCeiling = notifShown && serverTotal > INBOX_QUEUE_FETCH_SIZE
  const queueCeiling = queueShown && (queueTotal ?? 0) > INBOX_QUEUE_FETCH_SIZE
  const showCeilingSeam = isTeacher && (notifCeiling || queueCeiling)

  // Switching filters resets to page 1 (else you land on page 3 of a 1-page filter).
  const handleToggleFilter = useCallback(
    (key: string) => {
      // Clicking the ACTIVE chip (its rendered "X") clears back to the default chip
      // rather than re-selecting the same filter (code-review 10-1b P4).
      setActiveChip((current) => (key === current && key !== defaultChip ? defaultChip : key))
      setPage(1)
    },
    [defaultChip],
  )

  // read-on-view (DD7) — after a debounce, mark the visible unread NOTIFICATION rows
  // read. A permitted debounced mutation-trigger effect (FW-4 addendum), keyed on the
  // STABLE `markRead` callback + a stable id string. Skipped on the Unread filter (else
  // the list self-empties) AND when notifications are not shown (a queue-only chip —
  // else a background notif fetch gets marked read while off-screen). Guards: does NOT
  // fire while backgrounded; records an id only on SUCCESS so a rolled-back mark retries.
  //
  // The id set is windowed to the DISPLAYED `rows` slice, NOT the full fetched `items`:
  // the teacher branch fetches up to INBOX_QUEUE_FETCH_SIZE notifications but client-
  // paginates 20 at a time, so keying off `items` would mark unread notifications sitting
  // on client-pages 2+ (never scrolled into view) read and silently drop the nav badge
  // (code-review 10-1c). Submission rows carry no read state and aren't in `items`, so
  // the `items` membership check naturally excludes them.
  const markedRef = useRef<Set<string>>(new Set())
  const displayedIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows])
  const unreadIdsKey = items
    .filter((n) => n.readAt == null && displayedIds.has(n.id))
    .map((n) => n.id)
    .join(',')
  useEffect(() => {
    if (filter.unreadOnly || unreadIdsKey === '' || !notifShown) return
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
  }, [unreadIdsKey, filter.unreadOnly, notifShown, markRead])

  // Queue rows carry their own grading deep-link; notifications ride the reply/nav path.
  const queueLinkById = useMemo(() => {
    const map = new Map<string, string>()
    for (const q of queueItems) map.set(q.submissionId, q.link)
    return map
  }, [queueItems])

  const handlePrimaryAction = useCallback(
    (rowId: string) => {
      const queueLink = queueLinkById.get(rowId)
      if (queueLink) {
        navigate(queueLink) // Grade → the exact grading surface (DD3).
        return
      }
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
    [queueLinkById, items, enableTeacherReply, navigate],
  )

  const handleArchive = useCallback(
    (rowId: string) => {
      const { undo } = actions.archive(rowId)
      toast(t('inbox.toast.archived'), {
        // The toast must outlive the deferred commit window so Undo stays actionable
        // for the full window (code-review 10-1b P6).
        duration: ARCHIVE_UNDO_WINDOW_MS,
        action: { label: t('inbox.toast.undo'), onClick: undo },
      })
    },
    [actions, t],
  )

  // Per-source degradation (code-review 10-1c): the teacher `all` view shows BOTH
  // sources, so OR-ing isPending/isError across them blanked the whole surface — a
  // failure of the brand-new derived queue read hid the healthy question feed (and
  // vice-versa). Instead: the full skeleton/error only when EVERY shown source is
  // pending/errored; otherwise render what resolved and flag the failed source inline.
  const notifPending = notifShown && query.isPending
  const queuePending = queueShown && queueQuery.isPending
  const notifError = notifShown && query.isError
  const queueError = queueShown && queueQuery.isError
  const shownSourceCount = (notifShown ? 1 : 0) + (queueShown ? 1 : 0)
  const pendingCount = (notifPending ? 1 : 0) + (queuePending ? 1 : 0)
  const errorCount = (notifError ? 1 : 0) + (queueError ? 1 : 0)
  const allPending = shownSourceCount > 0 && pendingCount === shownSourceCount
  const allError = shownSourceCount > 0 && errorCount === shownSourceCount
  // One source errored while the other has something to show → inline, dismissible warning
  // keyed on WHICH source(s) failed, so a fresh failure re-surfaces after a dismiss.
  const errorSignature = `${notifError ? 'n' : ''}${queueError ? 'q' : ''}`
  const showPartialError = !allError && errorCount > 0 && errorSignature !== dismissedErrorSignature
  if (allPending) return <InboxSkeleton />
  if (allError) {
    return (
      <InboxErrorAlert
        onRetry={() => {
          if (notifShown) void query.refetch()
          if (queueShown) void queueQuery.refetch()
        }}
      />
    )
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
              {/* Under an active filter the GLOBAL unread count cannot be paired with
                  the FILTERED total (it would read "5 unread · 2 total") — show just
                  the filtered total (code-review 10-1b P/D2b). The teacher merged feed
                  pairs the notifications unread with the MERGED total. */}
              {isFiltered
                ? t('inbox.header.total', { total })
                : t('inbox.header.unreadTotal', { unread: globalUnread, total })}
            </p>
          ) : null}
          {typeof toGradeCount === 'number' && toGradeCount > 0 ? (
            <p data-testid="inbox-to-grade" className="text-sm text-[color:var(--cl-ink-soft)]">
              {t('inbox.teacher.toGrade', { count: toGradeCount })}
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
          // Key by questionId so switching rows gives a FRESH composer — otherwise the
          // draft + visibility state bleed onto the next question (a privacy leak —
          // code-review 10-1b P3).
          key={activeReply.questionId}
          questionId={activeReply.questionId}
          onReplied={() => {
            markRead(activeReply.rowId)
            setActiveReply(null)
          }}
        />
      ) : null}

      {showPartialError ? (
        <div
          data-testid="inbox-partial-error"
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-[color:var(--cl-border)] px-3 py-2 text-sm text-[color:var(--cl-ink-soft)]"
        >
          <span className="grow">{t('inbox.teacher.partialError')}</span>
          <Button
            variant="outline"
            size="sm"
            data-testid="inbox-partial-error-retry"
            onClick={() => {
              if (notifError) void query.refetch()
              if (queueError) void queueQuery.refetch()
            }}
          >
            {t('inbox.error.retry')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="inbox-partial-error-dismiss"
            onClick={() => setDismissedErrorSignature(errorSignature)}
          >
            {t('inbox.teacher.partialErrorDismiss')}
          </Button>
        </div>
      ) : null}

      <InboxListShell
        rows={rows}
        role={role}
        filters={chipsWithCounts}
        activeFilters={[activeChip]}
        onToggleFilter={handleToggleFilter}
        onRowPrimaryAction={handlePrimaryAction}
        onRowArchive={handleArchive}
        emptyState={isFiltered || queueChip ? <InboxFilterEmpty /> : <InboxEmpty lens={emptyLens} />}
      />

      {showCeilingSeam ? (
        <p data-testid="inbox-queue-ceiling" role="status" className="text-xs text-[color:var(--cl-ink-soft)]">
          {t('inbox.teacher.queueCeiling')}
        </p>
      ) : null}

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
            onClick={() => setPage(Math.max(1, effectivePage - 1))}
            disabled={effectivePage <= 1}
          >
            {t('inbox.pager.prev')}
          </Button>
          <span className="text-sm text-[color:var(--cl-ink-soft)]">
            {t('inbox.pager.status', { page: effectivePage, totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="inbox-pager-next"
            onClick={() => setPage(Math.min(totalPages, effectivePage + 1))}
            disabled={effectivePage >= totalPages}
          >
            {t('inbox.pager.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
