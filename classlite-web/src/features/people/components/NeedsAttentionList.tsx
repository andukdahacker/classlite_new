/**
 * NeedsAttentionList — Story 7.3b (s43 needs-attention, AC8–10). Two
 * independently-paginated, color-coded zones over the STABLE 7-3a
 * `GET /api/enrollments/attention` read (each zone's pagination is nested INSIDE
 * `data`, D3/D11):
 *
 *   - Unassigned (amber, `--cl-accent-2` left-border): students in no active
 *     class; each row carries an "Add" affordance that prefills the composer
 *     (AC9 — the component only signals `onAddStudent(studentId)`; the page owns
 *     the prefill wiring).
 *   - Over-capacity (red left-border): classes past capacity, shown as a mono
 *     `activeCount/capacity` ratio. INFORMATIONAL ONLY (no block — 7-3a surfaces,
 *     never enforces; AC10).
 *
 * UX-1 trilogy: a skeleton while loading, a role-appropriate empty state when
 * BOTH zones are empty, and an inline `role="alert"` retry on error.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useNeedsAttention,
  ATTENTION_PAGE_SIZE,
  type EnrollmentAttentionStudent,
  type EnrollmentOverCapacityClass,
  type PaginationMeta,
} from '../api/useEnrolment'

export interface NeedsAttentionListProps {
  /** Prefill the composer with this student in Add mode (AC9). */
  onAddStudent: (studentId: string) => void
}

const SKELETON_ROWS = [0, 1, 2] as const

export function NeedsAttentionList({
  onAddStudent,
}: NeedsAttentionListProps): ReactElement {
  const { t } = useTranslation()
  const [unassignedPage, setUnassignedPage] = useState(1)
  const [overCapacityPage, setOverCapacityPage] = useState(1)
  const query = useNeedsAttention({ unassignedPage, overCapacityPage })

  if (query.isPending) {
    return (
      <section aria-label={t('people.enrolment.attention.title')}>
        <SectionHeading title={t('people.enrolment.attention.title')} />
        <div className="space-y-2" data-testid="needs-attention-skeleton">
          {SKELETON_ROWS.map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (query.isError) {
    return (
      <section aria-label={t('people.enrolment.attention.title')}>
        <SectionHeading title={t('people.enrolment.attention.title')} />
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-red-50 px-3 py-2 text-sm text-[color:var(--cl-red)]"
        >
          <span>{t('people.enrolment.attention.error')}</span>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t('people.enrolment.attention.retry')}
          </Button>
        </div>
      </section>
    )
  }

  const { unassigned, overCapacity } = query.data

  // Reconcile a held page against the (possibly shrunk) result set (P1): after an
  // action removes the last row on page ≥2, the refetch returns an empty page and
  // the zone would otherwise unmount — stranding the pager and, if both zones'
  // pages are empty, falsely showing the all-clear. Clamp to `totalPages` during
  // render (the React-sanctioned "adjust state on prior data" pattern) so the
  // zone snaps back to a populated page.
  if (
    unassigned.pagination.totalPages > 0 &&
    unassignedPage > unassigned.pagination.totalPages
  ) {
    setUnassignedPage(unassigned.pagination.totalPages)
  }
  if (
    overCapacity.pagination.totalPages > 0 &&
    overCapacityPage > overCapacity.pagination.totalPages
  ) {
    setOverCapacityPage(overCapacity.pagination.totalPages)
  }

  const bothEmpty =
    unassigned.items.length === 0 && overCapacity.items.length === 0

  return (
    <section aria-label={t('people.enrolment.attention.title')}>
      <SectionHeading title={t('people.enrolment.attention.title')} />
      {bothEmpty ? (
        <p
          data-testid="needs-attention-empty"
          className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400"
        >
          {t('people.enrolment.attention.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {unassigned.items.length > 0 ? (
            <UnassignedZone
              items={unassigned.items}
              pagination={unassigned.pagination}
              page={unassignedPage}
              onPage={setUnassignedPage}
              onAddStudent={onAddStudent}
            />
          ) : null}
          {overCapacity.items.length > 0 ? (
            <OverCapacityZone
              items={overCapacity.items}
              pagination={overCapacity.pagination}
              page={overCapacityPage}
              onPage={setOverCapacityPage}
            />
          ) : null}
        </div>
      )}
    </section>
  )
}

function SectionHeading({ title }: { title: string }): ReactElement {
  return <h2 className="mb-3 text-sm font-medium text-slate-900">{title}</h2>
}

function UnassignedZone({
  items,
  pagination,
  page,
  onPage,
  onAddStudent,
}: {
  items: EnrollmentAttentionStudent[]
  pagination: PaginationMeta
  page: number
  onPage: (page: number) => void
  onAddStudent: (studentId: string) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="needs-attention-unassigned"
      className="rounded-md border border-slate-200 border-l-4 border-l-[color:var(--cl-accent-2)] p-3"
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {t('people.enrolment.attention.unassignedHeading')}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((student) => (
          <li
            key={student.studentId}
            data-testid={`unassigned-row-${student.studentId}`}
            className="flex items-center justify-between rounded px-2 py-1"
          >
            <span className="flex flex-col">
              <span className="text-sm text-slate-800">{student.studentName}</span>
              <span className="text-xs text-slate-400">{student.studentEmail}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddStudent(student.studentId)}
            >
              {t('people.enrolment.attention.addAction')}
            </Button>
          </li>
        ))}
      </ul>
      {pagination.total > ATTENTION_PAGE_SIZE ? (
        <ZonePager
          testId="unassigned-pager"
          page={page}
          totalPages={pagination.totalPages}
          onPage={onPage}
        />
      ) : null}
    </div>
  )
}

function OverCapacityZone({
  items,
  pagination,
  page,
  onPage,
}: {
  items: EnrollmentOverCapacityClass[]
  pagination: PaginationMeta
  page: number
  onPage: (page: number) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      data-testid="needs-attention-over-capacity"
      className="rounded-md border border-slate-200 border-l-4 border-l-[color:var(--cl-red)] p-3"
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {t('people.enrolment.attention.overCapacityHeading')}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((cls) => (
          <li
            key={cls.classId}
            data-testid={`over-capacity-row-${cls.classId}`}
            className="flex items-center justify-between rounded px-2 py-1"
          >
            <span className="text-sm text-slate-800">{cls.className}</span>
            <span className="font-mono text-xs text-[color:var(--cl-red)]">
              {cls.activeCount}/{cls.capacity}
            </span>
          </li>
        ))}
      </ul>
      {pagination.total > ATTENTION_PAGE_SIZE ? (
        <ZonePager
          testId="over-capacity-pager"
          page={page}
          totalPages={pagination.totalPages}
          onPage={onPage}
        />
      ) : null}
    </div>
  )
}

function ZonePager({
  testId,
  page,
  totalPages,
  onPage,
}: {
  testId: string
  page: number
  totalPages: number
  onPage: (page: number) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mt-3 flex items-center gap-3" data-testid={testId}>
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('people.enrolment.attention.prev')}
      </Button>
      <span className="font-mono text-xs text-slate-500">
        {t('people.enrolment.attention.page', { page, totalPages })}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('people.enrolment.attention.next')}
      </Button>
    </div>
  )
}
