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
import { useState, type ReactElement } from 'react'
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import type { ClassWire } from '../api/useClasses'

const PREFILL_FIELDS = ['targetBand', 'primarySkill', 'sessionCount', 'color'] as const
type PrefillField = (typeof PREFILL_FIELDS)[number]

interface ClassFormDialogProps {
  centerId: string
  initial: ClassWire | null
  onClose: () => void
}

export function ClassFormDialog({
  centerId,
  initial,
  onClose,
}: ClassFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const isEdit = initial !== null
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<ClassFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialFormValues(initial),
  })

  const selectedTemplateId = useWatch({ control, name: 'templateId' })
  const dueDatesEnabled = useWatch({ control, name: 'dueDatesEnabled' })

  function applyTemplate(template: Template | null): void {
    setValue('templateId', template?.id ?? null)
    if (!template) return
    setValue('name', template.name)
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
    try {
      if (isEdit && initial) {
        await updateClass.mutateAsync({ id: initial.id, body: buildUpdatePayload(values) })
      } else {
        await createClass.mutateAsync(buildCreatePayload(values, included))
      }
      onClose()
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('classes.error.body'))
    }
  }

  const selectedTemplate =
    templatesQuery.data?.find((tpl) => tpl.id === selectedTemplateId) ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('classes.form.editTitle') : t('classes.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {!isEdit ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Label>{t('classes.form.templateLabel')}</Label>
              <select
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                value={selectedTemplateId ?? ''}
                onChange={(e) =>
                  applyTemplate(
                    templatesQuery.data?.find((tpl) => tpl.id === e.target.value) ??
                      null,
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
                  <p className="pt-1 text-xs text-slate-400" data-testid="class-session-preview">
                    {t('classes.form.sessionPreview', {
                      count: selectedTemplate.sessionCount,
                    })}
                  </p>
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
              {...register('capacity', { setValueAs: numberOrUndefined })}
              data-testid="class-field-capacity"
            />
          </Field>

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
  children: ReactElement
}): ReactElement {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-[color:var(--cl-red)]" role="alert">
          {error}
        </p>
      ) : null}
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
