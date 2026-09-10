/**
 * EnrolmentPage — Story 7.3b (s43 `/people/enrolment`, AC1/3/8/11). The
 * Owner/Admin enrolment console: a page head with a "N need attention"
 * superscript, then the three composites top-to-bottom (D5) — the compose row,
 * the two-zone needs-attention list, and the immutable history table.
 *
 * Owner/Admin-only by ROUTE gate (`RouteRoleGate allowedRoles={['owner','admin']}`
 * in `routes.tsx`); there is no in-page role branch (UX-3 satisfied by the
 * route). Each composite owns its own UX-1 trilogy (D2).
 *
 * The page owns the AC9 prefill seam: a needs-attention "Add" click lifts the
 * student id + a bumping nonce into the composer, which selects that student in
 * Add mode. The nonce lets the same student be re-prefilled after a reset.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { EnrolmentComposer } from './components/EnrolmentComposer'
import { NeedsAttentionList } from './components/NeedsAttentionList'
import { EnrolmentHistoryTable } from './components/EnrolmentHistoryTable'
import { useNeedsAttention } from './api/useEnrolment'

export function EnrolmentPage(): ReactElement {
  const { t } = useTranslation()
  const [prefillStudentId, setPrefillStudentId] = useState<string | null>(null)
  const [prefillNonce, setPrefillNonce] = useState(0)

  // Page-level count for the head superscript. Shares the first-page cache key
  // with NeedsAttentionList's initial render (one fetch); zone totals are
  // page-independent so this stays accurate as the user pages within a zone.
  const attentionQuery = useNeedsAttention({
    unassignedPage: 1,
    overCapacityPage: 1,
  })
  const attentionCount = attentionQuery.data
    ? attentionQuery.data.unassigned.pagination.total +
      attentionQuery.data.overCapacity.pagination.total
    : 0

  function handleAddStudent(studentId: string): void {
    setPrefillStudentId(studentId)
    setPrefillNonce((nonce) => nonce + 1)
  }

  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6"
      data-testid="enrolment-page"
    >
      <header className="mb-6">
        <h1 className="font-fraunces text-2xl text-slate-900">
          {t('people.enrolment.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {/* Gate the count on a settled read (P4 code-review) — never show a
              false "0 need attention" while the query is pending/errored. */}
          {attentionQuery.isSuccess
            ? t('people.enrolment.needAttentionCount', { count: attentionCount })
            : t('people.enrolment.needAttentionCountPending')}
        </p>
      </header>

      <div className="flex flex-col gap-8">
        <EnrolmentComposer
          prefillStudentId={prefillStudentId}
          prefillNonce={prefillNonce}
        />
        <NeedsAttentionList onAddStudent={handleAddStudent} />
        <EnrolmentHistoryTable />
      </div>
    </div>
  )
}
