/**
 * EnrolmentHistoryTable — Story 7.3b (s43 audit trail, AC11–13). The immutable,
 * denormalized enrollment history over the STABLE 7-3a
 * `GET /api/enrollments/history` read (server-paginated → `apiFetchWithMeta`
 * keeps `meta.pagination`, D3/D12), newest-first.
 *
 * Raw `<table>` (the shipped slate idiom, `StudentRosterView`) with columns:
 * When · Student · Action (toned `Badge` pill) · From · To · Effective · By ·
 * Note. Null `fromClassName`/`toClassName`/`note` render an em-dash; a null
 * `performerName` renders "System" (genesis/system rows, D3/D12). Dates via the
 * i18n formatter (TS-6).
 *
 * Optional SERVER-side filters (never client-only, which would break the pager):
 * a class filter (`?class_id`) and a student filter (`?student_id`), both
 * clearable. UX-1 trilogy: row-shaped skeletons / an empty state / an inline
 * `role="alert"` retry.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useClasses } from '@/features/classes'
import {
  useEnrolmentHistory,
  HISTORY_PAGE_SIZE,
  type EnrollmentHistoryEntry,
} from '../api/useEnrolment'
import { useStudentRoster } from '../api/useStudents'
import { useStaffCenterId } from '../lib/useStaffSession'
import {
  formatEnrolmentDate,
  formatEnrolmentDateTime,
} from '../lib/formatEnrolmentDate'
import type { EnrollmentActionType } from '../api/useEnrolmentActions'

const EM_DASH = '—'
const SKELETON_ROWS = [0, 1, 2, 3, 4] as const

type BadgeVariant = 'secondary' | 'outline' | 'destructive'

const ACTION_VARIANT: Record<EnrollmentActionType, BadgeVariant> = {
  add: 'secondary',
  transfer: 'outline',
  withdraw: 'destructive',
}

interface FilterOption {
  id: string
  name: string
}

export function EnrolmentHistoryTable(): ReactElement {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const [classId, setClassId] = useState<string | undefined>(undefined)
  const [studentId, setStudentId] = useState<string | undefined>(undefined)

  const query = useEnrolmentHistory({ page, classId, studentId })

  const centerId = useStaffCenterId()
  const classesQuery = useClasses(centerId, 'all')
  // History is immutable and spans a class's whole lifecycle, so the class
  // filter lists ALL classes (P6 code-review) — an `ended`/`paused` class still
  // owns historical rows and must remain filterable (not `isAssignableClass`).
  const classOptions: FilterOption[] = useMemo(
    () =>
      (classesQuery.data ?? []).map((cls) => ({ id: cls.id, name: cls.name })),
    [classesQuery.data],
  )
  const rosterQuery = useStudentRoster({ page: 1 })
  const studentOptions: FilterOption[] = useMemo(
    () =>
      (rosterQuery.data?.data ?? []).map((s) => ({
        id: s.studentId,
        name: s.name,
      })),
    [rosterQuery.data],
  )

  const entries = query.data?.data ?? []
  const pagination = query.data?.meta.pagination
  const isEmpty = query.isSuccess && entries.length === 0
  const hasFilter = classId !== undefined || studentId !== undefined

  return (
    <section aria-label={t('people.enrolment.history.title')}>
      <h2 className="mb-3 text-sm font-medium text-slate-900">
        {t('people.enrolment.history.title')}
      </h2>

      {/* Filters stay mounted across loading/error (P2 code-review) so a filter
          that produced an error can always be cleared — they are not nested in
          the pending/error branches. */}
      <div className="mb-4 flex flex-wrap gap-4">
        <HistoryFilter
          testId="history-filter-class"
          label={t('people.enrolment.history.filter.classLabel')}
          clearLabel={t('people.enrolment.history.filter.allClasses')}
          options={classOptions}
          selectedId={classId}
          onSelect={(id) => {
            setClassId(id)
            setPage(1)
          }}
        />
        <HistoryFilter
          testId="history-filter-student"
          label={t('people.enrolment.history.filter.studentLabel')}
          clearLabel={t('people.enrolment.history.filter.allStudents')}
          options={studentOptions}
          selectedId={studentId}
          onSelect={(id) => {
            setStudentId(id)
            setPage(1)
          }}
        />
      </div>

      {query.isPending ? (
        <div className="space-y-2" data-testid="history-skeleton">
          {SKELETON_ROWS.map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-red-50 px-3 py-2 text-sm text-[color:var(--cl-red)]"
        >
          <span>{t('people.enrolment.history.error')}</span>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t('people.enrolment.history.retry')}
          </Button>
        </div>
      ) : isEmpty ? (
        <p
          data-testid="history-empty"
          className="rounded-md border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400"
        >
          {hasFilter
            ? t('people.enrolment.history.emptyFiltered')
            : t('people.enrolment.history.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            data-testid="enrolment-history-table"
            aria-label={t('people.enrolment.history.tableAria')}
          >
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.when')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.student')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.action')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.from')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.to')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.effective')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('people.enrolment.history.columns.by')}
                </th>
                <th className="py-2 font-medium">
                  {t('people.enrolment.history.columns.note')}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  locale={i18n.language}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!query.isPending &&
      !query.isError &&
      pagination &&
      pagination.total > HISTORY_PAGE_SIZE ? (
        <div className="mt-4 flex items-center gap-3" data-testid="history-pager">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('people.enrolment.history.prev')}
          </Button>
          <span className="font-mono text-xs text-slate-500">
            {t('people.enrolment.history.page', {
              page: pagination.page,
              totalPages: pagination.totalPages,
            })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('people.enrolment.history.next')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function HistoryRow({
  entry,
  locale,
}: {
  entry: EnrollmentHistoryEntry
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  return (
    <tr
      data-testid={`history-row-${entry.id}`}
      className="border-b border-slate-100"
    >
      <td className="py-2 pr-4 font-mono text-xs text-slate-500">
        {formatEnrolmentDateTime(entry.performedAt, locale)}
      </td>
      <td className="py-2 pr-4 text-slate-800">{entry.studentName}</td>
      <td className="py-2 pr-4">
        <Badge
          variant={ACTION_VARIANT[entry.action]}
          data-testid={`history-action-${entry.action}`}
        >
          {t(`people.enrolment.action.${entry.action}`)}
        </Badge>
      </td>
      <td
        className="py-2 pr-4 text-slate-700"
        data-testid={`history-cell-from-${entry.id}`}
      >
        {entry.fromClassName ?? EM_DASH}
      </td>
      <td
        className="py-2 pr-4 text-slate-700"
        data-testid={`history-cell-to-${entry.id}`}
      >
        {entry.toClassName ?? EM_DASH}
      </td>
      <td className="py-2 pr-4 font-mono text-xs text-slate-500">
        {formatEnrolmentDate(entry.effectiveDate, locale)}
      </td>
      <td className="py-2 pr-4 text-slate-700">
        {entry.performerName ?? t('people.enrolment.history.systemPerformer')}
      </td>
      <td className="py-2 text-slate-600">{entry.note ?? EM_DASH}</td>
    </tr>
  )
}

/** A clearable server-side filter: a listbox of option buttons + a clear button. */
function HistoryFilter({
  testId,
  label,
  clearLabel,
  options,
  selectedId,
  onSelect,
}: {
  testId: string
  label: string
  clearLabel: string
  options: FilterOption[]
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
}): ReactElement {
  return (
    <div>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {/* Clear is a plain button (NOT a listbox option) so the option set is
            exactly the classes/students — the server-side filter targets. */}
        <button
          type="button"
          aria-pressed={selectedId === undefined}
          onClick={() => onSelect(undefined)}
          className={`rounded-full border px-3 py-1 text-xs ${
            selectedId === undefined
              ? 'border-transparent bg-[color:var(--cl-accent)] text-white'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {clearLabel}
        </button>
        <div
          role="listbox"
          aria-label={label}
          data-testid={testId}
          className="flex flex-wrap gap-1"
        >
          {options.map((option) => {
          const selected = selectedId === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(option.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selected
                  ? 'border-transparent bg-[color:var(--cl-accent)] text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {option.name}
            </button>
          )
        })}
        </div>
      </div>
    </div>
  )
}
