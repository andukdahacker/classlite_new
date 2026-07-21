/**
 * TemplateFormPage — Story 3.3 (AC6/AC8/AC9). One RHF + zodResolver form serving
 * BOTH create (`/classes/templates/new`, incl. Save-as-template prefill via
 * router state) and edit (`/classes/templates/:id/edit`). The session list is a
 * `useFieldArray` with @dnd-kit drag-to-reorder (pointer + keyboard sensor —
 * a11y) and add/remove controls; `sessionCount` is DERIVED (display-only =
 * sessions.length). Save uses the create/update hooks; ApiError (422 field
 * errors, 403 TEMPLATE_READONLY) surfaces inline.
 */
import { useState, type ReactElement } from 'react'
import { useForm, useFieldArray, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams, useLocation } from 'react-router'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useTemplateSchema,
  PRIMARY_SKILLS,
  type TemplateFormValues,
} from './lib/templateSchema'
import { useTemplate } from './api/useTemplate'
import { useCreateTemplate } from './api/useCreateTemplate'
import { useUpdateTemplate } from './api/useUpdateTemplate'

interface PrefillState {
  prefill?: {
    name?: string
    targetBand?: number
    primarySkill?: string
    color?: string | null
    savedAsTemplate?: boolean
  }
}

const EMPTY_SESSION = { title: '', description: '', duration: null }

// A 404 (soft-deleted/absent) or 422 (malformed non-UUID id) edit-load is a
// terminal "no such template" — redirect to the detail route's NotFoundCard
// rather than showing a FormLoadError whose Retry can never resolve (CR-3-3 fix).
const NOT_FOUND_STATUS = 404
const INVALID_ID_STATUS = 422

function numberOrUndefined(v: unknown): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

function durationOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export default function TemplateFormPage(): ReactElement {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const detailQuery = useTemplate(isEdit ? id : null)

  if (isEdit && detailQuery.isPending) {
    return <FormSkeleton />
  }
  if (isEdit && detailQuery.isError) {
    const err = detailQuery.error
    if (
      err instanceof ApiError &&
      (err.status === NOT_FOUND_STATUS || err.status === INVALID_ID_STATUS)
    ) {
      return <Navigate to={`/classes/templates/${id}`} replace />
    }
    return <FormLoadError onRetry={() => detailQuery.refetch()} />
  }
  // A system seed cannot be edited (API would 403); short-circuit with a note.
  if (isEdit && detailQuery.data?.scope === 'system') {
    return <ReadOnlyNote />
  }

  return (
    <TemplateForm
      key={id ?? 'new'}
      templateId={id}
      initial={isEdit ? detailQuery.data : undefined}
    />
  )
}

function defaultValues(
  initial: ReturnType<typeof useTemplate>['data'] | undefined,
  prefill: PrefillState['prefill'],
): TemplateFormValues {
  if (initial) {
    return {
      name: initial.name,
      targetBand: initial.targetBand,
      primarySkill:
        initial.primarySkill as TemplateFormValues['primarySkill'],
      color: initial.color ?? undefined,
      sessions: initial.sessions.map((s) => ({
        title: s.title,
        description: s.description ?? undefined,
        duration: s.duration ?? null,
      })),
    }
  }
  return {
    name: prefill?.name ?? '',
    targetBand: prefill?.targetBand ?? 6.5,
    primarySkill:
      (prefill?.primarySkill as TemplateFormValues['primarySkill']) ??
      'writing',
    color: prefill?.color ?? undefined,
    sessions: [{ ...EMPTY_SESSION }],
  }
}

