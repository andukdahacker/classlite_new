/**
 * KnowledgeHubPicker — the ONE reusable "From Knowledge Hub" browse-select dialog
 * (Story 4.4b, AC6). A single component with a required `mode` contract drives
 * all three seams (exercise audio, session/class materials, AI topic seed), so
 * the browse/select behavior is written once and each seam only declares its
 * intent:
 *
 *   mode = {
 *     allowedTypes: FileKind[] | 'all'   // filters the selectable files
 *     selection: 'single' | 'multi'      // radio vs checkbox
 *     confirmVerbKey: string             // the confirm button label (i18n key)
 *     emptyKey: string                   // per-seam empty-state copy
 *     onConfirm: (files) => void         // single → exactly one file
 *   }
 *
 * Selection is tracked by the full file record (not just id) so a multi-select
 * survives folder navigation. Files whose kind is not allowed render disabled so
 * the seam's contract ("audio only", etc.) is visible, not silently filtered.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSyncExternalStore } from 'react'
import { ChevronRight, Folder as FolderIcon } from 'lucide-react'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFolders } from '../api/foldersApi'
import { useFiles, type FileWire } from '../api/filesApi'
import { childFolders, folderPath } from '../lib/folderTree'
import { fileKindOf, FILE_KIND_TINT, type FileKind } from '../lib/fileKind'

export interface KnowledgeHubPickerMode {
  allowedTypes: FileKind[] | 'all'
  selection: 'single' | 'multi'
  confirmVerbKey: string
  emptyKey: string
  onConfirm: (files: FileWire[]) => void
}

interface KnowledgeHubPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: KnowledgeHubPickerMode
}

const SESSION_KEY_TUPLE = authKeys.session()
function useCenterId(): string | null {
  const session = useSyncExternalStore<Session | null>(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () => queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null,
    () => null,
  )
  return session?.center?.id ?? null
}

function isAllowed(mode: KnowledgeHubPickerMode, contentType: string): boolean {
  if (mode.allowedTypes === 'all') return true
  return mode.allowedTypes.includes(fileKindOf(contentType))
}

export function KnowledgeHubPicker({
  open,
  onOpenChange,
  mode,
}: KnowledgeHubPickerProps): ReactElement {
  const { t } = useTranslation()
  const centerId = useCenterId()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Map<string, FileWire>>(new Map())

  const foldersQuery = useFolders(centerId)
  const filesQuery = useFiles(centerId, folderId)
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const subfolders = childFolders(folders, folderId)
  const files = filesQuery.data ?? []
  const path = folderPath(folders, folderId)

  function toggle(file: FileWire): void {
    setSelected((prev) => {
      const next = new Map(mode.selection === 'single' ? [] : prev)
      if (prev.has(file.id) && mode.selection === 'multi') {
        next.delete(file.id)
      } else {
        next.set(file.id, file)
      }
      return next
    })
  }

  // Closing (Cancel, backdrop, or confirm) returns the dialog to its initial
  // state — the component stays mounted, so without this a reopen shows the prior
  // selection still checked and lands in the last-visited folder.
  function handleOpenChange(next: boolean): void {
    if (!next) {
      setSelected(new Map())
      setFolderId(null)
    }
    onOpenChange(next)
  }

  function confirm(): void {
    mode.onConfirm(Array.from(selected.values()))
    handleOpenChange(false)
  }

  // A disabled query (no center resolved) reports isPending forever; gate on
  // centerId so a missing center reaches the empty leg, not an eternal skeleton.
  const isPending = Boolean(centerId) && (foldersQuery.isPending || filesQuery.isPending)
  const isError = foldersQuery.isError || filesQuery.isError
  // "Nothing to pick" must account for the seam's type filter: a folder of PDFs
  // in an audio-only picker has no *selectable* files, so the per-seam empty copy
  // should show rather than a wall of disabled rows.
  const selectableCount = files.filter((file) => isAllowed(mode, file.contentType)).length
  const nothingSelectable =
    !isPending && !isError && subfolders.length === 0 && selectableCount === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="kh-picker">
        <DialogHeader>
          <DialogTitle>{t('knowledgeHub.picker.title')}</DialogTitle>
        </DialogHeader>

        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label={t('knowledgeHub.breadcrumb.label')}>
          <button
            type="button"
            onClick={() => setFolderId(null)}
            className="text-slate-500 hover:text-slate-900"
            data-testid="kh-picker-root"
          >
            {t('knowledgeHub.tree.root')}
          </button>
          {path.map((folder) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-slate-300" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setFolderId(folder.id)}
                className="text-slate-500 hover:text-slate-900"
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="max-h-80 min-h-40 overflow-y-auto rounded-md border border-slate-200" data-testid="kh-picker-list">
          {isPending ? (
            <div className="space-y-2 p-3" role="status" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : isError ? (
            <div role="alert" className="p-4 text-sm text-[color:var(--cl-red)]" data-testid="kh-picker-error">
              {t('knowledgeHub.error.body')}
            </div>
          ) : nothingSelectable ? (
            <p className="p-6 text-center text-sm text-slate-400" data-testid="kh-picker-empty">
              {t(mode.emptyKey)}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subfolders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => setFolderId(folder.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    data-testid={`kh-picker-folder-${folder.id}`}
                  >
                    <FolderIcon className="size-4 text-[color:var(--cl-accent)]" aria-hidden="true" />
                    <span className="min-w-0 truncate">{folder.name}</span>
                  </button>
                </li>
              ))}
              {files.map((file) => (
                <PickerFileRow
                  key={file.id}
                  file={file}
                  allowed={isAllowed(mode, file.contentType)}
                  selectionType={mode.selection}
                  checked={selected.has(file.id)}
                  onToggle={() => toggle(file)}
                />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} data-testid="kh-picker-cancel">
            {t('knowledgeHub.actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={confirm}
            data-testid="kh-picker-confirm"
          >
            {t(mode.confirmVerbKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickerFileRow({
  file,
  allowed,
  selectionType,
  checked,
  onToggle,
}: {
  file: FileWire
  allowed: boolean
  selectionType: 'single' | 'multi'
  checked: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation()
  const kind = fileKindOf(file.contentType)
  const tint: string = FILE_KIND_TINT[kind]
  return (
    <li>
      <label
        className={`flex items-center gap-2 px-3 py-2 text-sm ${
          allowed ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-40'
        }`}
        data-testid={`kh-picker-file-${file.id}`}
      >
        <input
          type={selectionType === 'single' ? 'radio' : 'checkbox'}
          name="kh-picker-file"
          checked={checked}
          disabled={!allowed}
          onChange={onToggle}
          data-testid={`kh-picker-select-${file.id}`}
          aria-label={t('knowledgeHub.picker.selectAria', { name: file.name })}
        />
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded text-[8px] font-bold uppercase text-white"
          style={{ backgroundColor: tint }}
          aria-hidden="true"
        >
          {kind === 'other' ? '•' : kind}
        </span>
        <span className="min-w-0 truncate">{file.name}</span>
      </label>
    </li>
  )
}
