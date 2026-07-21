/**
 * TemplateDeleteDialog — Story 3.3 (AC4/AC10). Confirm soft-delete of a
 * center-owned template. Surfaces the `usedCount` warning (spawned classes are
 * unaffected — AC4) and drives `useDeleteTemplate` (optimistic list-removal +
 * rollback). Shared by the s19 index rows and the s20 detail actions.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useDeleteTemplate } from '../api/useDeleteTemplate'

interface TemplateDeleteDialogProps {
  templateId: string
  templateName: string
  usedCount: number
  onClose: () => void
  /** Called after a successful soft-delete (e.g. navigate away from s20). */
  onDeleted?: () => void
}

export function TemplateDeleteDialog({
  templateId,
  templateName,
  usedCount,
  onClose,
  onDeleted,
}: TemplateDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const deleteTemplate = useDeleteTemplate(templateId)
  const [error, setError] = useState<string | null>(null)

  function handleConfirm(): void {
    setError(null)
    deleteTemplate.mutate(undefined, {
      onSuccess: () => {
        onDeleted?.()
        onClose()
      },
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : t('classes.templates.delete.error'),
        ),
    })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="template-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('classes.templates.delete.title', { name: templateName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {usedCount > 0
              ? t('classes.templates.delete.usedWarning', { count: usedCount })
              : t('classes.templates.delete.body')}
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
            {t('classes.templates.delete.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleteTemplate.isPending}
            data-testid="template-delete-confirm"
          >
            {t('classes.templates.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
