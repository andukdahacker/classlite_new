/**
 * ClassFormDialog — Story 3.1 (AC2/AC8). Create/edit a class in a <Dialog>
 * (RoomsTab precedent) with RHF + zodResolver(useClassSchema()).
 *
 * Create mode surfaces a template picker (reused useListTemplates): selecting a
 * template PREFILLS the scalar fields (name suggestion, targetBand,
 * primarySkill, sessionCount, color), EACH behind an include/exclude Switch.
 * An EXCLUDED field is cleared and thus OMITTED from CreateClassRequest (key
 * absent → the column takes NULL/DB-default; the template value is never copied
 * server-side — AC2 wire contract). The template's session plan renders as a
 * read-only summary (`sessionCount`); the full per-session titled list needs a
 * template-detail endpoint that does not exist yet — deferred (FU-3-1-A).
 *
 * Edit mode hides the template toggle wall and shows the due-dates Switch (AC3
 * enabling is an explicit PATCH). Teacher assignment uses a pending-email input
 * (full AssignChip/AssignTeacherComposer reuse deferred — FU-3-1-B).
 */
import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { reportBillingError, useBillingSummary, planDisplayName } from '@/features/billing'
import { useRole } from '@/hooks/useRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { InlineFieldError } from '@/components/domain/InlineFieldError'
import { FormValidationBanner } from '@/components/domain/FormValidationBanner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useListTemplates, type Template } from '@/features/onboarding'
import { useClassSchema, type ClassFormValues } from '../lib/classSchema'
import { useCreateClass, type CreateClassRequest } from '../api/useCreateClass'
import { useUpdateClass, type UpdateClassRequest } from '../api/useUpdateClass'
import { useTemplate } from '../api/useTemplate'
import type { ClassWire } from '../api/useClasses'

const PREFILL_FIELDS = ['targetBand', 'primarySkill', 'sessionCount', 'color'] as const
type PrefillField = (typeof PREFILL_FIELDS)[number]

/** Owner-only Upgrade destination for the over-plan capacity nudge (Story 10.4 AC6). */
const PLANS_PATH = '/settings/billing/plans'

/**
 * Server 422 field names that map 1:1 to an RHF form field (Story 10.4 AC6). A
 * server field outside this set is ignored by the inline mapper and falls through
 * to the generic inline error, so a stray/unknown field can never silently vanish.
 */
const FIELD_ERROR_TARGETS: Record<string, true> = {
  name: true,
  description: true,
  capacity: true,
  startDate: true,
  endDate: true,
  targetBand: true,
  sessionCount: true,
  pendingTeacherEmail: true,
}

interface ClassFormDialogProps {
  centerId: string
  initial: ClassWire | null
  onClose: () => void
  /**
   * Story 3.3 — preselect a template in create mode (the s20 "Use this
   * template" affordance routes here with the id). Ignored in edit mode.
   */
  initialTemplateId?: string | null
  /**
   * Story 10.4 (AC6) — the already-loaded class names, for the client-side
   * name-conflict check (there is no distinct server name-conflict code). In edit
   * mode the class keeping its own name does not conflict (its own name is excluded).
   */
  existingNames?: readonly string[]
}

