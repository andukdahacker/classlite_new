/**
 * ExerciseFormDialog — Story 4.1 (AC3/AC4). Create/edit an exercise's METADATA
 * in a <Dialog> (RHF + zodResolver(useExerciseSchema())). Create is minimal-
 * metadata (title/skill/tags/description/targetBand); the server materializes
 * the code + content shell + settings. Edit sends the freshly-read `updatedAt`
 * as the optimistic-concurrency precondition (AC4).
 *
 * On success the dialog CLOSES and the library refreshes (mutation invalidation)
 * — it does NOT navigate to the (Story 4.2) structured editor route. Toasts
 * fire from this component layer (FW-2).
 */
import { useState, type ReactElement } from 'react'
import { useForm, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  EXERCISE_SKILLS,
  parseTagsInput,
  useExerciseSchema,
  type ExerciseFormValues,
} from '../lib/exerciseSchema'
import { useCreateExercise } from '../api/useCreateExercise'
import { useUpdateExercise } from '../api/useUpdateExercise'
import { useExercise, type Exercise } from '../api/useExercise'
import type { ExerciseListItem } from '../api/useExercises'

const HTTP_CONFLICT = 409

interface ExerciseFormDialogProps {
  centerId: string
  /** null = create mode; a row = edit mode (metadata only). */
  initial: ExerciseListItem | null
  onClose: () => void
  /** Story 4.2 — called with the newly-created exercise so the caller can
   * redirect into the structured editor (the "no dead-end" post-create flow). */
  onCreated?: (created: Exercise) => void
}

export function ExerciseFormDialog({
  centerId,
  initial,
  onClose,
  onCreated,
}: ExerciseFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const isEdit = initial !== null
  const schema = useExerciseSchema()
  const createExercise = useCreateExercise(centerId)
  const updateExercise = useUpdateExercise()
  const [serverError, setServerError] = useState<string | null>(null)

  // Edit sends the FRESHLY-READ `updatedAt` as the optimistic-concurrency
  // precondition (AC4 / CR-4-1-14) — the list-row `updatedAt` can be tens of
  // seconds stale (staleTime + keepPreviousData) and would spurious-409. Fetch
  // the detail on open; fall back to the list row only if the detail read is
  // still pending / failed.
  const detailQuery = useExercise(isEdit ? initial.id : null)
  const preconditionUpdatedAt = detailQuery.data?.updatedAt ?? initial?.updatedAt
  const preconditionPending = isEdit && detailQuery.isPending

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ExerciseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialFormValues(initial),
  })

  const onSubmit: SubmitHandler<ExerciseFormValues> = async (values) => {
    setServerError(null)
    const tags = parseTagsInput(values.tags)
    const description = values.description?.trim() ? values.description.trim() : null
    try {
      if (isEdit && initial) {
        await updateExercise.mutateAsync({
          id: initial.id,
          body: {
            title: values.title,
            skill: values.skill,
            tags,
            description,
            targetBand: values.targetBand ?? null,
            updatedAt: preconditionUpdatedAt ?? initial.updatedAt,
          },
        })
        toast.success(t('exercises.toast.updated'))
      } else {
        const created = await createExercise.mutateAsync({
          title: values.title,
          skill: values.skill,
          tags,
          description,
          targetBand: values.targetBand ?? null,
        })
        toast.success(t('exercises.toast.created'))
        // Redirect straight into the structured editor (no dead-end) — the
        // caller navigates; skip the redundant onClose (the page unmounts).
        if (onCreated) {
          onCreated(created)
          return
        }
      }
      onClose()
    } catch (err) {
      // A 409 means someone else edited the exercise since we read it — show a
      // conflict-specific message and refetch a fresh precondition so the next
      // save is against current data, rather than surfacing the raw server text
      // (CR-4-1-14).
      if (err instanceof ApiError && err.status === HTTP_CONFLICT) {
        setServerError(t('exercises.form.conflict'))
        if (isEdit) void detailQuery.refetch()
        return
      }
      const message =
        err instanceof ApiError ? err.message : t('exercises.toast.error')
      setServerError(message)
      toast.error(t('exercises.toast.error'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('exercises.form.editTitle')
              : t('exercises.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field
            htmlFor="exercise-field-title"
            label={t('exercises.form.titleLabel')}
            error={errors.title?.message}
          >
            <Input id="exercise-field-title" {...register('title')} data-testid="exercise-field-title" autoFocus />
          </Field>

          <div className="space-y-1">
            <Label htmlFor="exercise-field-skill">
              {t('exercises.form.skillLabel')}
            </Label>
            <select
              id="exercise-field-skill"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              {...register('skill')}
              data-testid="exercise-field-skill"
            >
              {EXERCISE_SKILLS.map((skill) => (
                <option key={skill} value={skill}>
                  {t(`exercises.skill.${skill}`)}
                </option>
              ))}
            </select>
            {errors.skill ? (
              <p className="text-xs text-[color:var(--cl-red)]" role="alert">
                {errors.skill.message}
              </p>
            ) : null}
          </div>

          <Field
            htmlFor="exercise-field-tags"
            label={t('exercises.form.tagsLabel')}
            error={errors.tags?.message}
          >
            <Input
              id="exercise-field-tags"
              {...register('tags')}
              placeholder={t('exercises.form.tagsPlaceholder')}
              data-testid="exercise-field-tags"
            />
          </Field>

          <Field
            htmlFor="exercise-field-description"
            label={t('exercises.form.descriptionLabel')}
            error={errors.description?.message}
          >
            <Input id="exercise-field-description" {...register('description')} data-testid="exercise-field-description" />
          </Field>

          <Field
            htmlFor="exercise-field-targetBand"
            label={t('exercises.form.targetBandLabel')}
            error={errors.targetBand?.message}
          >
            <Input
              id="exercise-field-targetBand"
              type="number"
              step="0.5"
              {...register('targetBand', { setValueAs: numberOrUndefined })}
              data-testid="exercise-field-targetBand"
            />
          </Field>

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
              {t('exercises.form.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || preconditionPending}
              data-testid="exercise-form-submit"
            >
              {isEdit ? t('exercises.form.save') : t('exercises.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string
  label: string
  error?: string
  children: ReactElement
}): ReactElement {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
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

function initialFormValues(
  initial: ExerciseListItem | null,
): Partial<ExerciseFormValues> {
  if (!initial) return { title: '', skill: 'reading', tags: '' }
  return {
    title: initial.title,
    skill: initial.skill,
    tags: (initial.tags ?? []).join(', '),
    description: initial.description ?? undefined,
    targetBand: initial.targetBand ?? undefined,
  }
}
