/**
 * ConfirmDeleteDialog — honest soft-delete confirmation (Story 4.4b, AC2). Delete
 * is soft server-side, but a FOLDER delete cascades to its whole subtree (folders
 * + files) and frees their storage — the copy says so plainly (the "honest
 * confirm-dialog warning" the 4.4a soft-delete note asked this story to decide).
 * A file delete removes just that file. No hard delete, no restore UI in v1.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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

interface ConfirmDeleteDialogProps {
  open: boolean
  kind: 'folder' | 'file'
  name: string
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDeleteDialog({
  open,
  kind,
  name,
  pending,
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const bodyKey =
    kind === 'folder' ? 'knowledgeHub.delete.folderBody' : 'knowledgeHub.delete.fileBody'
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialogContent data-testid="kh-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('knowledgeHub.delete.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(bodyKey)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} data-testid="kh-delete-cancel">
            {t('knowledgeHub.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            data-testid="kh-delete-confirm"
          >
            {t('knowledgeHub.actions.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
