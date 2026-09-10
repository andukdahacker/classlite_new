/**
 * EnrolmentComposer — Story 7.3b (s43 compose row, AC3–7). The Owner/Admin
 * workspace to add / transfer / withdraw a student between classes over the
 * STABLE 7-3a `POST /api/enrollments` action endpoint.
 *
 * Shape (D6/D8/D9/D10):
 *   - RHF + `zodResolver` over an `action`-discriminated schema
 *     (`useEnrolmentSchema`); Submit is disabled until the current action's
 *     rules validate and while the POST is in flight (no double-submit). Per
 *     field zod messages surface inline (`role="alert"`, code-review DN1) so a
 *     self-transfer / missing field explains why Submit is disabled.
 *   - Student field = a searchable combobox over `useStudentRoster` options.
 *     D9 prefers the cmdk `Command`; we use the shipped hand-rolled
 *     `role="listbox"` + text-filter idiom (the `AssignClassPanel` precedent,
 *     explicitly sanctioned as the D9 fallback) — deterministic under jsdom and
 *     a11y-clean (Escape + click-outside close, `aria-selected` reflects the
 *     chosen row; code-review P9). Client-side search over the first roster page
 *     (FU-7-3-B).
 *   - Action toggle = the shipped `aria-pressed` segmented-button idiom
 *     (`RoleChipGroup`/`AiChipGroup`, earmarked "for s44 enrollment") — a
 *     pragmatic read of D6's "ToggleGroup" that keeps selection caller-owned and
 *     the disabled/testid seams trivially assertable.
 *   - Target picker = classes filtered to the 7-3a enrollable set
 *     (`isEnrollableClass` = upcoming|active, code-review DN2 — mirrors the
 *     server `assertEnrollable`, so a paused/ended class is never offered). The
 *     source picker reads off the SELECTED student's roster item
 *     (`enrolledClasses` / `activeEnrollmentCount`, D8) — no extra fetch:
 *     0 active → Transfer/Withdraw disabled (only Add applies); exactly 1 →
 *     auto-selected read-only; >1 → a source-class picker.
 *   - `effectiveDate` = a raw `<input type="date">` (default today, `max` today,
 *     D10). Dates stay ISO on the wire (TS-6).
 *
 * On a 201/200 the mutation invalidates history + attention + roster + classes
 * (D7, in `useEnrolmentAction`), a success toast fires and the form resets. On a
 * mapped 7-3a error the form is KEPT (student stays selected) so the Admin can
 * correct it, and the error surfaces as an i18n toast (never a raw code, CQ-5).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useClasses } from '@/features/classes'
import type { ApiError } from '@/lib/api-fetch'
import { useStudentRoster, type StudentListItem } from '../api/useStudents'
import {
  useEnrolmentAction,
  type EnrollmentActionRequest,
} from '../api/useEnrolmentActions'
import { useStaffCenterId } from '../lib/useStaffSession'
import { isEnrollableClass } from '../lib/isEnrollableClass'
import {
  ENROLMENT_ACTIONS,
  todayIsoDate,
  useEnrolmentSchema,
  type EnrolmentActionValue,
  type EnrolmentFormValues,
} from '../lib/enrolmentSchema'

interface ClassOption {
  id: string
  name: string
}

export interface EnrolmentComposerProps {
  /** Student to prefill (from a needs-attention "Add" click, AC9). */
  prefillStudentId?: string | null
  /**
   * Bumped each time a prefill is requested so the SAME student can be
   * re-prefilled after a reset. The composer applies the prefill when this
   * changes.
   */
  prefillNonce?: number
}

function errorKey(error: ApiError): string {
  switch (error.code) {
    case 'CLASS_NOT_ENROLLABLE':
      return 'people.enrolment.error.classNotEnrollable'
    case 'NOT_ENROLLED_IN_SOURCE':
      return 'people.enrolment.error.notEnrolledInSource'
    case 'NOT_A_STUDENT_MEMBER':
      return 'people.enrolment.error.notAStudentMember'
    case 'VALIDATION_ERROR':
      return 'people.enrolment.error.validationError'
    case 'ALREADY_ENROLLED':
      return 'people.enrolment.error.alreadyEnrolled'
    case 'CLASS_NOT_FOUND':
      return 'people.enrolment.error.classNotFound'
    case 'INSUFFICIENT_ROLE':
      return 'people.enrolment.error.insufficientRole'
    default:
      return 'people.enrolment.error.generic'
  }
}

