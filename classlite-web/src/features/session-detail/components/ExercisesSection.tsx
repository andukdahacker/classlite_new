/**
 * ExercisesSection — Story 3.5 (AC5). Add / edit / delete session exercises:
 * lightweight, in-session, ungraded entries (title + optional instructions +
 * optional link) — NOT the Epic 5/6 assignments entity. Optimistic (FW-2).
 */
import { useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useSessionExercises,
  useCreateExercise,
  useUpdateExercise,
  useDeleteExercise,
  type SessionExerciseWire,
} from '../api/sessionContentApi'
import { exerciseFormSchema, isHttpUrl, type ExerciseFormValues } from '../lib/contentSchemas'
import { ContentSectionFrame } from './ContentSectionFrame'
import { useEditFocusReturn, isOptimisticId } from '../lib/rowState'

export function ExercisesSection({ sessionId }: { sessionId: string }): ReactElement {
  const { t } = useTranslation()
  const query = useSessionExercises(sessionId)
  const create = useCreateExercise(sessionId)
  const exercises = query.data ?? []

  const form = useForm<ExerciseFormValues>({
    resolver: zodResolver(exerciseFormSchema),
    defaultValues: { title: '', instructions: '', link: '' },
  })

  const onAdd = form.handleSubmit((values) => {
    create.mutate(
      { title: values.title, instructions: values.instructions || null, link: values.link || null },
      { onSuccess: () => form.reset({ title: '', instructions: '', link: '' }) },
    )
  })

  return (
    <ContentSectionFrame
      titleKey="session.exercises.title"
      testid="session-exercises"
      count={exercises.length}
      isPending={query.isPending}
      isError={query.isError}
      isEmpty={exercises.length === 0}
      onRetry={() => query.refetch()}
      emptyKey="session.exercises.empty"
      addForm={
        <form onSubmit={onAdd} className="space-y-2" data-testid="session-exercises-add-form">
          <Input
            {...form.register('title')}
            aria-label={t('session.exercises.field.title')}
            placeholder={t('session.exercises.field.titlePlaceholder')}
          />
          <Textarea
            {...form.register('instructions')}
            aria-label={t('session.exercises.field.instructions')}
            placeholder={t('session.exercises.field.instructionsPlaceholder')}
            rows={2}
          />
          <Input
            {...form.register('link')}
            aria-label={t('session.exercises.field.link')}
            placeholder={t('session.exercises.field.linkPlaceholder')}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t('session.exercises.add')}
            </Button>
          </div>
        </form>
      }
    >
      <ul className="space-y-2" data-testid="session-exercises-list">
        {exercises.map((exercise) => (
          <ExerciseRow key={exercise.id} sessionId={sessionId} exercise={exercise} />
        ))}
      </ul>
    </ContentSectionFrame>
  )
}

function ExerciseRow({
  sessionId,
  exercise,
}: {
  sessionId: string
  exercise: SessionExerciseWire
}): ReactElement {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const create = useCreateExercise(sessionId)
  const update = useUpdateExercise(sessionId)
  const remove = useDeleteExercise(sessionId)
  const editTriggerRef = useEditFocusReturn(editing)
  const isOptimistic = isOptimisticId(exercise.id)
  const safeLink = exercise.link !== null && isHttpUrl(exercise.link)

  const form = useForm<ExerciseFormValues>({
    resolver: zodResolver(exerciseFormSchema),
    defaultValues: {
      title: exercise.title,
      instructions: exercise.instructions ?? '',
      link: exercise.link ?? '',
    },
  })

  const onSave = form.handleSubmit((values) => {
    update.mutate(
      {
        id: exercise.id,
        body: { title: values.title, instructions: values.instructions || null, link: values.link || null },
      },
      { onSuccess: () => setEditing(false) },
    )
  })

  const onDelete = () => {
    remove.mutate(exercise.id, {
      onSuccess: () => {
        toast.success(t('session.detail.content.deleted'), {
          action: {
            label: t('session.detail.content.undo'),
            onClick: () =>
              create.mutate({ title: exercise.title, instructions: exercise.instructions, link: exercise.link }),
          },
        })
      },
      onError: () => toast.error(t('session.detail.content.deleteError')),
    })
  }

  if (editing) {
    return (
      <li className="space-y-2 rounded-md border border-slate-200 p-2">
        <form onSubmit={onSave} className="space-y-2">
          <Input {...form.register('title')} autoFocus aria-label={t('session.exercises.field.title')} />
          <Textarea {...form.register('instructions')} aria-label={t('session.exercises.field.instructions')} rows={2} />
          <Input {...form.register('link')} aria-label={t('session.exercises.field.link')} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('session.detail.content.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {t('session.detail.content.save')}
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="rounded-md border border-slate-200 p-2" data-testid="session-exercise-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{exercise.title}</p>
          {exercise.instructions && (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">
              {exercise.instructions}
            </p>
          )}
          {exercise.link &&
            (safeLink ? (
              <a
                href={exercise.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block truncate text-sm text-[color:var(--cl-accent)] underline"
              >
                {exercise.link}
              </a>
            ) : (
              <span className="mt-0.5 inline-block truncate text-sm text-slate-500">{exercise.link}</span>
            ))}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button ref={editTriggerRef} size="sm" variant="ghost" disabled={isOptimistic} onClick={() => setEditing(true)}>
            {t('session.detail.content.edit')}
          </Button>
          <Button size="sm" variant="ghost" disabled={isOptimistic || remove.isPending} onClick={onDelete}>
            {t('session.detail.content.delete')}
          </Button>
        </div>
      </div>
    </li>
  )
}
