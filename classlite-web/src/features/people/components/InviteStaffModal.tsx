/**
 * InviteStaffModal — Story 7.1b (Task 7, AC16-19). The s41 invite modal, cloned
 * from `ClassFormDialog`: an always-mounted shadcn `Dialog` (parent-controlled
 * via `onClose`) with RHF + `zodResolver(usePeopleInviteSchema())`.
 *
 * Fields (D11): email (required, "recipient sets own password" helper) · name
 * (optional) · role (`RoleChipGroup` — Teacher/Admin ONLY per D12) · classId
 * (optional, TEACHER-role only — the affordance appears only when role=teacher
 * and the payload carries `classId` only then, D7) · welcomeNote (optional) ·
 * footer "expires in 7 days". `centerId` is read from the SESSION cache (AC17),
 * never a prop. The classId picker reuses the shipped classes list (D13) and is
 * a lazily-mounted child so `GET /api/classes` fires ONLY for a teacher invite.
 *
 * Errors map to i18n copy (AC18): 409 INVITE_EMAIL_TAKEN → the email field, 403
 * ROLE_ASSIGNMENT_FORBIDDEN → a form-level alert, others → a generic form error.
 */
import { useEffect, useRef, type ReactElement } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RoleChipGroup, type ChipRole } from '@/components/domain/RoleChipGroup'
import { useClasses } from '@/features/classes'
import {
  usePeopleInviteSchema,
  type PeopleInviteFormValues,
} from '../lib/inviteSchema'
import { useStaffCenterId } from '../lib/useStaffSession'
import { isAssignableClass } from '../lib/isAssignableClass'
import {
  useInviteStaff,
  type InviteStaffRequest,
} from '../api/useStaffActions'

export interface InviteStaffModalProps {
  onClose: () => void
}

