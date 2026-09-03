/**
 * OwnerActionsCard — Story 7.1b (Task 6, AC11-15). The dashed Owner-only actions
 * card on s40: Assign to class · Reset password · Archive · Force-logout (D7 —
 * force-logout is authoritative per the epic AC, not the terse UX bullet).
 *
 * GATING LIVES IN THE PARENT: `StaffDetailPage` renders this card ONLY when
 * `useRole() === 'owner'` (TEST-FE-6 — an Admin's s40 has NO `owner-actions`
 * node in the DOM, not merely hidden). This component assumes it is already
 * owner-scoped and does not re-check the role.
 *
 * Each action opens an inline confirm surface whose primary control carries
 * `data-testid="owner-action-confirm"`; the control disables while its mutation
 * is in flight (AC15 no-double-submit). Toasts use the shipped `sonner`
 * convention; MSW still owns every network call (the one HTTP seam).
 *
 * The assign-class picker (which reuses the shipped classes list, D13) is a
 * lazily-mounted child so `GET /api/classes` fires ONLY when that panel opens —
 * the other three flows never touch the classes endpoint.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type ApiError } from '@/lib/api-fetch'
import { useClasses } from '@/features/classes'
import type { StaffMemberDetail } from '../api/useStaff'
import { useStaffCenterId } from '../lib/useStaffSession'
import { isAssignableClass } from '../lib/isAssignableClass'
import {
  useArchiveStaff,
  useAssignClass,
  useForceLogout,
  useResetStaffPassword,
} from '../api/useStaffActions'

type OwnerAction = 'assignClass' | 'resetPassword' | 'archive' | 'forceLogout'

export interface OwnerActionsCardProps {
  detail: StaffMemberDetail
}

export function OwnerActionsCard({ detail }: OwnerActionsCardProps): ReactElement {
  const { t } = useTranslation()
  const [active, setActive] = useState<OwnerAction | null>(null)

  const resetPassword = useResetStaffPassword(detail.userId)
  const forceLogout = useForceLogout(detail.userId)
  const archive = useArchiveStaff(detail.userId)

  const close = (): void => setActive(null)

  function confirmReset(): void {
    resetPassword.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('people.staff.resetPassword.success'))
        close()
      },
      onError: () => {
        toast.error(t('people.staff.resetPassword.error'))
        close()
      },
    })
  }

  function confirmForceLogout(): void {
    forceLogout.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          t('people.staff.forceLogout.success', { count: result.sessionsRevoked }),
        )
        close()
      },
      onError: () => {
        toast.error(t('people.staff.forceLogout.error'))
        close()
      },
    })
  }

  function confirmArchive(): void {
    archive.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          t('people.staff.archive.success', { count: result.assignedClassCount }),
        )
        close()
      },
      onError: (err) => {
        toast.error(t(archiveErrorKey(err)))
        close()
      },
    })
  }

  return (
    <section
      data-testid="owner-actions"
      className="mt-6 rounded-lg border border-dashed border-slate-300 p-4"
    >
      <h2 className="mb-1 text-sm font-medium text-slate-900">
        {t('people.staff.actions.heading')}
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        {t('people.staff.actions.subheading')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setActive('assignClass')}>
          {t('people.staff.actions.assignClass')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setActive('resetPassword')}>
          {t('people.staff.actions.resetPassword')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setActive('archive')}>
          {t('people.staff.actions.archive')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setActive('forceLogout')}>
          {t('people.staff.actions.forceLogout')}
        </Button>
      </div>

      {active === 'assignClass' ? (
        <AssignClassPanel userId={detail.userId} onClose={close} />
      ) : null}

      {active === 'resetPassword' ? (
        <ConfirmPanel
          title={t('people.staff.resetPassword.title')}
          body={t('people.staff.resetPassword.body')}
          pending={resetPassword.isPending}
          onConfirm={confirmReset}
          onCancel={close}
        />
      ) : null}

      {active === 'archive' ? (
        <ConfirmPanel
          title={t('people.staff.archive.title')}
          body={
            detail.assignedClasses.length > 0
              ? t('people.staff.archive.ghostWarning', {
                  count: detail.assignedClasses.length,
                })
              : t('people.staff.archive.body')
          }
          pending={archive.isPending}
          onConfirm={confirmArchive}
          onCancel={close}
        />
      ) : null}

      {active === 'forceLogout' ? (
        <ConfirmPanel
          title={t('people.staff.forceLogout.title')}
          body={t('people.staff.forceLogout.body')}
          pending={forceLogout.isPending}
          onConfirm={confirmForceLogout}
          onCancel={close}
        />
      ) : null}
    </section>
  )
}

function archiveErrorKey(err: ApiError): string {
  switch (err.code) {
    case 'CANNOT_ARCHIVE_SELF':
      return 'people.staff.archive.error.cannotArchiveSelf'
    case 'STAFF_ALREADY_ARCHIVED':
      return 'people.staff.archive.error.alreadyArchived'
    default:
      return 'people.staff.archive.error.generic'
  }
}

/**
 * AssignClassPanel — the class picker (D13). Lazily mounted so `useClasses` (→
 * `GET /api/classes`) fires ONLY when the Assign flow is open. Picking a class
 * enables the confirm control; confirm POSTs `assign-class { classId }`.
 */
