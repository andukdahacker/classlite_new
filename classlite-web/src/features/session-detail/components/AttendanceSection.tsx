/**
 * AttendanceSection — Story 3.5b (AC5/AC12–AC15 · D9/D11/D12/D13). The live
 * attendance surface that replaces the dormant AttendancePlaceholder at the TOP
 * of the s12 main column.
 *
 * States (UX-1 trilogy): skeleton while loading, a retry-able error alert on
 * failure, a role-aware empty state (Owner/Admin get an actionable link; a
 * Teacher gets "ask your admin", no dead CTA — AC5), else the roster + summary.
 *
 * Recording:
 *   - per-row tap → optimistic PUT (FW-2 triple in useSetAttendance); a quiet
 *     inline "Saved" tick, never a toast per tap (D13).
 *   - "Mark all Present" → optimistic bulk (benign).
 *   - "Mark all Absent" (destructive) → optimistic bulk, then an UNDO bar that
 *     restores the pre-bulk per-row snapshot (D12). A null-prior row cannot be
 *     un-marked (write-once-editable, D11), so undo restores only the rows that
 *     had a status.
 *   - a bulk FAILURE snaps the whole roster back and shows ONE banner, not N row
 *     errors (D13).
 */
import { type ReactElement, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RosterTable } from '@/components/domain/RosterTable'
import { type AttendanceStatus } from '@/components/domain/AttendanceToggle'
import { useRole } from '@/hooks/useRole'
import {
  useSessionAttendance,
  useSetAttendance,
  useBulkAttendance,
  type AttendanceEntryWire,
} from '../api/attendanceApi'

interface AttendanceSectionProps {
  sessionId: string
}

function summarize(entries: AttendanceEntryWire[]) {
  let present = 0
  let late = 0
  let absent = 0
  for (const entry of entries) {
    if (entry.status === 'present') present += 1
    else if (entry.status === 'late') late += 1
    else if (entry.status === 'absent') absent += 1
  }
  return { total: entries.length, marked: present + late + absent, present, late, absent }
}