function TemplateForm({
  templateId,
  initial,
}: {
  templateId: string | undefined
  initial: ReturnType<typeof useTemplate>['data'] | undefined
}): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const schema = useTemplateSchema()
  const prefill = (location.state as PrefillState | null)?.prefill
  const isEdit = Boolean(templateId)

  const createTemplate = useCreateTemplate()
  const updateTemplate = useUpdateTemplate(templateId ?? '')
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(initial, prefill),
  })

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'sessions',
  })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = fields.findIndex((f) => f.id === active.id)
    const to = fields.findIndex((f) => f.id === over.id)
    if (from !== -1 && to !== -1) move(from, to)
  }

  const onSubmit: SubmitHandler<TemplateFormValues> = async (values) => {
    setServerError(null)
    const sessions = values.sessions.map((s) => ({
      title: s.title,
      description: s.description?.trim() ? s.description : null,
      duration: s.duration ?? null,
    }))
    try {
      if (isEdit && templateId) {
        await updateTemplate.mutateAsync({
          name: values.name,
          targetBand: values.targetBand,
          primarySkill: values.primarySkill,
          color: values.color?.trim() ? values.color : null,
          sessions,
        })
        navigate(`/classes/templates/${templateId}`)
      } else {
        const created = await createTemplate.mutateAsync({
          name: values.name,
          targetBand: values.targetBand,
          primarySkill: values.primarySkill,
          sessionCount: sessions.length,
          color: values.color?.trim() ? values.color : null,
          sessions,
        })
        navigate(`/classes/templates/${created.id}`)
      }
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : t('classes.templates.form.error'),
      )
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl px-4 py-6"
      data-testid="template-form-page"
    >
      <h1 className="mb-6 font-fraunces text-2xl text-slate-900">
        {isEdit
          ? t('classes.templates.form.editTitle')
          : t('classes.templates.form.createTitle')}
      </h1>

      {prefill?.savedAsTemplate ? (
        <p
          className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
          data-testid="template-save-as-note"
        >
          {t('classes.templates.saveAsTemplate.limitationNote')}
        </p>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Field label={t('classes.templates.form.nameLabel')} error={errors.name?.message}>
          <Input {...register('name')} data-testid="template-field-name" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('classes.templates.form.targetBandLabel')}
            error={errors.targetBand?.message}
          >
            <Input
              type="number"
              step="0.5"
              {...register('targetBand', { setValueAs: numberOrUndefined })}
              data-testid="template-field-targetBand"
            />
          </Field>

          <Field
            label={t('classes.templates.form.primarySkillLabel')}
            error={errors.primarySkill?.message}
          >
            <select
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              {...register('primarySkill')}
              data-testid="template-field-primarySkill"
            >
              {PRIMARY_SKILLS.map((skill) => (
                <option key={skill} value={skill}>
                  {t(`classes.skill.${skill}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('classes.templates.form.colorLabel')} error={errors.color?.message}>
          <Input {...register('color')} data-testid="template-field-color" />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>{t('classes.templates.form.sessionsLabel')}</Label>
            <span className="text-xs text-slate-400" data-testid="template-session-count">
              {t('classes.templates.form.derivedCount', { count: fields.length })}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {t('classes.templates.form.dragHint')}
          </p>
          {errors.sessions?.message ? (
            <p className="mb-2 text-xs text-[color:var(--cl-red)]" role="alert">
              {errors.sessions.message}
            </p>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={fields.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3" data-testid="template-session-list">
                {fields.map((field, index) => (
                  <SortableSessionRow
                    key={field.id}
                    id={field.id}
                    index={index}
                    register={register}
                    removable={fields.length > 1}
                    onRemove={() => remove(index)}
                    error={errors.sessions?.[index]}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => append({ ...EMPTY_SESSION })}
            data-testid="template-add-session"
          >
            {t('classes.templates.form.addSession')}
          </Button>
        </div>

        {serverError ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
          >
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // Discard any staged (uncommitted) value before leaving.
              void getValues
              void setValue
              navigate(
                isEdit ? `/classes/templates/${templateId}` : '/classes/templates',
              )
            }}
          >
            {t('classes.templates.form.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting} data-testid="template-form-save">
            {isEdit
              ? t('classes.templates.form.save')
              : t('classes.templates.form.create')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function SortableSessionRow({
  id,
  index,
  register,
  removable,
  onRemove,
  error,
}: {
  id: string
  index: number
  register: ReturnType<typeof useForm<TemplateFormValues>>['register']
  removable: boolean
  onRemove: () => void
  error:
    | {
        title?: { message?: string }
        duration?: { message?: string }
      }
    | undefined
}): ReactElement {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-md border border-slate-200 p-3"
      data-testid={`template-session-row-${index}`}
    >
      <button
        type="button"
        className="mt-1 cursor-grab rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
        aria-label={t('classes.templates.form.dragHandleAria', {
          position: index + 1,
        })}
        data-testid={`template-session-drag-${index}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 space-y-2">
        <div>
          <Input
            {...register(`sessions.${index}.title`)}
            placeholder={t('classes.templates.form.sessionTitlePlaceholder')}
            data-testid={`template-session-title-${index}`}
          />
          {error?.title?.message ? (
            <p className="mt-1 text-xs text-[color:var(--cl-red)]" role="alert">
              {error.title.message}
            </p>
          ) : null}
        </div>
        <Input
          {...register(`sessions.${index}.description`)}
          placeholder={t('classes.templates.form.sessionDescriptionPlaceholder')}
          data-testid={`template-session-description-${index}`}
        />
        <div>
          <Input
            type="number"
            {...register(`sessions.${index}.duration`, {
              setValueAs: durationOrNull,
            })}
            placeholder={t('classes.templates.form.sessionDurationPlaceholder')}
            data-testid={`template-session-duration-${index}`}
          />
          {error?.duration?.message ? (
            <p className="mt-1 text-xs text-[color:var(--cl-red)]" role="alert">
              {error.duration.message}
            </p>
          ) : null}
        </div>
      </div>

      {removable ? (
        <button
          type="button"
          className="mt-1 rounded p-1 text-slate-400 hover:text-[color:var(--cl-red)] focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
          onClick={onRemove}
          aria-label={t('classes.templates.form.removeSessionAria', {
            position: index + 1,
          })}
          data-testid={`template-session-remove-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </li>
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

function FormSkeleton(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="template-form-skeleton">
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

function FormLoadError({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      >
        <span>{t('classes.templates.error.body')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('classes.templates.error.retry')}
        </Button>
      </div>
    </div>
  )
}

function ReadOnlyNote(): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center" data-testid="template-readonly-note">
      <h1 className="font-fraunces text-xl text-slate-900">
        {t('classes.templates.readOnly.headline')}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {t('classes.templates.readOnly.body')}
      </p>
    </div>
  )
}
