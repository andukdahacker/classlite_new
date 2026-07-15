/**
 * TermCalendarTab — Story 2-5b AC1.
 *
 * Terms + Holidays sections stacked in one tab body. Uniform Edit button on
 * every row per Sally-S6 REJECTED. State pill derives client-side from
 * startDate/endDate vs Date.now(). Loading / Empty / Error trilogy per UX-1.
 * CRUD via shipped shadcn <Dialog>; delete via <AlertDialog>. RHF + Zod
 * form; server errors surface as inline <Alert> inside the dialog with
 * retry — no toast for validation failures.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_HOLIDAY_FORM_VALUES,
  DEFAULT_TERM_FORM_VALUES,
  holidaySchema,
  termSchema,
  type HolidayFormValues,
  type TermFormValues,
} from './lib/schemas'
import {
  useHolidays,
  useMutateHoliday,
  type Holiday,
} from './api/useHolidays'
import { useMutateTerm, useTerms, type Term } from './api/useTerms'

interface Props {
  centerId: string
}

type TermState = 'past' | 'current' | 'upcoming'

// parseIsoDateLocal turns a "YYYY-MM-DD" wire string into a Date pinned to
// LOCAL midnight — the correct anchor for a date-only field. Amended
// /bmad-code-review 2-5b Round 1 P7 (2026-07-15) — the previous
// `new Date(iso)` parsed date-only strings as UTC midnight per the JS spec,
// which flipped Term pill state ~7h early in Asia/Ho_Chi_Minh (UTC+7) and
// showed the last day of a term as "past" from its start-of-day UTC onward.
function parseIsoDateLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// formatDateSingle / formatDateRange localize date-only wire strings via
// Intl.DateTimeFormat pinned to LOCAL midnight (see parseIsoDateLocal).
// Added /bmad-code-review 2-5b Round 1 P11 (2026-07-15) — replaces raw
// "YYYY-MM-DD" interpolation that regressed the 2-5a `{{val, datetime}}`
// pattern. Falls back to the wire string if the date is unparseable.
function formatDateSingle(iso: string, locale: string): string {
  const d = parseIsoDateLocal(iso)
  if (!d) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function formatDateRange(start: string, end: string, locale: string): string {
  const s = parseIsoDateLocal(start)
  const e = parseIsoDateLocal(end)
  if (!s || !e) return `${start} — ${end}`
  const fmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${fmt.format(s)} — ${fmt.format(e)}`
}

function deriveTermState(t: Term): TermState {
  const now = new Date()
  const start = parseIsoDateLocal(t.startDate)
  const end = parseIsoDateLocal(t.endDate)
  if (!start || !end) return 'current'
  // The end-day is inclusive: the term is "current" through 23:59:59 of the
  // endDate in local time, and flips to "past" at the start of endDate + 1.
  // Amended Round 1 P7 (2026-07-15) — previously `now > end` treated the
  // whole endDate as already-past.
  const endExclusive = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1,
  )
  if (now < start) return 'upcoming'
  if (now >= endExclusive) return 'past'
  return 'current'
}

export function TermCalendarTab({ centerId }: Props): ReactElement {
  const termsQuery = useTerms(centerId)
  const holidaysQuery = useHolidays(centerId)

  const [termDialogState, setTermDialogState] = useState<
    { open: false } | { open: true; term: Term | null }
  >({ open: false })
  const [termToDelete, setTermToDelete] = useState<Term | null>(null)
  const [holidayDialogState, setHolidayDialogState] = useState<
    { open: false } | { open: true; holiday: Holiday | null }
  >({ open: false })
  const [holidayToDelete, setHolidayToDelete] = useState<Holiday | null>(null)

  return (
    <div
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="settings-tab-terms"
      id="settings-tabpanel-terms"
      data-testid="settings-tabpanel-terms"
      className="space-y-8"
    >
      <TermsSection
        query={termsQuery}
        onAdd={() => setTermDialogState({ open: true, term: null })}
        onEdit={(term) => setTermDialogState({ open: true, term })}
        onDelete={(term) => setTermToDelete(term)}
      />
      <HolidaysSection
        query={holidaysQuery}
        onAdd={() => setHolidayDialogState({ open: true, holiday: null })}
        onEdit={(holiday) =>
          setHolidayDialogState({ open: true, holiday })
        }
        onDelete={(holiday) => setHolidayToDelete(holiday)}
      />

      {termDialogState.open ? (
        <TermFormDialog
          centerId={centerId}
          initial={termDialogState.term}
          onClose={() => setTermDialogState({ open: false })}
        />
      ) : null}
      {termToDelete ? (
        <TermDeleteDialog
          centerId={centerId}
          term={termToDelete}
          onClose={() => setTermToDelete(null)}
        />
      ) : null}
      {holidayDialogState.open ? (
        <HolidayFormDialog
          centerId={centerId}
          initial={holidayDialogState.holiday}
          onClose={() => setHolidayDialogState({ open: false })}
        />
      ) : null}
      {holidayToDelete ? (
        <HolidayDeleteDialog
          centerId={centerId}
          holiday={holidayToDelete}
          onClose={() => setHolidayToDelete(null)}
        />
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Terms section
// -----------------------------------------------------------------------------

interface TermsSectionProps {
  query: ReturnType<typeof useTerms>
  onAdd: () => void
  onEdit: (term: Term) => void
  onDelete: (term: Term) => void
}

function TermsSection({
  query,
  onAdd,
  onEdit,
  onDelete,
}: TermsSectionProps): ReactElement {
  const { t } = useTranslation()

  return (
    <section
      data-testid="term-calendar-section-terms"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('settings.terms.sectionHeading')}
        </h2>
        <Button size="sm" onClick={onAdd}>
          {t('settings.terms.addCta')}
        </Button>
      </div>
      {query.isPending ? (
        <SkeletonList prefix="term-row-skeleton" />
      ) : query.isError ? (
        <ErrorAlert onRetry={() => query.refetch()} />
      ) : query.data && query.data.length === 0 ? (
        <EmptyState
          headline={t('settings.terms.empty.headline')}
          body={t('settings.terms.empty.body')}
          cta={t('settings.terms.empty.cta')}
          onCta={onAdd}
        />
      ) : (
        <ol className="divide-y divide-slate-100">
          {query.data?.map((term) => (
            <TermRow
              key={term.id}
              term={term}
              onEdit={() => onEdit(term)}
              onDelete={() => onDelete(term)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

interface TermRowProps {
  term: Term
  onEdit: () => void
  onDelete: () => void
}

function TermRow({ term, onEdit, onDelete }: TermRowProps): ReactElement {
  const { t, i18n } = useTranslation()
  const state = deriveTermState(term)
  const dateRange = formatDateRange(term.startDate, term.endDate, i18n.language)
  return (
    <li
      data-testid={`term-row-${term.id}`}
      className="flex items-center justify-between py-3"
    >
      <div className="flex-1">
        <p className="font-medium text-slate-900">{term.name}</p>
        <p className="text-sm text-slate-500">{dateRange}</p>
      </div>
      <span
        data-testid="term-state-pill"
        data-state={state}
        className={pillClassForState(state)}
      >
        {t(`settings.terms.state.${state}` as const)}
      </span>
      <div className="ml-4 flex gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          {t('settings.terms.row.editCta')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t('settings.terms.row.deleteCta')}
        </Button>
      </div>
    </li>
  )
}

function pillClassForState(state: TermState): string {
  const base = 'rounded-full px-2 py-0.5 text-xs font-medium'
  switch (state) {
    case 'current':
      return `${base} bg-green-100 text-green-800`
    case 'upcoming':
      return `${base} bg-blue-100 text-blue-800`
    case 'past':
      return `${base} bg-slate-100 text-slate-600`
  }
}

// -----------------------------------------------------------------------------
// Holidays section
// -----------------------------------------------------------------------------

interface HolidaysSectionProps {
  query: ReturnType<typeof useHolidays>
  onAdd: () => void
  onEdit: (h: Holiday) => void
  onDelete: (h: Holiday) => void
}

function HolidaysSection({
  query,
  onAdd,
  onEdit,
  onDelete,
}: HolidaysSectionProps): ReactElement {
  const { t, i18n } = useTranslation()

  return (
    <section
      data-testid="term-calendar-section-holidays"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('settings.holidays.sectionHeading')}
        </h2>
        <Button size="sm" onClick={onAdd}>
          {t('settings.holidays.addCta')}
        </Button>
      </div>
      {query.isPending ? (
        <SkeletonList prefix="holiday-row-skeleton" />
      ) : query.isError ? (
        <ErrorAlert onRetry={() => query.refetch()} />
      ) : query.data && query.data.length === 0 ? (
        <EmptyState
          headline={t('settings.holidays.empty.headline')}
          body={t('settings.holidays.empty.body')}
        />
      ) : (
        <ol className="divide-y divide-slate-100">
          {query.data?.map((h) => (
            <li
              key={h.id}
              data-testid={`holiday-row-${h.id}`}
              className="flex items-center justify-between py-3"
            >
              <div className="flex-1">
                <p className="font-medium text-slate-900">{h.name}</p>
                <p className="text-sm text-slate-500">
                  {formatDateSingle(h.date, i18n.language)}
                </p>
              </div>
              <div className="ml-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(h)}>
                  {t('settings.holidays.row.editCta')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(h)}>
                  {t('settings.holidays.row.deleteCta')}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------
// Term create/edit dialog
// -----------------------------------------------------------------------------

interface TermFormDialogProps {
  centerId: string
  initial: Term | null
  onClose: () => void
}

function TermFormDialog({
  centerId,
  initial,
  onClose,
}: TermFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateTerm(centerId)
  const [saveError, setSaveError] = useState<SaveDialogError | null>(null)
  const defaultValues: TermFormValues = initial
    ? {
        name: initial.name,
        startDate: initial.startDate,
        endDate: initial.endDate,
        sessionCount: initial.sessionCount,
      }
    : DEFAULT_TERM_FORM_VALUES
  const form = useForm<TermFormValues>({
    resolver: zodResolver(termSchema),
    defaultValues,
  })

  const onSubmit: SubmitHandler<TermFormValues> = (values) => {
    setSaveError(null)
    const body = {
      name: values.name,
      startDate: values.startDate,
      endDate: values.endDate,
      sessionCount: values.sessionCount ?? null,
    }
    const input =
      initial === null
        ? ({ kind: 'create', body } as const)
        : ({ kind: 'update', id: initial.id, body } as const)
    mutate.mutate(input, {
      onSuccess: () => {
        toast.success(t('settings.terms.saveSuccessToast'))
        onClose()
      },
      onError: (err) => {
        setSaveError(classifySaveError(err))
      },
    })
  }

  const retry = form.handleSubmit(onSubmit)

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial === null
              ? t('settings.terms.form.dialogTitleCreate')
              : t('settings.terms.form.dialogTitleEdit')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {saveError ? (
            <SaveErrorAlert
              error={saveError}
              onRetry={() => {
                setSaveError(null)
                void retry()
              }}
              testId="term-save-error"
            />
          ) : null}
          <FormField
            id="term-name"
            label={t('settings.terms.form.name.label')}
            error={form.formState.errors.name?.message}
          >
            <Input
              id="term-name"
              placeholder={t('settings.terms.form.name.placeholder')}
              {...form.register('name')}
            />
          </FormField>
          <FormField
            id="term-start"
            label={t('settings.terms.form.startDate.label')}
            error={form.formState.errors.startDate?.message}
          >
            <Input id="term-start" type="date" {...form.register('startDate')} />
          </FormField>
          <FormField
            id="term-end"
            label={t('settings.terms.form.endDate.label')}
            error={form.formState.errors.endDate?.message}
          >
            <Input id="term-end" type="date" {...form.register('endDate')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('settings.terms.form.cancelCta')}
            </Button>
            <Button type="submit" disabled={mutate.isPending}>
              {t('settings.terms.form.saveCta')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface TermDeleteDialogProps {
  centerId: string
  term: Term
  onClose: () => void
}

function TermDeleteDialog({
  centerId,
  term,
  onClose,
}: TermDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateTerm(centerId)
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('settings.terms.delete.confirmHeadline')}
          </AlertDialogTitle>
          <AlertDialogDescription>{term.name}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t('settings.terms.delete.cancelCta')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              mutate.mutate(
                { kind: 'delete', id: term.id },
                {
                  onSuccess: () => {
                    toast.success(t('settings.terms.deleteSuccessToast'))
                    onClose()
                  },
                  onError: () => {
                    // Delete failures surface as a toast — the AlertDialog
                    // has no body slot for an inline Alert. Round 1 P1 fix.
                    toast.error(t('settings.error.generic'))
                  },
                },
              )
            }}
          >
            {t('settings.terms.delete.confirmCta')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// -----------------------------------------------------------------------------
// Holiday create/edit + delete dialogs — same shape as Term.
// -----------------------------------------------------------------------------

interface HolidayFormDialogProps {
  centerId: string
  initial: Holiday | null
  onClose: () => void
}

function HolidayFormDialog({
  centerId,
  initial,
  onClose,
}: HolidayFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateHoliday(centerId)
  const [saveError, setSaveError] = useState<SaveDialogError | null>(null)
  const defaultValues: HolidayFormValues = initial
    ? { name: initial.name, date: initial.date }
    : DEFAULT_HOLIDAY_FORM_VALUES
  const form = useForm<HolidayFormValues>({
    resolver: zodResolver(holidaySchema),
    defaultValues,
  })
  const onSubmit: SubmitHandler<HolidayFormValues> = (values) => {
    setSaveError(null)
    const input =
      initial === null
        ? ({ kind: 'create', body: values } as const)
        : ({ kind: 'update', id: initial.id, body: values } as const)
    mutate.mutate(input, {
      onSuccess: () => {
        toast.success(t('settings.holidays.saveSuccessToast'))
        onClose()
      },
      onError: (err) => {
        setSaveError(classifySaveError(err))
      },
    })
  }
  const retry = form.handleSubmit(onSubmit)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial === null
              ? t('settings.holidays.form.dialogTitleCreate')
              : t('settings.holidays.form.dialogTitleEdit')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {saveError ? (
            <SaveErrorAlert
              error={saveError}
              onRetry={() => {
                setSaveError(null)
                void retry()
              }}
              testId="holiday-save-error"
            />
          ) : null}
          <FormField
            id="holiday-name"
            label={t('settings.holidays.form.name.label')}
            error={form.formState.errors.name?.message}
          >
            <Input id="holiday-name" {...form.register('name')} />
          </FormField>
          <FormField
            id="holiday-date"
            label={t('settings.holidays.form.date.label')}
            error={form.formState.errors.date?.message}
          >
            <Input id="holiday-date" type="date" {...form.register('date')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('settings.terms.form.cancelCta')}
            </Button>
            <Button type="submit" disabled={mutate.isPending}>
              {t('settings.holidays.form.saveCta')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface HolidayDeleteDialogProps {
  centerId: string
  holiday: Holiday
  onClose: () => void
}

function HolidayDeleteDialog({
  centerId,
  holiday,
  onClose,
}: HolidayDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateHoliday(centerId)
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('settings.holidays.delete.confirmHeadline')}
          </AlertDialogTitle>
          <AlertDialogDescription>{holiday.name}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t('settings.terms.delete.cancelCta')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              mutate.mutate(
                { kind: 'delete', id: holiday.id },
                {
                  onSuccess: onClose,
                  onError: () => {
                    toast.error(t('settings.error.generic'))
                  },
                },
              )
            }}
          >
            {t('settings.holidays.delete.confirmCta')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// -----------------------------------------------------------------------------
// Shared sub-components
// -----------------------------------------------------------------------------

function SkeletonList({ prefix }: { prefix: string }): ReactElement {
  return (
    <ul className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          data-testid={`${prefix}-${i}`}
          className="h-12 animate-pulse rounded-md bg-slate-100"
        />
      ))}
    </ul>
  )
}

interface EmptyStateProps {
  headline: string
  body: string
  cta?: string
  onCta?: () => void
}

function EmptyState({
  headline,
  body,
  cta,
  onCta,
}: EmptyStateProps): ReactElement {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="text-sm font-medium text-slate-900">{headline}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
      {cta && onCta ? (
        <Button className="mt-4" onClick={onCta}>
          {cta}
        </Button>
      ) : null}
    </div>
  )
}

interface ErrorAlertProps {
  onRetry: () => void
}

function ErrorAlert({ onRetry }: ErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
    >
      <p>{t('settings.error.fetch')}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        {t('settings.error.tryAgain')}
      </Button>
    </div>
  )
}

interface FormFieldProps {
  id: string
  label: string
  error?: string | undefined
  children: ReactElement
}

function FormField({ id, label, error, children }: FormFieldProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Save-failure alert — added /bmad-code-review 2-5b Round 1 P1 (2026-07-15).
//
// Previously the Create/Update mutations only handled onSuccess, so any
// server error (500, 422 not client-caught, 429 without-Retry, etc.) closed
// the dialog silently and left the user with no feedback. This alert renders
// inside the Dialog body so the user retains form context on retry, matches
// UX-1 (Error state + retry action), and reuses the shipped
// `settings.error.*` catalog from 2-5a for i18n discipline.
// -----------------------------------------------------------------------------

type SaveDialogError =
  | { kind: 'validation' }
  | { kind: 'forbidden' }
  | { kind: 'auth' }
  | { kind: 'rateLimit'; retryAfter?: number }
  | { kind: 'generic'; requestId?: string }

function classifySaveError(err: unknown): SaveDialogError {
  const anyErr = err as {
    status?: number
    requestId?: string
    retryAfter?: number
    code?: string
  }
  const status = anyErr?.status
  if (status === 401) return { kind: 'auth' }
  if (status === 403) return { kind: 'forbidden' }
  if (status === 422) return { kind: 'validation' }
  if (status === 429) {
    return anyErr.retryAfter !== undefined
      ? { kind: 'rateLimit', retryAfter: anyErr.retryAfter }
      : { kind: 'rateLimit' }
  }
  return anyErr?.requestId !== undefined
    ? { kind: 'generic', requestId: anyErr.requestId }
    : { kind: 'generic' }
}

interface SaveErrorAlertProps {
  error: SaveDialogError
  onRetry: () => void
  testId?: string
}

function SaveErrorAlert({ error, onRetry, testId }: SaveErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  let message: string
  switch (error.kind) {
    case 'validation':
      message = t('settings.error.validation')
      break
    case 'forbidden':
      message = t('settings.error.forbidden')
      break
    case 'auth':
      message = t('settings.error.auth')
      break
    case 'rateLimit':
      message =
        error.retryAfter !== undefined
          ? t('settings.error.rateLimitWithRetry', { seconds: error.retryAfter })
          : t('settings.error.rateLimit')
      break
    case 'generic':
      message =
        error.requestId !== undefined
          ? t('settings.error.genericWithRequestId', { requestId: error.requestId })
          : t('settings.error.generic')
      break
  }
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
    >
      <p>{message}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={onRetry}
      >
        {t('settings.error.tryAgain')}
      </Button>
    </div>
  )
}