export function EnrolmentComposer({
  prefillStudentId,
  prefillNonce,
}: EnrolmentComposerProps = {}): ReactElement {
  const { t } = useTranslation()
  const [today] = useState(() => todayIsoDate())
  const schema = useEnrolmentSchema(today)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { isValid, errors },
  } = useForm<EnrolmentFormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      action: 'add',
      studentId: '',
      toClassId: '',
      fromClassId: '',
      effectiveDate: today,
      note: '',
    },
  })

  // `useWatch` (not `watch()`) — the shipped RHF convention; `watch` returns a
  // function React Compiler cannot memoize (react-hooks/incompatible-library).
  const action = useWatch({ control, name: 'action' })
  const studentId = useWatch({ control, name: 'studentId' })
  const toClassId = useWatch({ control, name: 'toClassId' })
  const fromClassId = useWatch({ control, name: 'fromClassId' })

  const rosterQuery = useStudentRoster({ page: 1 })
  const students = rosterQuery.data?.data ?? []
  const centerId = useStaffCenterId()
  const classesQuery = useClasses(centerId, 'all')
  const targetClasses: ClassOption[] = useMemo(
    () =>
      (classesQuery.data ?? [])
        .filter(isEnrollableClass)
        .map((cls) => ({ id: cls.id, name: cls.name })),
    [classesQuery.data],
  )

  const selectedStudent = students.find((s) => s.studentId === studentId)
  const sourceClasses: ClassOption[] = (selectedStudent?.enrolledClasses ?? []).map(
    (cls) => ({ id: cls.classId, name: cls.className }),
  )
  const isUnassigned =
    selectedStudent !== undefined &&
    ((selectedStudent.activeEnrollmentCount ?? 0) === 0 || sourceClasses.length === 0)

  const mutation = useEnrolmentAction()

  // Apply a needs-attention prefill (AC9): select the student + force Add. Keyed
  // on the nonce so a repeat prefill of the same student re-applies after reset.
  const [appliedNonce, setAppliedNonce] = useState<number | undefined>(undefined)
  if (
    prefillNonce !== undefined &&
    prefillNonce !== appliedNonce &&
    prefillStudentId
  ) {
    setAppliedNonce(prefillNonce)
    setValue('studentId', prefillStudentId, { shouldValidate: true })
    setValue('action', 'add', { shouldValidate: true })
    setValue('fromClassId', '', { shouldValidate: true })
  }

  // AC9/D11 — after a needs-attention prefill lands the student in Add mode,
  // move focus to the target-class picker (the next required field). A DOM
  // imperative focus is a permitted `useEffect` (FW-4); keyed on the applied
  // nonce so it fires once per prefill, not on every render.
  const targetSectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (appliedNonce === undefined) return
    const section = targetSectionRef.current
    if (!section) return
    section.scrollIntoView({ block: 'nearest' })
    const focusable = section.querySelector<HTMLElement>(
      '[role="option"], [role="listbox"]',
    )
    focusable?.focus()
  }, [appliedNonce])

  /** Resolve the source class for a (action, student) pair per D8. */
  function resolveSource(
    nextAction: EnrolmentActionValue,
    student: StudentListItem | undefined,
  ): void {
    const sources = student?.enrolledClasses ?? []
    if (
      (nextAction === 'transfer' || nextAction === 'withdraw') &&
      sources.length === 1
    ) {
      setValue('fromClassId', sources[0].classId, { shouldValidate: true })
    } else {
      setValue('fromClassId', '', { shouldValidate: true })
    }
  }

  function selectStudent(id: string): void {
    const student = students.find((s) => s.studentId === id)
    const unassigned =
      student !== undefined &&
      ((student.activeEnrollmentCount ?? 0) === 0 ||
        (student.enrolledClasses ?? []).length === 0)
    // An unassigned student can only be Added — snap the action back if a
    // Transfer/Withdraw was staged.
    const nextAction: EnrolmentActionValue =
      unassigned && action !== 'add' ? 'add' : action
    setValue('studentId', id, { shouldValidate: true })
    setValue('action', nextAction, { shouldValidate: true })
    resolveSource(nextAction, student)
  }

  function selectAction(next: EnrolmentActionValue): void {
    setValue('action', next, { shouldValidate: true })
    resolveSource(next, selectedStudent)
  }

  const onSubmit = handleSubmit((values) => {
    const body: EnrollmentActionRequest = {
      action: values.action,
      studentId: values.studentId,
      toClassId: values.action === 'withdraw' ? null : values.toClassId || null,
      fromClassId: values.action === 'add' ? null : values.fromClassId || null,
      effectiveDate: values.effectiveDate || null,
      note: values.note.trim() ? values.note.trim() : null,
      // The legacy `classId` alias is intentionally omitted (D3).
    }
    mutation.mutate(body, {
      onSuccess: () => {
        toast.success(t(`people.enrolment.compose.success.${values.action}`))
        reset({
          action: 'add',
          studentId: '',
          toClassId: '',
          fromClassId: '',
          effectiveDate: today,
          note: '',
        })
        setAppliedNonce(prefillNonce)
      },
      onError: (error) => {
        // Keep the form so the Admin can correct it (no reset).
        toast.error(t(errorKey(error)))
      },
    })
  })

  const showTarget = studentId !== '' && (action === 'add' || action === 'transfer')
  const showSource =
    studentId !== '' &&
    !isUnassigned &&
    (action === 'transfer' || action === 'withdraw')

  return (
    <section
      className="rounded-lg border border-slate-200 p-4"
      aria-label={t('people.enrolment.compose.title')}
      data-testid="enrolment-composer"
    >
      <h2 className="mb-3 text-sm font-medium text-slate-900">
        {t('people.enrolment.compose.title')}
      </h2>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <StudentCombobox
            students={students}
            loading={rosterQuery.isPending}
            selectedId={studentId}
            selectedName={selectedStudent?.name ?? null}
            invalid={errors.studentId !== undefined}
            onSelect={selectStudent}
          />
          <FieldError message={errors.studentId?.message} />
        </div>

        <div>
          <SegmentedActions
            action={action}
            disableSourceActions={isUnassigned}
            onSelect={selectAction}
          />
          {isUnassigned ? (
            <p
              className="mt-2 text-xs text-[color:var(--cl-muted)]"
              data-testid="enrolment-transfer-withdraw-disabled-hint"
            >
              {t('people.enrolment.compose.unassignedHint')}
            </p>
          ) : null}
        </div>

        {showSource ? (
          <div>
            {sourceClasses.length === 1 ? (
              <div>
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  {t('people.enrolment.compose.sourceLabel')}
                </span>
                <p
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-700"
                  data-testid="enrolment-source-class"
                >
                  {sourceClasses[0].name}
                </p>
              </div>
            ) : (
              <ClassListbox
                testId="enrolment-source-class-picker"
                label={t('people.enrolment.compose.sourceLabel')}
                ariaLabel={t('people.enrolment.compose.sourcePickerAria')}
                options={sourceClasses}
                selectedId={fromClassId}
                emptyLabel={t('people.enrolment.compose.noClasses')}
                onSelect={(id) =>
                  setValue('fromClassId', id, { shouldValidate: true })
                }
              />
            )}
            <FieldError message={errors.fromClassId?.message} />
          </div>
        ) : null}

        {showTarget ? (
          <div ref={targetSectionRef}>
            <ClassListbox
              testId="enrolment-target-class-picker"
              label={t('people.enrolment.compose.targetLabel')}
              ariaLabel={t('people.enrolment.compose.targetPickerAria')}
              options={targetClasses}
              selectedId={toClassId}
              loading={classesQuery.isPending}
              error={classesQuery.isError}
              loadingLabel={t('people.enrolment.compose.classesLoading')}
              emptyLabel={t('people.enrolment.compose.noClasses')}
              errorLabel={t('people.enrolment.compose.classesLoadError')}
              onSelect={(id) => setValue('toClassId', id, { shouldValidate: true })}
            />
            <FieldError message={errors.toClassId?.message} />
          </div>
        ) : null}

        <div>
          <label
            htmlFor="enrolment-effective-date"
            className="mb-1 block text-xs uppercase tracking-wide text-slate-400"
          >
            {t('people.enrolment.compose.effectiveDateLabel')}
          </label>
          <Input
            id="enrolment-effective-date"
            type="date"
            max={today}
            aria-invalid={errors.effectiveDate !== undefined || undefined}
            data-testid="enrolment-effective-date"
            {...register('effectiveDate')}
          />
          <FieldError message={errors.effectiveDate?.message} />
        </div>

        <div>
          <label
            htmlFor="enrolment-note"
            className="mb-1 block text-xs uppercase tracking-wide text-slate-400"
          >
            {t('people.enrolment.compose.noteLabel')}
          </label>
          <Textarea
            id="enrolment-note"
            rows={2}
            placeholder={t('people.enrolment.compose.notePlaceholder')}
            data-testid="enrolment-note"
            {...register('note')}
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            data-testid="enrolment-submit"
            disabled={!isValid || mutation.isPending}
          >
            {t(`people.enrolment.compose.submit.${action}`)}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** A field-level validation message (DN1) — `role="alert"` so it is announced. */
function FieldError({ message }: { message?: string }): ReactElement | null {
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-xs text-[color:var(--cl-red)]">
      {message}
    </p>
  )
}

