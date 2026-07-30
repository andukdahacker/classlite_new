/**
 * MoveDialog — reparent a file or folder into another folder (or root) via a
 * simple select (Story 4.4b, AC2). For a FOLDER move the caller passes the
 * legal targets (self + descendants excluded so the UI can't offer a cycle —
 * the server 422 FOLDER_CYCLE is the backstop, surfaced by the mutation's
 * rollback toast). For a FILE move every folder is a legal target.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { FolderWire } from '../api/foldersApi'

const ROOT_VALUE = '__root__'

interface MoveDialogProps {
  open: boolean
  titleKey: string
  /** Folders the item may move into (already cycle-filtered for folder moves). */
  targets: FolderWire[]
  /** The item's current parent, preselected. null = root. */
  currentParentId: string | null
  pending: boolean
  onSubmit: (targetFolderId: string | null) => void
  onClose: () => void
}

export function MoveDialog({
  open,
  titleKey,
  targets,
  currentParentId,
  pending,
  onSubmit,
  onClose,
}: MoveDialogProps): ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string>(currentParentId ?? ROOT_VALUE)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent data-testid="kh-move-dialog">
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-4">
          <label htmlFor="kh-move-select" className="text-xs font-medium text-slate-500">
            {t('knowledgeHub.move.destinationLabel')}
          </label>
          {/* Native select — accessible by default, no extra Radix wiring needed. */}
          <select
            id="kh-move-select"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            data-testid="kh-move-select"
          >
            <option value={ROOT_VALUE}>{t('knowledgeHub.move.rootOption')}</option>
            {targets.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="kh-move-cancel">
            {t('knowledgeHub.actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => onSubmit(selected === ROOT_VALUE ? null : selected)}
            data-testid="kh-move-submit"
          >
            {t('knowledgeHub.actions.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
