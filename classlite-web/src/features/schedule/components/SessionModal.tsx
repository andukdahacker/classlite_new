/**
 * SessionModal — Story 3.4 (AC8). Shared <Dialog> + RHF + zodResolver for
 * create AND edit of a session. Modal trilogy: the class <select> shows a
 * skeleton while classes load; zero classes → an empty state ("Create a class
 * first" + link), not a dead-end picker; a failed submit surfaces a human error
 * + retry and PRESERVES the form input. Editing a recurring session shows the
 * RecurrenceScopeConfirm (safe default). Recurrence controls reserve space with
 * a sticky footer so Save never reflows out from under the user.
 *
 * Pragmatic deviation (documented): the date field is a native <input
 * type="date"> (accessible + testable) rather than a popover shadcn calendar —
 * the shadcn calendar is used for the mini-month navigator. Behaviour + a11y
 * are equivalent.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ClassWire } from '@/features/classes/api/useClasses'
import { appZoneParts, appZoneWallClockToIso } from '../lib/scheduleDates'
import { useSessionSchema, RECURRENCE_PATTERNS, type SessionFormValues } from '../lib/useSessionSchema'
import { useCreateSession, useUpdateSession, useCancelSession, useDeleteSession } from '../api/useSessionMutations'
import { useSession, type SessionWire, type ApplyScope } from '../api/useSessions'
import { RecurrenceScopeConfirm } from './RecurrenceScopeConfirm'

const WEEKDAY_INDEXES = [1, 2, 3, 4, 5, 6, 0] as const // Mon…Sun
const DEFAULT_DURATION = 90

interface SessionModalProps {
  open: boolean
  onClose: () => void
  classes: ClassWire[]
  classesLoading: boolean
  /** The classes query failed — render an error state, not the empty state. */
  classesError?: boolean
  /** Prefill for create (focused day/slot); null for a blank create. */
  prefill?: { date: string; startTime: string } | null
  /** Existing session for edit; null for create. */
  initial?: SessionWire | null
  locale: string
}