function AssignClassPanel({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation()
  const centerId = useStaffCenterId()
  const classesQuery = useClasses(centerId, 'all')
  const assign = useAssignClass(userId)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  // Exclude ended (completed) classes — a teacher can't be assigned to a finished
  // class (review decision 2026-09-03).
  const classes = classesQuery.data?.filter(isAssignableClass)

  function confirmAssign(): void {
    if (!selectedClassId) return
    assign.mutate(
      { classId: selectedClassId },
      {
        onSuccess: () => {
          toast.success(t('people.staff.assignClass.success'))
          onClose()
        },
        onError: (err) => {
          toast.error(t(assignErrorKey(err)))
          onClose()
        },
      },
    )
  }

  return (
    <div className="mt-4 rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-sm font-medium text-slate-900">
        {t('people.staff.assignClass.title')}
      </p>
      {classesQuery.isPending ? (
        <p className="text-xs text-slate-400">{t('people.staff.assignClass.loading')}</p>
      ) : classesQuery.isError ? (
        <p role="alert" className="text-xs text-[color:var(--cl-red)]">
          {t('people.staff.assignClass.loadError')}
        </p>
      ) : classes && classes.length === 0 ? (
        <p className="text-xs text-slate-400" data-testid="assign-class-empty">
          {t('people.staff.assignClass.empty')}
        </p>
      ) : (
        <div
          className="flex flex-col gap-1"
          role="listbox"
          aria-label={t('people.staff.assignClass.pickerAria')}
          data-testid="assign-class-picker"
        >
          {classes?.map((cls) => (
            <button
              key={cls.id}
              type="button"
              role="option"
              aria-selected={selectedClassId === cls.id}
              onClick={() => setSelectedClassId(cls.id)}
              className={`rounded px-2 py-1 text-left text-sm ${
                selectedClassId === cls.id
                  ? 'bg-[color:var(--cl-tint-blue)] text-[color:var(--cl-accent)]'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              {cls.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('people.staff.confirm.cancel')}
        </Button>
        <Button
          size="sm"
          data-testid="owner-action-confirm"
          disabled={!selectedClassId || assign.isPending}
          onClick={confirmAssign}
        >
          {t('people.staff.confirm.assign')}
        </Button>
      </div>
    </div>
  )
}

function assignErrorKey(err: ApiError): string {
  switch (err.code) {
    case 'CLASS_NOT_FOUND':
      return 'people.staff.assignClass.error.classNotFound'
    case 'STAFF_NOT_FOUND':
      return 'people.staff.assignClass.error.staffNotFound'
    default:
      return 'people.staff.assignClass.error.generic'
  }
}

/** Inline confirm surface with a shared `owner-action-confirm` primary control. */
function ConfirmPanel({
  title,
  body,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mt-4 rounded-md border border-slate-200 p-3">
      <p className="mb-1 text-sm font-medium text-slate-900">{title}</p>
      <p className="mb-3 text-sm text-slate-600">{body}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('people.staff.confirm.cancel')}
        </Button>
        <Button
          size="sm"
          data-testid="owner-action-confirm"
          disabled={pending}
          onClick={onConfirm}
        >
          {t('people.staff.confirm.confirm')}
        </Button>
      </div>
    </div>
  )
}
