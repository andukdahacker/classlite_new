/**
 * ExerciseDeleteDialog — Story 4.1 (AC5). Confirm SOFT-delete of a library
 * exercise (shadcn AlertDialog; semantics copied from TemplateDeleteDialog).
 * Drives useDeleteExercise (optimistic list-removal + rollback). The copy says
 * the row is recoverable (the Epic 10 restore UI). Toast fires here (FW-2).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-fetch'
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
import { useDeleteExercise } from '../api/useDeleteExercise'

interface ExerciseDeleteDialogProps {
  exerciseId: string
  exerciseTitle: string
  onClose: () => void
}

export function ExerciseDeleteDialog({
  exerciseId,
  exerciseTitle,
  onClose,
}: ExerciseDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const deleteExercise = useDeleteExercise(exerciseId)
  const [error, setError] = useState<string | null>(null)

  function handleConfirm(): void {
    setError(null)
    deleteExercise.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('exercises.toast.deleted'))
        onClose()
      },
      onError: (err) => {
        setError(err instanceof ApiError ? err.message : t('exercises.toast.error'))
        toast.error(t('exercises.toast.error'))
      },
    })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="exercise-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('exercises.delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('exercises.delete.body', { title: exerciseTitle })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
          >
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t('exercises.delete.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleteExercise.isPending}
            data-testid="exercise-delete-confirm"
          >
            {t('exercises.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