export function AttendanceSection({ sessionId }: AttendanceSectionProps): ReactElement {
  const { t } = useTranslation()
  const role = useRole()
  const query = useSessionAttendance(sessionId)
  const setAttendance = useSetAttendance(sessionId)
  const bulkAttendance = useBulkAttendance(sessionId)

  const [bulkError, setBulkError] = useState(false)
  const [rowError, setRowError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<AttendanceEntryWire[] | null>(null)
  const [undone, setUndone] = useState(false)

  const entries = query.data ?? []
  const isEmpty = !query.isPending && !query.isError && entries.length === 0
  const isOwnerOrAdmin = role === 'owner' || role === 'admin'
  const bulkPending = bulkAttendance.isPending

  // Every interaction starts by clearing transient banners AND dismissing a stale
  // undo bar — otherwise a per-row edit made while the undo bar is up would later
  // be silently overwritten by an Undo replaying a pre-edit snapshot.
  function clearBanners(): void {
    setBulkError(false)
    setRowError(false)
    setSaved(false)
    setUndone(false)
    setUndoSnapshot(null)
  }

  function handleSet(studentId: string, status: AttendanceStatus): void {
    clearBanners()
    setAttendance.mutate(
      { studentId, status },
      {
        onSuccess: () => setSaved(true),
        // A failed single-tap otherwise rolls back the toggle with zero feedback
        // (D13 — the broken promise must be visible).
        onError: () => setRowError(true),
      },
    )
  }

  function handleMarkAllPresent(): void {
    clearBanners()
    bulkAttendance.mutate({ status: 'present' }, { onError: () => setBulkError(true) })
  }

  function handleMarkAllAbsent(): void {
    clearBanners()
    const snapshot = entries
    bulkAttendance.mutate(
      { status: 'absent' },
      {
        onSuccess: () => setUndoSnapshot(snapshot),
        onError: () => setBulkError(true),
      },
    )
  }

  async function handleUndo(): Promise<void> {
    if (!undoSnapshot) return
    const snapshot = undoSnapshot
    clearBanners()
    // Re-issue each prior status SEQUENTIALLY — concurrent per-row PUTs share the
    // roster snapshot, so one failure's rollback would discard the others. A
    // null-prior row cannot be un-marked (D11), so it stays absent (accepted).
    let anyFailed = false
    for (const entry of snapshot) {
      if (!entry.status) continue
      try {
        await setAttendance.mutateAsync({ studentId: entry.studentId, status: entry.status })
      } catch {
        anyFailed = true
      }
    }
    // Only claim "restored" if every row actually reverted; a partial failure
    // shows the row-error banner instead of a false success.
    if (anyFailed) setRowError(true)
    else setUndone(true)
  }

  const summary = summarize(entries)
  const canRecord = !query.isPending && !query.isError && entries.length > 0
  // Disable the roster while any per-row PUT is in flight so a second tap cannot
  // race the first (their optimistic rollbacks would clobber each other).
  const rosterDisabled = bulkPending || setAttendance.isPending

  return (
    <section
      data-testid="session-attendance"
      aria-labelledby="attendance-heading"
      className="rounded-lg border border-slate-200 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="attendance-heading" className="font-fraunces text-lg text-slate-900">
          {t('session.attendance.title')}
        </h2>
        {canRecord && (
          <p data-testid="attendance-summary" className="text-sm text-slate-500">
            {t('session.attendance.summary', {
              marked: summary.marked,
              total: summary.total,
              present: summary.present,
              late: summary.late,
              absent: summary.absent,
            })}
          </p>
        )}
      </div>

      {canRecord && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={bulkPending} onClick={handleMarkAllPresent}>
            {t('session.attendance.markAllPresent')}
          </Button>
          <Button size="sm" variant="outline" disabled={bulkPending} onClick={handleMarkAllAbsent}>
            {t('session.attendance.markAllAbsent')}
          </Button>
          {saved && (
            <span aria-live="polite" className="text-xs text-emerald-600" data-testid="attendance-saved">
              {t('session.attendance.saved')}
            </span>
          )}
        </div>
      )}

      {bulkError && (
        <div
          role="alert"
          data-testid="attendance-bulk-error"
          className="mb-3 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
        >
          {t('session.attendance.bulkError')}
        </div>
      )}

      {rowError && (
        <div
          role="alert"
          data-testid="attendance-row-error"
          className="mb-3 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
        >
          {t('session.attendance.rowError')}
        </div>
      )}

      {undoSnapshot && (
        <div
          role="status"
          data-testid="attendance-undo-bar"
          className="mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <span>{t('session.attendance.markAllAbsentDone')}</span>
          <Button size="sm" variant="ghost" onClick={() => void handleUndo()}>
            {t('session.attendance.undo')}
          </Button>
        </div>
      )}

      {undone && (
        <p aria-live="polite" className="mb-3 text-sm text-slate-500" data-testid="attendance-undone">
          {t('session.attendance.markAllAbsentUndone')}
        </p>
      )}

      {query.isPending ? (
        <div data-testid="attendance-skeleton" role="status" aria-busy="true" className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          data-testid="attendance-error"
          className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
        >
          <span>{t('session.attendance.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t('session.attendance.retry')}
          </Button>
        </div>
      ) : isEmpty ? (
        <div
          data-testid="attendance-empty"
          className="flex flex-col items-center gap-2 py-6 text-center text-sm text-slate-500"
        >
          <p>{t(isOwnerOrAdmin ? 'session.attendance.empty.owner' : 'session.attendance.empty.teacher')}</p>
          {isOwnerOrAdmin && (
            <Link to="/classes" className="text-sm font-medium text-[color:var(--cl-accent)] underline">
              {t('session.attendance.enrolCta')}
            </Link>
          )}
        </div>
      ) : (
        <RosterTable entries={entries} onSet={handleSet} disabled={rosterDisabled} />
      )}
    </section>
  )
}