// Prefill the date/time inputs from the session's app-zone (center) wall clock,
// so an edit shows the same time the grid prints regardless of browser zone (FD1).
function toDateInput(iso: string): string {
  const p = appZoneParts(iso)
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
function toTimeInput(iso: string): string {
  const p = appZoneParts(iso)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function SessionModal({
  open,
  onClose,
  classes,
  classesLoading,
  classesError = false,
  prefill = null,
  initial = null,
  locale,
}: SessionModalProps): ReactElement {
  const { t } = useTranslation()
  const isEdit = initial !== null
  const schema = useSessionSchema()
  const createSession = useCreateSession()
  const updateSession = useUpdateSession()
  const cancelSession = useCancelSession()
  const deleteSession = useDeleteSession()
  const detail = useSession(isEdit ? initial?.id : null)

  const [serverError, setServerError] = useState<string | null>(null)
  const [scope, setScope] = useState<ApplyScope>('this')

  const defaults = useMemo<SessionFormValues>(() => {
    if (initial) {
      return {
        classId: initial.classId,
        topic: initial.topic ?? '',
        date: toDateInput(initial.startsAt),
        startTime: toTimeInput(initial.startsAt),
        durationMinutes: Math.max(
          1,
          Math.round((new Date(initial.endsAt).getTime() - new Date(initial.startsAt).getTime()) / 60000),
        ),
        pattern: 'none',
        weekdays: [],
        endDate: '',
      }
    }
    return {
      classId: classes[0]?.id ?? '',
      topic: '',
      date: prefill?.date ?? '',
      startTime: prefill?.startTime ?? '09:00',
      durationMinutes: DEFAULT_DURATION,
      pattern: 'none',
      weekdays: [],
      endDate: '',
    }
  }, [initial, prefill, classes])

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({ resolver: zodResolver(schema), defaultValues: defaults })

  // useForm reads defaultValues once at mount; when the modal opens before
  // classes load (or a different session is edited), sync RHF to the recomputed
  // defaults so classId isn't stuck at '' behind a visibly-selected option (FP3).
  // Library-state sync, not a data fetch — permitted by FW-4.
  useEffect(() => {
    reset(defaults)
  }, [defaults, reset])

  // Prefer the freshly-fetched detail's updatedAt over the (possibly stale) list
  // row so a mutation doesn't trip a spurious SESSION_CONFLICT (FP12).
  const expectedUpdatedAt = detail.data?.session.updatedAt ?? initial?.updatedAt ?? ''

  const pattern = useWatch({ control, name: 'pattern' })
  const weekdays = useWatch({ control, name: 'weekdays' })
  const isRecurringEdit = isEdit && initial?.recurrenceGroupId != null
  const showWeekdays = pattern === 'weekly' || pattern === 'custom'
  const showEndDate = pattern !== 'none'

  const mapError = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'RECURRENCE_LIMIT_EXCEEDED') return t('schedule.modal.error.recurrenceLimit')
      if (err.code === 'SESSION_CONFLICT') return t('schedule.modal.error.conflict')
      if (err.code === 'SCHEDULE_RANGE_TOO_WIDE') return t('schedule.modal.error.rangeTooWide')
      if (err.status === 422) return t('schedule.modal.error.validation')
    }
    return t('schedule.modal.error.generic')
  }

  const buildStartsAtIso = (values: SessionFormValues): string =>
    // Interpret the form's wall-clock in the fixed app zone (+07:00, no DST), so
    // "09:00" always authors 09:00 center time whatever the browser zone (FD1).
    appZoneWallClockToIso(values.date, values.startTime)

  const onSubmit: SubmitHandler<SessionFormValues> = async (values) => {
    setServerError(null)
    try {
      if (isEdit && initial) {
        await updateSession.mutateAsync({
          id: initial.id,
          body: {
            topic: values.topic?.trim() ? values.topic : null,
            startsAt: buildStartsAtIso(values),
            durationMinutes: values.durationMinutes,
            classId: values.classId,
            applyScope: isRecurringEdit ? scope : 'this',
            expectedUpdatedAt,
          },
        })
      } else {
        await createSession.mutateAsync({
          classId: values.classId,
          topic: values.topic?.trim() ? values.topic : null,
          startsAt: buildStartsAtIso(values),
          durationMinutes: values.durationMinutes,
          recurrence: {
            // weekdays is optional-not-nullable in the schema; omit when the
            // pattern doesn't use it (the wire has no null variant).
            weekdays: showWeekdays ? values.weekdays : undefined,
            pattern: values.pattern,
            endDate: showEndDate ? values.endDate || null : null,
          },
        })
      }
      onClose()
    } catch (err) {
      setServerError(mapError(err)) // input preserved — form state untouched
    }
  }

  const onCancelSeries = async () => {
    if (!initial) return
    setServerError(null)
    try {
      await cancelSession.mutateAsync({
        id: initial.id,
        body: { applyScope: isRecurringEdit ? scope : 'this', expectedUpdatedAt },
      })
      onClose()
    } catch (err) {
      setServerError(mapError(err))
    }
  }

  const onDeleteSeries = async () => {
    if (!initial) return
    setServerError(null)
    try {
      await deleteSession.mutateAsync({
        id: initial.id,
        scope: isRecurringEdit ? scope : 'this',
        expectedUpdatedAt,
      })
      onClose()
    } catch (err) {
      setServerError(mapError(err))
    }
  }

  const toggleWeekday = (day: number) => {
    const set = new Set(weekdays)
    if (set.has(day)) set.delete(day)
    else set.add(day)
    setValue('weekdays', Array.from(set).sort((a, b) => a - b), { shouldValidate: true })
  }

  const zeroClasses = !classesLoading && classes.length === 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="session-modal" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('schedule.modal.editTitle') : t('schedule.modal.createTitle')}</DialogTitle>
          <DialogDescription>{t('schedule.modal.subtitle')}</DialogDescription>
        </DialogHeader>

        {classesError ? (
          <div data-testid="session-modal-classes-error" role="alert" className="py-8 text-center text-sm text-red-700">
            {t('schedule.modal.classesError')}
          </div>
        ) : zeroClasses ? (
          <div data-testid="session-modal-no-classes" className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-slate-600">{t('schedule.modal.noClasses.body')}</p>
            <Link to="/classes" className={buttonVariants()}>
              {t('schedule.modal.noClasses.cta')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {serverError && (
              <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {serverError}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="session-class">{t('schedule.modal.field.class')}</Label>
              {classesLoading ? (
                <Skeleton data-testid="session-class-skeleton" className="h-9 w-full" />
              ) : (
                <select
                  id="session-class"
                  className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                  {...register('classId')}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {errors.classId && <p className="text-xs text-red-600">{errors.classId.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="session-date">{t('schedule.modal.field.date')}</Label>
                <Input id="session-date" type="date" {...register('date')} />
                {errors.date && <p className="text-xs text-red-600">{errors.date.message}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="session-time">{t('schedule.modal.field.startTime')}</Label>
                <Input id="session-time" type="time" {...register('startTime')} />
                {errors.startTime && <p className="text-xs text-red-600">{errors.startTime.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="session-duration">{t('schedule.modal.field.duration')}</Label>
                <Input
                  id="session-duration"
                  type="number"
                  min={1}
                  {...register('durationMinutes', { valueAsNumber: true })}
                />
                {errors.durationMinutes && <p className="text-xs text-red-600">{errors.durationMinutes.message}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="session-topic">{t('schedule.modal.field.topic')}</Label>
                <Input id="session-topic" type="text" {...register('topic')} />
              </div>
            </div>

            {/* Recurrence controls only on create (pattern-edit is out of scope). */}
            {!isEdit && (
              <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="session-pattern">{t('schedule.modal.field.recurrence')}</Label>
                  <select
                    id="session-pattern"
                    className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                    {...register('pattern')}
                  >
                    {RECURRENCE_PATTERNS.map((p) => (
                      <option key={p} value={p}>
                        {t(`schedule.modal.pattern.${p}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Reserve space so Save never reflows: weekday + endDate area. */}
                <div className={showWeekdays ? '' : 'invisible'} aria-hidden={!showWeekdays}>
                  <span className="text-xs font-medium text-slate-600">{t('schedule.modal.field.weekdays')}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {WEEKDAY_INDEXES.map((day) => (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={weekdays.includes(day)}
                        onClick={() => toggleWeekday(day)}
                        className={`rounded px-2 py-1 text-xs ${
                          weekdays.includes(day) ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {t(`schedule.weekdayShort.${day}`)}
                      </button>
                    ))}
                  </div>
                  {errors.weekdays && <p className="text-xs text-red-600">{errors.weekdays.message}</p>}
                </div>
                <div className={showEndDate ? '' : 'invisible'} aria-hidden={!showEndDate}>
                  <Label htmlFor="session-enddate">{t('schedule.modal.field.endDate')}</Label>
                  <Input id="session-enddate" type="date" {...register('endDate')} />
                  {errors.endDate && <p className="text-xs text-red-600">{errors.endDate.message}</p>}
                </div>
              </div>
            )}

            {isRecurringEdit && (
              <RecurrenceScopeConfirm
                value={scope}
                onChange={setScope}
                targetStartsAt={initial?.startsAt ?? ''}
                upcoming={detail.isSuccess ? detail.data.series.upcoming : null}
                locale={locale}
              />
            )}

            <DialogFooter className="sticky bottom-0 flex-col gap-2 bg-white pt-2 sm:flex-row sm:justify-between">
              {isEdit && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onCancelSeries}>
                    {t('schedule.modal.cancelSession')}
                  </Button>
                  <Button type="button" variant="destructive" onClick={onDeleteSeries}>
                    {t('schedule.modal.deleteSession')}
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t('schedule.modal.close')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {t('schedule.modal.save')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