export function InviteStaffModal({ onClose }: InviteStaffModalProps): ReactElement {
  const { t } = useTranslation()
  const schema = usePeopleInviteSchema()
  const centerId = useStaffCenterId()
  const invite = useInviteStaff(centerId ?? '')

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PeopleInviteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', welcomeNote: '' },
  })

  const role = useWatch({ control, name: 'role' }) as ChipRole | undefined
  const classId = useWatch({ control, name: 'classId' })
  const formError = errors.root?.message ?? null

  const onSubmit = handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(buildInvitePayload(values))
      onClose()
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError('root', { message: t('people.invite.error.generic') })
        return
      }
      mapInviteError(err)
    }
  })

  function mapInviteError(err: ApiError): void {
    switch (err.code) {
      case 'INVITE_EMAIL_TAKEN':
        setError('email', { message: t('people.invite.error.emailTaken') })
        return
      case 'ROLE_ASSIGNMENT_FORBIDDEN':
        setError('root', {
          message: t('people.invite.error.roleAssignmentForbidden'),
        })
        return
      case 'CLASS_NOT_FOUND':
        setError('classId', { message: t('people.invite.error.classNotFound') })
        return
      default:
        setError('root', { message: t('people.invite.error.generic') })
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus management for the hand-rolled modal (base-ui's Dialog would give this
  // for free, but its portal focus-guards trip axe(document.body) in jsdom —
  // which reports navigator.vendor as Apple, so base-ui renders Safari-only
  // role="button" guards with no accessible name). To match the shadcn Dialog it
  // replaces (TEST-UX-2 — modals trap focus and return it on close), this effect:
  // moves initial focus into the dialog, cycles Tab within it, closes on Escape,
  // and restores focus to the trigger on unmount. DOM-imperative focus work is a
  // permitted useEffect use (FW-4).
  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []

    focusables()[0]?.focus()

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusables()
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('people.invite.cancel')}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        aria-describedby="invite-subtitle"
        className="relative z-10 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
      >
        <div className="mb-4">
          <h2 id="invite-title" className="text-lg font-medium text-slate-900">
            {t('people.invite.title')}
          </h2>
          <p id="invite-subtitle" className="mt-1 text-sm text-slate-500">
            {t('people.invite.subtitle')}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="invite-email">{t('people.invite.fields.email')}</Label>
            <Input id="invite-email" type="email" {...register('email')} />
            <p className="text-xs text-slate-400">
              {t('people.invite.fields.emailHelper')}
            </p>
            {errors.email ? (
              <p role="alert" className="text-xs text-[color:var(--cl-red)]">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="invite-name">{t('people.invite.fields.name')}</Label>
            <Input id="invite-name" {...register('name')} />
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t('people.invite.fields.role')}
            </span>
            <RoleChipGroup
              ariaLabel={t('people.invite.fields.role')}
              options={[
                { value: 'teacher', label: t('people.invite.role.teacher') },
                { value: 'admin', label: t('people.invite.role.admin') },
              ]}
              value={role ?? null}
              onChange={(next) => {
                setValue('role', next, { shouldValidate: false })
                if (next !== 'teacher') setValue('classId', null)
              }}
            />
            {errors.role ? (
              <p role="alert" className="text-xs text-[color:var(--cl-red)]">
                {errors.role.message}
              </p>
            ) : null}
          </div>

          {role === 'teacher' ? (
            <TeacherClassField
              centerId={centerId}
              value={classId ?? null}
              onChange={(id) => setValue('classId', id)}
              error={errors.classId?.message}
            />
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="invite-welcomeNote">
              {t('people.invite.fields.welcomeNote')}
            </Label>
            <Textarea id="invite-welcomeNote" {...register('welcomeNote')} />
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            >
              {formError}
            </p>
          ) : null}

          <p className="text-xs text-slate-400">
            {t('people.invite.footer.expiry')}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('people.invite.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !centerId}>
              {t('people.invite.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * TeacherClassField — the teacher-only class picker. Lazily mounted (only when
 * role=teacher) so `useClasses` (→ `GET /api/classes`) never fires for an admin
 * invite. Defaults to the first class once loaded so a teacher invite always
 * carries a `classId` (the epic's auto-assign-on-accept path).
 */
function TeacherClassField({
  centerId,
  value,
  onChange,
  error,
}: {
  centerId: string | null
  value: string | null
  onChange: (id: string) => void
  error?: string
}): ReactElement {
  const { t } = useTranslation()
  const classesQuery = useClasses(centerId, 'all')
  // Exclude ended (completed) classes — a teacher can't be assigned to a finished
  // class (review decision 2026-09-03). upcoming/active/paused stay assignable, so
  // a fresh center's first (upcoming) class still shows.
  const classes = classesQuery.data?.filter(isAssignableClass)

  // One-shot default-select of the first class once the (Query-owned) list
  // lands, so a teacher invite always carries a classId. Guarded on `!value`
  // so a user's explicit pick is never overwritten (not a data fetch — FW-4).
  useEffect(() => {
    if (!value && classes && classes.length > 0) {
      onChange(classes[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot default on load
  }, [classes])

  return (
    <div className="space-y-1" data-testid="invite-field-classId">
      <Label htmlFor="invite-classId">{t('people.invite.fields.classId')}</Label>
      {classesQuery.isPending ? (
        <p className="text-xs text-slate-400">
          {t('people.invite.fields.classLoading')}
        </p>
      ) : classesQuery.isError ? (
        <p role="alert" className="text-xs text-[color:var(--cl-red)]">
          {t('people.invite.fields.classLoadError')}
        </p>
      ) : classes && classes.length === 0 ? (
        <p className="text-xs text-slate-400">
          {t('people.invite.fields.classEmpty')}
        </p>
      ) : (
        <select
          id="invite-classId"
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {classes?.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.name}
            </option>
          ))}
        </select>
      )}
      {error ? (
        <p role="alert" className="text-xs text-[color:var(--cl-red)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function buildInvitePayload(values: PeopleInviteFormValues): InviteStaffRequest {
  const name = values.name?.trim()
  const welcomeNote = values.welcomeNote?.trim()
  const payload: InviteStaffRequest = {
    email: values.email,
    role: values.role,
    name: name ? name : null,
    welcomeNote: welcomeNote ? welcomeNote : null,
  }
  // classId is sent ONLY for a teacher invite (D7 — the backend 422s a classId
  // on a non-teacher role).
  if (values.role === 'teacher' && values.classId) {
    payload.classId = values.classId
  }
  return payload
}
