/**
 * KnowledgeHubPage — the `/knowledge-hub` browser (Story 4.4b, AC1/AC2). A
 * folder tree (left) + breadcrumb + tile grid of sub-folders and files, with the
 * UX-1 trilogy on the listing (skeleton / inline error+retry / TWO empty states:
 * a true-empty warm first-run hero vs a quiet "empty folder"). Type-tinted file
 * icons, per-file "Used in …" back-links, and folder/file CRUD via the FW-2
 * optimistic hooks. Route-gated owner/admin/teacher (see routes.tsx).
 *
 * The upload dialog is opened from the toolbar and receives the storage-full
 * flag so the 100% block surfaces AT the upload seam (AC7), not just in Settings.
 */
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  ChevronRight,
  FolderPlus,
  Folder as FolderIcon,
  MoreHorizontal,
  UploadCloud,
} from 'lucide-react'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  isOptimisticFolderId,
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useUpdateFolder,
  type FolderWire,
} from './api/foldersApi'
import {
  useDeleteFile,
  useFiles,
  useMoveFile,
  useRenameFile,
  type FileWire,
} from './api/filesApi'
import { useStorageUsage } from './api/useStorageUsage'
import { knowledgeHubKeys } from './api/knowledgeHubKeys'
import {
  buildFolderTree,
  childFolders,
  folderPath,
  moveTargetsForFolder,
} from './lib/folderTree'
import { fileKindOf, FILE_KIND_TINT, fileKindLabelKey } from './lib/fileKind'
import { formatFileSize, isStorageFull } from './lib/formatFileSize'
import { UploadDialog } from './components/UploadDialog'
import { RenameDialog } from './components/RenameDialog'
import { MoveDialog } from './components/MoveDialog'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'

// --- session snapshot (mirrors ExerciseLibraryPage) ---
const SESSION_KEY_TUPLE = authKeys.session()
function subscribeSession(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notify)
}
function getSession(): Session | null {
  return queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null
}
function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(subscribeSession, getSession, () => null)
}

type RenameTarget =
  | { kind: 'folder'; id: string; name: string }
  | { kind: 'file'; id: string; name: string }
type MoveTarget =
  | { kind: 'folder'; id: string; parentId: string | null }
  | { kind: 'file'; id: string; parentId: string | null }
type DeleteTarget =
  | { kind: 'folder'; id: string; name: string }
  | { kind: 'file'; id: string; name: string }

