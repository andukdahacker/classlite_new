/**
 * RenameDialog — a minimal RHF + zodResolver rename form (Story 4.4b, AC2). Used
 * for both folder and file renames; the caller passes the title/label copy and
 * the current name. Standard validated form → RHF (FW-8); the Zod schema is the
 * shared 1..200 name rule.
 */
import { useEffect, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { folderNameSchema, type FolderNameInput } from '../lib/knowledgeHubSchemas'

interface RenameDialogProps {
  open: boolean
  titleKey: string
  labelKey: string
  initialName: string
  pending: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}

export function RenameDialog({
  open,
  titleKey,
  labelKey,
  initialName,
  pending,
  onSubmit,
  onClose,
}: RenameDialogProps): ReactElement {
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FolderNameInput>({
    resolver: zodResolver(folderNameSchema),
    defaultValues: { name: initialName },
  })

  // Re-seed when the target changes (the dialog instance is reused across rows).
  useEffect(() => {
    reset({ name: initialName })
  }, [initialName, reset])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent data-testid="kh-rename-dialog">
        <form onSubmit={handleSubmit((values) => onSubmit(values.name.trim()))}>
          <DialogHeader>
            <DialogTitle>{t(titleKey)}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-4">
            <label htmlFor="kh-rename-input" className="text-xs font-medium text-slate-500">
              {t(labelKey)}
            </label>
            <Input
              id="kh-rename-input"
              autoFocus
              {...register('name')}
              aria-invalid={Boolean(errors.name)}
              data-testid="kh-rename-input"
            />
            {errors.name ? (
              <p role="alert" className="text-xs text-[color:var(--cl-red)]">
                {t(errors.name.message ?? 'knowledgeHub.folder.errors.nameRequired')}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="kh-rename-cancel">
              {t('knowledgeHub.actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending} data-testid="kh-rename-submit">
              {t('knowledgeHub.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
