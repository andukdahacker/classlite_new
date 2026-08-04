/**
 * AssignmentsListPage — Story 5.2c (AC1/AC2/AC3/AC5/AC6). The student
 * `/assignments` landing (renders INSIDE AppLayout — sidebar/topbar): a
 * paginated, server-ordered (`deadline_at ASC`, due-soonest first — NOT
 * re-sorted client-side, XL-2) list of the student's enrollment-scoped
 * assignments. Each row is the entry point into the attempt UIs (`AssignmentRow`).
 *
 * Trilogy (UX-1): list-shaped skeleton rows / student-tone empty state (you're
 * all caught up) / inline error + retry. `keepPreviousData` (in the hook) keeps
 * the list from flickering to empty on a page change.
 *
 * Read-only over the already-shipped `GET /api/assignments` (5.2a) — no
 * mutation, no filters (v1 is the server-ordered list; client filters are a
 * later enhancement).
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AssignmentRow } from './AssignmentRow'
import { useStudentAssignments } from './api/useStudentAssignments'

const PAGE_SIZE = 20

export function AssignmentsListPage(): ReactElement {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const params = useMemo(() => ({ page, pageSize: PAGE_SIZE }), [page])
  const listQuery = useStudentAssignments(params)

  const items = listQuery.data?.items ?? []
  const pagination = listQuery.data?.pagination ?? {
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  }
  const serverTime = listQuery.data?.serverTime ?? ''

  // Reconcile the page down when the server-reported page count shrinks so the
  // student is never stranded on a blank page with no controls (mirrors
  // ExerciseLibraryPage / CR-4-1-16). React's sanctioned "adjust state during
  // render" pattern — the guard makes it converge in one extra render, no effect.
  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    setPage(pagination.totalPages)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6" data-testid="assignments-page">
      <header className="mb-6">
        <h1 className="font-fraunces text-2xl text-slate-900">
          {t('assignments.sectionHeading')}
        </h1>
        {!listQuery.isPending && !listQuery.isError ? (
          <p className="mt-1 text-sm text-slate-500" data-testid="assignments-count">
            {t('assignments.countLabel', { count: pagination.total })}
          </p>
        ) : null}
      </header>

      {listQuery.isPending ? (
        <AssignmentRowSkeletons />
      ) : listQuery.isError ? (
        <ErrorAlert
          onRetry={() => listQuery.refetch()}
          message={t('assignments.error.body')}
          retryLabel={t('assignments.error.retry')}
        />
      ) : pagination.total === 0 ? (
        <EmptyState
          headline={t('assignments.empty.headline')}
          body={t('assignments.empty.body')}
        />
      ) : (
        <>
          <ul className="space-y-2" data-testid="assignments-list">
            {items.map((row) => (
              <AssignmentRow key={row.id} row={row} serverTime={serverTime} />
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span data-testid="assignments-showing">
              {t('assignments.footer.showing', {
                shown: items.length,
                total: pagination.total,
              })}
            </span>
            {pagination.totalPages > 1 ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  data-testid="assignments-prev"
                >
                  {t('assignments.pagination.prev')}
                </Button>
                <span className="font-mono text-xs" data-testid="assignments-page-indicator">
                  {t('assignments.pagination.page', {
                    page: pagination.page,
                    totalPages: pagination.totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  data-testid="assignments-next"
                >
                  {t('assignments.pagination.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function AssignmentRowSkeletons(): ReactElement {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" data-testid={`assignment-row-skeleton-${i}`} />
      ))}
    </div>
  )
}

function ErrorAlert({
  onRetry,
  message,
  retryLabel,
}: {
  onRetry: () => void
  message: string
  retryLabel: string
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
    >
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}

function EmptyState({
  headline,
  body,
}: {
  headline: string
  body: string
}): ReactElement {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="assignments-empty"
    >
      <span aria-hidden="true" className="text-4xl">
        🎉
      </span>
      <h2 className="font-fraunces text-xl text-slate-900">{headline}</h2>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
    </div>
  )
}