export function ClassFormDialog({
  centerId,
  initial,
  onClose,
  initialTemplateId = null,
  existingNames = [],
}: ClassFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const isEdit = initial !== null
  // Story 10.4 AC6 — owner-only client capacity cap. `limits.studentsPerClass`
  // lives ONLY on the owner-only GET /api/billing; a teacher cannot fetch it, so
  // the inline capacity check + Upgrade link is owner-gated (teacher over-cap
  // defers to the 9.2-armed server 409 → PlanLimitExceededDialog, FU-10-4-CAPACITY-TEACHER).
  const isOwner = useRole() === 'owner'
  const billingSummary = useBillingSummary(isOwner)
  const perClassCap = billingSummary.data?.limits.studentsPerClass ?? null
  const planName = billingSummary.data ? planDisplayName(billingSummary.data.plan) : ''
  const schema = useClassSchema()
  const templatesQuery = useListTemplates()
  const createClass = useCreateClass(centerId)
  const updateClass = useUpdateClass()

  const [included, setIncluded] = useState<Record<PrefillField, boolean>>({
    targetBand: true,
    primarySkill: true,
    sessionCount: true,
    color: true,
  })
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ClassFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialFormValues(initial),
  })

  const selectedTemplateId = useWatch({ control, name: 'templateId' })
  const dueDatesEnabled = useWatch({ control, name: 'dueDatesEnabled' })
  const capacityValue = useWatch({ control, name: 'capacity' })

  // Owner-only: entered capacity exceeds the plan's per-class cap (AC6). Live off
  // the watched value so the Upgrade nudge appears as the owner types.
  const capacityOverPlan =
    isOwner &&
    perClassCap != null &&
    typeof capacityValue === 'number' &&
    capacityValue > perClassCap
  const capacityOverPlanMessage = capacityOverPlan
    ? t('classes.form.errors.capacityOverPlan', { cap: perClassCap ?? 0, planName })
    : null

  // Story 3.3 "Use this template" — imperative one-time RHF sync of the
  // preselected template once the (Query-owned) template list has loaded.
  // Guarded so it runs exactly once; not a data fetch (FW-4 third-party-lib sync).
  const presetApplied = useRef(false)
  const templatesData = templatesQuery.data
  useEffect(() => {
    if (presetApplied.current || isEdit || !initialTemplateId || !templatesData) {
      return
    }
    const preset = templatesData.find((tpl) => tpl.id === initialTemplateId)
    if (preset) {
      applyTemplate(preset)
      presetApplied.current = true
    }
    // applyTemplate is stable enough for a one-shot guarded sync; deps kept lean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesData, initialTemplateId, isEdit])

  // CR-3-1-9(c) / FU-3-1-A — per-session titled preview via the new detail
  // endpoint (only when a template is selected in create mode).
  const templatePreview = useTemplate(
    !isEdit && selectedTemplateId ? selectedTemplateId : null,
  )

  function applyTemplate(template: Template | null): void {
    setValue('templateId', template?.id ?? null)
    if (!template) {
      // CR-3-1-9(b) — "No template" resets cleanly: clear the scalar prefill
      // fields the previous template seeded so they don't orphan. The name is
      // left untouched (the user may have typed their own).
      for (const field of PREFILL_FIELDS) {
        setValue(field, undefined as never)
      }
      setIncluded({ targetBand: true, primarySkill: true, sessionCount: true, color: true })
      return
    }
    // CR-3-1-9(b) — only PREFILL an EMPTY name; never clobber a user-typed one.
    if (!getValues('name')?.trim()) {
      setValue('name', template.name)
    }
    for (const field of PREFILL_FIELDS) {
      setValue(field, templateValueFor(template, field) as never)
    }
    setIncluded({ targetBand: true, primarySkill: true, sessionCount: true, color: true })
  }

  function toggleField(field: PrefillField, on: boolean): void {
    setIncluded((prev) => ({ ...prev, [field]: on }))
    // OFF clears the field so buildCreatePayload omits it (AC2 exclude). ON
    // RESTORES the selected template's value — re-enabling must not leave the
    // field silently undefined while the Switch reads "included".
    setValue(
      field,
      (on && selectedTemplate
        ? templateValueFor(selectedTemplate, field)
        : undefined) as never,
    )
  }

  const onSubmit: SubmitHandler<ClassFormValues> = async (values) => {
    setServerError(null)

    // AC6 — client-side name-conflict (no distinct server code). Case-insensitive
    // against the already-loaded names, excluding this class's own name in edit mode.
    const typed = values.name.trim().toLowerCase()
    const ownName = initial?.name.trim().toLowerCase()
    const conflict = existingNames.some((name) => {
      const other = name.trim().toLowerCase()
      return other === typed && other !== ownName
    })
    if (conflict) {
      setError('name', { message: t('classes.form.errors.nameConflict') })
      return
    }

    // AC6 — owner over-plan capacity: block client-side with the Upgrade nudge
    // already rendered inline (the teacher path defers to the server 409).
    if (capacityOverPlan) return

    try {
      if (isEdit && initial) {
        await updateClass.mutateAsync({ id: initial.id, body: buildUpdatePayload(values) })
      } else {
        await createClass.mutateAsync(buildCreatePayload(values, included))
      }
      onClose()
    } catch (err) {
      // A 409 PLAN_LIMIT_EXCEEDED / CLASSES hard-block (create path only) opens the
      // global billing dialog (D-9-1b-3 / FU-9-1B-DIALOG-WIRING); other errors inline.
      if (reportBillingError(err)) return
      // AC6 — a 422 ValidationError maps its field errors inline (setError) so a
      // field-targeted server error surfaces under the right input, not as a
      // generic banner. Fall back to the generic inline error otherwise.
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
        const fields = err.details as ReadonlyArray<{ field?: string; message?: string }>
        let mapped = false
        for (const entry of fields) {
          if (entry.field && entry.field in FIELD_ERROR_TARGETS && entry.message) {
            setError(entry.field as keyof ClassFormValues, { message: entry.message })
            mapped = true
          }
        }
        if (mapped) return
      }
      setServerError(err instanceof ApiError ? err.message : t('classes.error.body'))
    }
  }

  const selectedTemplate =
    templatesQuery.data?.find((tpl) => tpl.id === selectedTemplateId) ?? null

  // AC6 — the top-of-form summary enumerates every live field error plus the
  // owner over-plan capacity nudge (its own message, not an RHF error).
  const bannerMessages = [
    ...Object.values(errors).map((fieldError) => fieldError?.message),
    capacityOverPlanMessage,
  ].filter((message): message is string => typeof message === 'string' && message.length > 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('classes.form.editTitle') : t('classes.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormValidationBanner
            data-testid="class-form-validation-banner"
            title={t('classes.form.validationBanner.title', { count: bannerMessages.length })}
            messages={bannerMessages}
          />

          {!isEdit ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Label>{t('classes.form.templateLabel')}</Label>
              {templatesQuery.isPending ? (
                <p
                  className="text-sm text-slate-400"
                  data-testid="class-template-picker-loading"
                >
                  {t('classes.form.templateLoading')}
                </p>
              ) : templatesQuery.isError ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-xs text-[color:var(--cl-red)]"
                  data-testid="class-template-picker-error"
                >
                  <span>{t('classes.form.templateError')}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => templatesQuery.refetch()}
                  >
                    {t('classes.form.templateRetry')}
                  </Button>
                </div>
              ) : (
                <select
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  value={selectedTemplateId ?? ''}
                  onChange={(e) =>
                    applyTemplate(
                      templatesQuery.data?.find(
                        (tpl) => tpl.id === e.target.value,
                      ) ?? null,
                    )
                  }
                  data-testid="class-template-picker"
                >
                  <option value="">{t('classes.form.templateNone')}</option>
                  {templatesQuery.data?.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              )}

              {selectedTemplate ? (
                <div className="space-y-2 pt-1" data-testid="class-template-toggles">
                  {PREFILL_FIELDS.map((field) => (
                    <div key={field} className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">
                        {t(`classes.form.prefill.${field}`)}
                      </span>
                      <Switch
                        checked={included[field]}
                        onCheckedChange={(on) => toggleField(field, on)}
                        aria-label={t('classes.form.prefill.toggleAria', {
                          field: t(`classes.form.prefill.${field}`),
                        })}
                        data-testid={`class-prefill-toggle-${field}`}
                      />
                    </div>
                  ))}
                  <div
                    className="pt-1 text-xs text-slate-400"
                    data-testid="class-session-preview"
                  >
                    {t('classes.form.sessionPreview', {
                      count: selectedTemplate.sessionCount,
                    })}
                    {templatePreview.isSuccess &&
                    templatePreview.data.sessions.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4" data-testid="class-session-preview-list">
                        {templatePreview.data.sessions.map((session) => (
                          <li key={session.id}>{session.title}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <Field label={t('classes.form.nameLabel')} error={errors.name?.message}>
            <Input {...register('name')} data-testid="class-field-name" />
          </Field>

          <Field label={t('classes.form.descriptionLabel')} error={errors.description?.message}>
            <Input {...register('description')} data-testid="class-field-description" />
          </Field>

          <Field label={t('classes.form.capacityLabel')} error={errors.capacity?.message}>
            <Input
              type="number"
              aria-invalid={capacityOverPlan || errors.capacity != null ? true : undefined}
              {...register('capacity', { setValueAs: numberOrUndefined })}
              data-testid="class-field-capacity"
            />
          </Field>

          {capacityOverPlan ? (
            <div
              role="alert"
              data-testid="class-capacity-over-plan"
              className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--cl-red)]"
            >
              <span>{capacityOverPlanMessage}</span>
              <Link
                to={PLANS_PATH}
                className="font-medium underline"
                data-testid="class-capacity-upgrade"
              >
                {t('classes.form.errors.capacityUpgradeCta')}
              </Link>
            </div>
          ) : null}

          <Field label={t('classes.form.startDateLabel')} error={errors.startDate?.message}>
            <Input type="date" {...register('startDate')} data-testid="class-field-startDate" />
          </Field>

          <Field label={t('classes.form.teacherEmailLabel')} error={errors.pendingTeacherEmail?.message}>
            <Input {...register('pendingTeacherEmail')} data-testid="class-field-teacherEmail" />
          </Field>

          {isEdit ? (
            <div className="flex items-center justify-between">
              <Label htmlFor="dueDatesEnabled">{t('classes.form.dueDatesLabel')}</Label>
              <Switch
                id="dueDatesEnabled"
                checked={dueDatesEnabled ?? false}
                onCheckedChange={(on) => setValue('dueDatesEnabled', on)}
                data-testid="class-field-dueDates"
              />
            </div>
          ) : null}

          {serverError ? (
            <p
              role="alert"
              className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            >
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('classes.form.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? t('classes.form.save') : t('classes.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactElement<{ 'aria-invalid'?: boolean }>
}): ReactElement {
  // AC6 "red-bordered input state": a field with an error drives `aria-invalid`
  // on its control (the shadcn Input renders the red border off it), unless the
  // call site already set it explicitly (capacity's owner-over-plan case).
  const control =
    error != null && children.props['aria-invalid'] === undefined
      ? cloneElement(children, { 'aria-invalid': true })
      : children
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {control}
      {error ? <InlineFieldError message={error} /> : null}
    </div>
  )
}

function numberOrUndefined(v: unknown): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

// Single source of truth for a template's value per prefill field — used by
// both applyTemplate (initial prefill) and toggleField (restore on re-enable)
// so the two can never drift.
function templateValueFor(
  template: Template,
  field: PrefillField,
): ClassFormValues[PrefillField] {
  switch (field) {
    case 'targetBand':
      return template.targetBand
    case 'primarySkill':
      return template.primarySkill as ClassFormValues['primarySkill']
    case 'sessionCount':
      return template.sessionCount
    case 'color':
      return template.color ?? undefined
  }
}

function initialFormValues(initial: ClassWire | null): Partial<ClassFormValues> {
  if (!initial) return { templateId: null, name: '' }
  return {
    templateId: initial.templateId,
    name: initial.name,
    description: initial.description ?? undefined,
    targetBand: initial.targetBand ?? undefined,
    primarySkill:
      (initial.primarySkill as ClassFormValues['primarySkill']) ?? undefined,
    sessionCount: initial.sessionCount ?? undefined,
    capacity: initial.capacity ?? undefined,
    startDate: initial.startDate ?? undefined,
    endDate: initial.endDate ?? undefined,
    color: initial.color ?? undefined,
    dueDatesEnabled: initial.dueDatesEnabled,
    teacherId: initial.teacherId,
    pendingTeacherEmail: initial.pendingTeacherEmail ?? undefined,
  }
}

function buildCreatePayload(
  values: ClassFormValues,
  included: Record<PrefillField, boolean>,
): CreateClassRequest {
  const payload: CreateClassRequest = { name: values.name }
  if (values.templateId) payload.templateId = values.templateId
  if (values.description) payload.description = values.description
  if (included.targetBand && values.targetBand != null) payload.targetBand = values.targetBand
  if (included.primarySkill && values.primarySkill) payload.primarySkill = values.primarySkill
  if (included.sessionCount && values.sessionCount != null) payload.sessionCount = values.sessionCount
  if (values.capacity != null) payload.capacity = values.capacity
  if (included.color && values.color) payload.color = values.color
  if (values.startDate) payload.startDate = values.startDate
  if (values.endDate) payload.endDate = values.endDate
  if (values.teacherId) payload.teacherId = values.teacherId
  else if (values.pendingTeacherEmail) payload.pendingTeacherEmail = values.pendingTeacherEmail
  return payload
}

function buildUpdatePayload(values: ClassFormValues): UpdateClassRequest {
  const payload: UpdateClassRequest = {}
  if (values.name) payload.name = values.name
  if (values.description) payload.description = values.description
  if (values.targetBand != null) payload.targetBand = values.targetBand
  if (values.primarySkill) payload.primarySkill = values.primarySkill
  if (values.sessionCount != null) payload.sessionCount = values.sessionCount
  if (values.capacity != null) payload.capacity = values.capacity
  if (values.startDate) payload.startDate = values.startDate
  if (values.endDate) payload.endDate = values.endDate
  if (values.color) payload.color = values.color
  if (values.dueDatesEnabled != null) payload.dueDatesEnabled = values.dueDatesEnabled
  if (values.teacherId) payload.teacherId = values.teacherId
  else if (values.pendingTeacherEmail) payload.pendingTeacherEmail = values.pendingTeacherEmail
  return payload
}
