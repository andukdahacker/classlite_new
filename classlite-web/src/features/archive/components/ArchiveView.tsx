/**
 * ArchiveView — Story 10.2 (AC8/AC9). The single read-only `/archive` surface for
 * all staff (owner/admin/teacher share the same table; the server role-scopes the
 * rows, keyed by `scope` so audiences don't collide). NOT role-branched JSX — the
 * role only derives the cache scope (UX-3 is about role-DIFFERENT renders; this is
 * the same render for every staff role).
 *
 * Read-only (DD6): rows mount NO edit/delete/status controls. The only actions are
 * Duplicate / Edit-a-copy, and ONLY on exercise rows (Ducdo D3) — a class row shows
 * a read-only badge, no reuse verb. Both reuse verbs call the SAME shipped exercise
 * duplicate (DD4): Duplicate toasts + stays; Edit-a-copy navigates to the new copy's
 * editor on 201. The L/E/E trilogy (UX-1) + an honest DB pager round it out.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useRole, useSessionCenter, useSessionUser } from '@/hooks/useRole'

import { useArchive } from '../api/useArchive'
import {
  ARCHIVE_PAGE_SIZE,
  type ArchiveScope,
  type ArchiveTypeFilter,
} from '../api/archiveKeys'
import { useDuplicateArchiveExercise } from '../api/useDuplicateArchiveExercise'
import { toArchiveRow, type ArchiveRowData } from '../lib/archiveMapping'
import { ArchiveEmpty, ArchiveErrorAlert, ArchiveSkeleton } from './ArchiveStates'

const FILTERS: ReadonlyArray<{ value: ArchiveTypeFilter; labelKey: string }> = [
  { value: '', labelKey: 'archive.filter.all' },
  { value: 'class', labelKey: 'archive.filter.classes' },
  { value: 'exercise', labelKey: 'archive.filter.exercises' },
]

/** One archive row — read-only, with reuse verbs on exercises only. */
function ArchiveRow({
  row,
  duplicating,
  onDuplicate,
  onEditCopy,
}: {
  row: ArchiveRowData
  duplicating: boolean
  onDuplicate: (id: string) => void
  onEditCopy: (id: string) => void
}): ReactElement {
  const { t } = useTranslation()
  const meta =
    row.type === 'exercise'
      ? t('archive.row.exercise.meta', {
          skill: row.skill ?? '',
          targetBand: row.targetBand ?? '—',
        })
      : t('archive.row.class.meta', { endedAt: row.archivedAt })

  return (
    <li
      data-testid={`archive-row-${row.id}`}
      data-type={row.type}
      className="flex items-center justify-between gap-4 border-b border-[color:var(--cl-line-soft)] px-4 py-3 last:border-b-0"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-[color:var(--cl-ink)]">{row.title}</p>
        <p className="truncate text-xs text-[color:var(--cl-ink-soft)]">
          {row.subtitle ? `${row.subtitle} · ` : ''}
          {meta}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.canDuplicate ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={duplicating}
              onClick={() => onDuplicate(row.id)}
              data-testid={`archive-duplicate-${row.id}`}
            >
              {t('archive.actions.duplicate')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={duplicating}
              onClick={() => onEditCopy(row.id)}
              data-testid={`archive-edit-copy-${row.id}`}
            >
              {t('archive.actions.editCopy')}
            </Button>
          </>
        ) : (
          <span
            data-testid={`archive-readonly-${row.id}`}
            className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-[color:var(--cl-ink-soft)]"
          >
            {t('archive.row.readOnlyBadge')}
          </span>
        )}
      </div>
    </li>
  )
}

export function ArchiveView(): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = useRole()
  const user = useSessionUser()
  const center = useSessionCenter()

  const centerId = center?.id ?? null
  const isTeacher = role === 'teacher'
  const userId = user?.id ?? null
  const scope: ArchiveScope = isTeacher ? `teacher:${userId ?? 'self'}` : 'all'

  // A teacher's cache slot is keyed by user id; don't fire the query until the
  // id is known (center can hydrate before useSessionUser), else a transient
  // `teacher:self` slot is orphaned the moment the real id arrives (an extra
  // fetch). Owner/admin are center-wide → ready as soon as centerId exists.
  const ready = centerId != null && (!isTeacher || userId != null)
  const effectiveCenterId = ready ? centerId : null

  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState<ArchiveTypeFilter>('')

  const listQuery = useArchive(effectiveCenterId, scope, {
    page,
    pageSize: ARCHIVE_PAGE_SIZE,
    type: typeFilter,
  })

  const rows = useMemo(
    () => (listQuery.data?.items ?? []).map(toArchiveRow),
    [listQuery.data],
  )

  const duplicate = useDuplicateArchiveExercise()

  const runDuplicate = (id: string, navigateToCopy: boolean) => {
    if (duplicate.isPending) return // double-click guard (the 4.1 CR-4-1-20 lesson)
    duplicate.mutate(id, {
      onSuccess: (created) => {
        if (navigateToCopy) {
          navigate(`/exercises/${created.id}/edit`)
        } else {
          toast.success(t('archive.toast.duplicated'))
        }
      },
      onError: () => toast.error(t('archive.toast.error')),
    })
  }

  const changeFilter = (next: ArchiveTypeFilter) => {
    setTypeFilter(next)
    setPage(1)
  }

  const pagination = listQuery.data?.pagination
  const totalPages = pagination?.totalPages ?? 1

  // If the total shrank below the current page (the 30-day cutoff advanced, or an
  // item was restored/duplicated-away elsewhere), snap back to the last real page
  // rather than showing the empty-archive state on a page that no longer exists
  // (and a nonsensical "5 / 2" pager). Guarded render-time setState (the React
  // "adjust state when data changes" escape hatch — no useEffect, FW-4); skipped
  // for a genuinely empty archive (totalPages 0 → the empty state is correct).
  if (pagination && totalPages >= 1 && page > totalPages) {
    setPage(totalPages)
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6" aria-labelledby="archive-title">
      <header className="space-y-1">
        <h1 id="archive-title" className="text-2xl font-semibold text-[color:var(--cl-ink)]">
          {t('archive.title')}
        </h1>
        <p className="text-sm text-[color:var(--cl-ink-soft)]">{t('archive.subtitle')}</p>
      </header>

      <div role="group" aria-label={t('archive.title')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value || 'all'}
            variant={typeFilter === f.value ? 'default' : 'outline'}
            size="sm"
            aria-pressed={typeFilter === f.value}
            onClick={() => changeFilter(f.value)}
            data-testid={`archive-filter-${f.value || 'all'}`}
          >
            {t(f.labelKey)}
          </Button>
        ))}
      </div>

      {listQuery.isPending ? (
        <ArchiveSkeleton />
      ) : listQuery.isError ? (
        <ArchiveErrorAlert onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <ArchiveEmpty />
      ) : (
        <>
          <ul
            data-testid="archive-list"
            className="overflow-hidden rounded-2xl border border-[color:var(--cl-line-soft)] bg-card"
          >
            {rows.map((row) => (
              <ArchiveRow
                key={`${row.type}-${row.id}`}
                row={row}
                duplicating={duplicate.isPending}
                onDuplicate={(id) => runDuplicate(id, false)}
                onEditCopy={(id) => runDuplicate(id, true)}
              />
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between" aria-label={t('archive.title')}>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="archive-prev"
              >
                ‹
              </Button>
              <span className="text-xs text-[color:var(--cl-ink-soft)]" data-testid="archive-page">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                data-testid="archive-next"
              >
                ›
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  )
}

export default ArchiveView