/** Add / Transfer / Withdraw single-select (aria-pressed segmented buttons). */
function SegmentedActions({
  action,
  disableSourceActions,
  onSelect,
}: {
  action: EnrolmentActionValue
  disableSourceActions: boolean
  onSelect: (next: EnrolmentActionValue) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('people.enrolment.compose.actionAria')}
      className="flex flex-wrap gap-2"
    >
      {ENROLMENT_ACTIONS.map((value) => {
        const selected = action === value
        // Transfer + Withdraw need a source class; an unassigned student has none.
        const disabled = disableSourceActions && value !== 'add'
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            data-testid={`enrolment-action-${value}`}
            onClick={() => onSelect(value)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
              selected
                ? 'border-transparent bg-[color:var(--cl-accent)] text-white'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t(`people.enrolment.action.${value}`)}
          </button>
        )
      })}
    </div>
  )
}

/** Searchable student combobox (hand-rolled listbox — the D9 sanctioned fallback). */
function StudentCombobox({
  students,
  loading,
  selectedId,
  selectedName,
  invalid,
  onSelect,
}: {
  students: StudentListItem[]
  loading: boolean
  selectedId: string
  selectedName: string | null
  invalid: boolean
  onSelect: (studentId: string) => void
}): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on a click outside the combobox (P9) — a permitted DOM subscription
  // (FW-4) with cleanup; only wired while the popup is open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return students
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.email.toLowerCase().includes(needle),
    )
  }, [students, query])

  return (
    <div
      ref={containerRef}
      onKeyDown={(event) => {
        // Escape closes the popup (P9).
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
        {t('people.enrolment.compose.studentLabel')}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={t('people.enrolment.compose.studentLabel')}
        data-testid="enrolment-student-combobox"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
      >
        <span className={selectedName ? '' : 'text-slate-400'}>
          {selectedName ?? t('people.enrolment.compose.studentPlaceholder')}
        </span>
      </button>
      {open ? (
        <div className="mt-2 rounded-md border border-slate-200 p-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('people.enrolment.compose.studentSearchPlaceholder')}
            aria-label={t('people.enrolment.compose.studentSearchPlaceholder')}
            className="mb-2"
          />
          {loading ? (
            <p className="px-2 py-1 text-xs text-slate-400">
              {t('people.enrolment.compose.studentLoading')}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-400">
              {t('people.enrolment.compose.studentEmpty')}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-label={t('people.enrolment.compose.studentListAria')}
              className="flex max-h-60 flex-col gap-1 overflow-y-auto"
            >
              {filtered.map((student) => (
                <li key={student.studentId} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={student.studentId === selectedId}
                    onClick={() => {
                      onSelect(student.studentId)
                      setOpen(false)
                      setQuery('')
                    }}
                    className="w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <span className="block">{student.name}</span>
                    <span className="block text-xs text-slate-400">
                      {student.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Class picker listbox (the AssignClassPanel idiom — target + >1 source). */
function ClassListbox({
  testId,
  label,
  ariaLabel,
  options,
  selectedId,
  onSelect,
  loading,
  error,
  loadingLabel,
  emptyLabel,
  errorLabel,
}: {
  testId: string
  label: string
  ariaLabel: string
  options: ClassOption[]
  selectedId: string
  onSelect: (id: string) => void
  loading?: boolean
  error?: boolean
  loadingLabel?: string
  emptyLabel?: string
  errorLabel?: string
}): ReactElement {
  return (
    <div>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {loading ? (
        <p className="text-xs text-slate-400">{loadingLabel ?? emptyLabel}</p>
      ) : error ? (
        <p role="alert" className="text-xs text-[color:var(--cl-red)]">
          {errorLabel}
        </p>
      ) : options.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <div
          role="listbox"
          aria-label={ariaLabel}
          data-testid={testId}
          className="flex flex-col gap-1"
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
                className={`rounded px-2 py-1 text-left text-sm ${
                  selected
                    ? 'bg-[color:var(--cl-tint-blue)] text-[color:var(--cl-accent)]'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {option.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