export function KnowledgeHubPage(): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useSessionSnapshot()
  const centerId = session?.center?.id ?? null

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const foldersQuery = useFolders(centerId)
  const filesQuery = useFiles(centerId, currentFolderId)
  const usageQuery = useStorageUsage(centerId)

  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const files = filesQuery.data ?? []
  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const path = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId])
  const subfolders = useMemo(
    () => childFolders(folders, currentFolderId),
    [folders, currentFolderId],
  )

  const storageFull = usageQuery.data
    ? isStorageFull(usageQuery.data.usedBytes, usageQuery.data.limitBytes)
    : false

  const cid = centerId ?? ''
  const createFolder = useCreateFolder(cid)
  const updateFolder = useUpdateFolder(cid)
  const deleteFolder = useDeleteFolder(cid)
  const renameFile = useRenameFile(cid, currentFolderId)
  const moveFile = useMoveFile(cid, currentFolderId)
  const deleteFile = useDeleteFile(cid, currentFolderId)

  // A disabled query (no center resolved) reports isPending forever; gate the
  // skeleton on centerId so a missing center reaches the empty/error legs
  // instead of an infinite skeleton (UX-1).
  const isPending = Boolean(centerId) && (foldersQuery.isPending || filesQuery.isPending)
  const isError = foldersQuery.isError || filesQuery.isError
  const viewEmpty = subfolders.length === 0 && files.length === 0
  // True-empty = the entire hub has nothing (no folders anywhere, no root files),
  // and we're at root. A quiet "empty folder" covers an empty sub-folder.
  const hubEmpty = folders.length === 0 && currentFolderId === null && files.length === 0

  function onUploaded(): void {
    queryClient.invalidateQueries({
      queryKey: knowledgeHubKeys.fileList(cid, currentFolderId),
    })
    if (centerId) usageQuery.refetch()
  }

  // Opening the dialog re-reads storage usage so the AC7 100% block reflects
  // headroom freed/consumed since mount (mounting the dialog alone won't refetch).
  function openUpload(): void {
    setUploadOpen(true)
    if (centerId) usageQuery.refetch()
  }

  // Ignore selection of a still-optimistic folder (its id isn't a real server id
  // yet, so navigating into it would fetch a phantom folder).
  function selectFolder(id: string | null): void {
    if (id === null || !isOptimisticFolderId(id)) setCurrentFolderId(id)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="knowledge-hub-page">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-2xl text-slate-900">{t('knowledgeHub.heading')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('knowledgeHub.subheading')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setCreateOpen(true)}
            data-testid="kh-new-folder"
          >
            <FolderPlus className="mr-1 size-4" aria-hidden="true" />
            {t('knowledgeHub.actions.newFolder')}
          </Button>
          <Button onClick={openUpload} data-testid="kh-upload-open">
            <UploadCloud className="mr-1 size-4" aria-hidden="true" />
            {t('knowledgeHub.actions.upload')}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6 md:flex-row">
        <FolderTreePanel
          tree={tree}
          currentFolderId={currentFolderId}
          onSelect={selectFolder}
        />

        <div className="min-w-0 flex-1">
          <Breadcrumb path={path} onNavigate={setCurrentFolderId} />

          {isPending ? (
            <TileSkeletons />
          ) : isError ? (
            <ErrorAlert onRetry={() => { foldersQuery.refetch(); filesQuery.refetch() }} />
          ) : hubEmpty ? (
            <TrueEmptyHero onUpload={openUpload} />
          ) : viewEmpty ? (
            <EmptyFolder />
          ) : (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="kh-tile-grid"
            >
              {subfolders.map((folder) => (
                <FolderTile
                  key={folder.id}
                  folder={folder}
                  pending={isOptimisticFolderId(folder.id)}
                  onOpen={() => selectFolder(folder.id)}
                  onRename={() => setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name })}
                  onMove={() =>
                    setMoveTarget({ kind: 'folder', id: folder.id, parentId: folder.parentFolderId })
                  }
                  onDelete={() => setDeleteTarget({ kind: 'folder', id: folder.id, name: folder.name })}
                />
              ))}
              {files.map((file) => (
                <FileTile
                  key={file.id}
                  file={file}
                  onOpen={() => navigate(`/knowledge-hub/files/${file.slug}`)}
                  onRename={() => setRenameTarget({ kind: 'file', id: file.id, name: file.name })}
                  onMove={() => setMoveTarget({ kind: 'file', id: file.id, parentId: file.folderId })}
                  onDelete={() => setDeleteTarget({ kind: 'file', id: file.id, name: file.name })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <UploadDialog
        folderId={currentFolderId}
        storageFull={storageFull}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={onUploaded}
      />

      {createOpen ? (
        <RenameDialog
          open
          titleKey="knowledgeHub.folder.createTitle"
          labelKey="knowledgeHub.folder.nameLabel"
          initialName=""
          pending={createFolder.isPending}
          onSubmit={(name) => {
            createFolder.mutate({ name, parentFolderId: currentFolderId })
            setCreateOpen(false)
          }}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}

      {renameTarget ? (
        <RenameDialog
          open
          titleKey={
            renameTarget.kind === 'folder'
              ? 'knowledgeHub.folder.renameTitle'
              : 'knowledgeHub.file.renameTitle'
          }
          labelKey="knowledgeHub.folder.nameLabel"
          initialName={renameTarget.name}
          pending={renameTarget.kind === 'folder' ? updateFolder.isPending : renameFile.isPending}
          onSubmit={(name) => {
            if (renameTarget.kind === 'folder') {
              updateFolder.mutate({ id: renameTarget.id, body: { name } })
            } else {
              renameFile.mutate({ id: renameTarget.id, name })
            }
            setRenameTarget(null)
          }}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {moveTarget ? (
        <MoveDialog
          open
          titleKey={
            moveTarget.kind === 'folder'
              ? 'knowledgeHub.move.folderTitle'
              : 'knowledgeHub.move.fileTitle'
          }
          targets={
            moveTarget.kind === 'folder'
              ? moveTargetsForFolder(folders, moveTarget.id)
              : folders
          }
          currentParentId={moveTarget.parentId}
          pending={moveTarget.kind === 'folder' ? updateFolder.isPending : moveFile.isPending}
          onSubmit={(target) => {
            if (moveTarget.kind === 'folder') {
              updateFolder.mutate({ id: moveTarget.id, body: { parentFolderId: target } })
            } else {
              moveFile.mutate({ id: moveTarget.id, targetFolderId: target })
            }
            setMoveTarget(null)
          }}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open
          kind={deleteTarget.kind}
          name={deleteTarget.name}
          pending={deleteTarget.kind === 'folder' ? deleteFolder.isPending : deleteFile.isPending}
          onConfirm={() => {
            if (deleteTarget.kind === 'folder') {
              deleteFolder.mutate(deleteTarget.id)
            } else {
              deleteFile.mutate(deleteTarget.id)
            }
            setDeleteTarget(null)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

// --- folder tree (left) ---

function FolderTreePanel({
  tree,
  currentFolderId,
  onSelect,
}: {
  tree: ReturnType<typeof buildFolderTree>
  currentFolderId: string | null
  onSelect: (id: string | null) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('knowledgeHub.tree.label')}
      className="w-full shrink-0 md:w-56"
      data-testid="kh-folder-tree"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={currentFolderId === null ? 'true' : undefined}
        className={treeRowClass(currentFolderId === null)}
        data-testid="kh-tree-root"
      >
        {t('knowledgeHub.tree.root')}
      </button>
      {tree.flatMap((node) => flattenTree(node)).map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => onSelect(node.id)}
          aria-current={currentFolderId === node.id ? 'true' : undefined}
          className={treeRowClass(currentFolderId === node.id)}
          style={{ paddingLeft: `${0.5 + node.depth * 0.75}rem` }}
          data-testid={`kh-tree-folder-${node.id}`}
        >
          <FolderIcon className="mr-1 inline size-3.5 text-slate-400" aria-hidden="true" />
          {node.name}
        </button>
      ))}
    </nav>
  )
}

function flattenTree(node: ReturnType<typeof buildFolderTree>[number]): typeof node[] {
  return [node, ...node.children.flatMap((child) => flattenTree(child))]
}

function treeRowClass(active: boolean): string {
  return `block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
    active ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'
  }`
}

// --- breadcrumb ---

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: FolderWire[]
  onNavigate: (id: string | null) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('knowledgeHub.breadcrumb.label')} className="mb-4 flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="text-slate-500 hover:text-slate-900"
        data-testid="kh-breadcrumb-root"
      >
        {t('knowledgeHub.tree.root')}
      </button>
      {path.map((folder) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-slate-300" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onNavigate(folder.id)}
            className="text-slate-500 hover:text-slate-900"
            data-testid={`kh-breadcrumb-${folder.id}`}
          >
            {folder.name}
          </button>
        </span>
      ))}
    </nav>
  )
}

// --- tiles ---

function TileActions({
  labelKey,
  onRename,
  onMove,
  onDelete,
  testid,
}: {
  labelKey: string
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  testid: string
}): ReactElement {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
        aria-label={t(labelKey)}
        data-testid={`${testid}-actions`}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename} data-testid={`${testid}-rename`}>
          {t('knowledgeHub.actions.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove} data-testid={`${testid}-move`}>
          {t('knowledgeHub.actions.move')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} data-testid={`${testid}-delete`}>
          {t('knowledgeHub.actions.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FolderTile({
  folder,
  pending = false,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderWire
  // True while the create is still optimistic — the id isn't a real server id,
  // so open/rename/move/delete are disabled until it settles.
  pending?: boolean
  onOpen: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}): ReactElement {
  return (
    <div
      className={`group flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:border-slate-300 ${
        pending ? 'opacity-60' : ''
      }`}
      data-testid={`kh-folder-tile-${folder.id}`}
      aria-busy={pending || undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
        data-testid={`kh-folder-open-${folder.id}`}
      >
        <FolderIcon className="size-6 shrink-0 text-[color:var(--cl-accent)]" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm font-medium text-slate-800">{folder.name}</span>
      </button>
      {pending ? null : (
        <TileActions
          labelKey="knowledgeHub.tile.folderActions"
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
          testid={`kh-folder-${folder.id}`}
        />
      )}
    </div>
  )
}

function FileTile({
  file,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  file: FileWire
  onOpen: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const kind = fileKindOf(file.contentType)
  return (
    <div
      className="group flex flex-col gap-2 rounded-lg border border-slate-200 p-3 hover:border-slate-300"
      data-testid={`kh-file-tile-${file.id}`}
    >
      <div className="flex items-start justify-between">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 items-center gap-2 text-left"
          data-testid={`kh-file-open-${file.id}`}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase text-white"
            style={{ backgroundColor: FILE_KIND_TINT[kind] }}
            aria-label={t(fileKindLabelKey(kind))}
          >
            {kind === 'other' ? '•' : kind}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-slate-800">{file.name}</span>
        </button>
        <TileActions
          labelKey="knowledgeHub.tile.fileActions"
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
          testid={`kh-file-${file.id}`}
        />
      </div>
      <p className="font-mono text-xs text-slate-400">{formatFileSize(file.sizeBytes, i18n.language)}</p>
    </div>
  )
}

// --- trilogy states ---

function TileSkeletons(): ReactElement {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      data-testid="kh-skeleton"
      role="status"
      aria-busy="true"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  )
}

function ErrorAlert({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      data-testid="kh-error"
    >
      <span>{t('knowledgeHub.error.body')}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('knowledgeHub.error.retry')}
      </Button>
    </div>
  )
}

function TrueEmptyHero({ onUpload }: { onUpload: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="kh-empty-hero"
    >
      <UploadCloud className="size-8 text-slate-400" aria-hidden="true" />
      <h2 className="font-fraunces text-xl text-slate-900">{t('knowledgeHub.empty.true.headline')}</h2>
      <p className="max-w-sm text-sm text-slate-500">{t('knowledgeHub.empty.true.body')}</p>
      <Button onClick={onUpload}>{t('knowledgeHub.empty.true.cta')}</Button>
    </div>
  )
}

function EmptyFolder(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-200 px-6 py-12 text-center"
      data-testid="kh-empty-folder"
    >
      <p className="text-sm font-medium text-slate-600">{t('knowledgeHub.empty.folder.headline')}</p>
      <p className="text-sm text-slate-400">{t('knowledgeHub.empty.folder.body')}</p>
    </div>
  )
}
