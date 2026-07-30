/**
 * folderTree — pure helpers that turn the server's flat folder list into the
 * shapes the browser needs (Story 4.4b, AC1/AC2): a nested tree for the sidebar,
 * a root→node path for the breadcrumb, the direct children of a folder for the
 * tile grid, and the legal move targets for a folder (excluding itself + its
 * descendants, so the UI can't even offer a cycle — the server 422 is the
 * backstop). Every walk is descendant-guarded so a (corrupt) cycle can't hang
 * the render.
 */
import type { FolderWire } from '../api/foldersApi'

export interface FolderNode extends FolderWire {
  children: FolderNode[]
  depth: number
}

/** buildFolderTree composes the flat list into a depth-annotated forest. */
export function buildFolderTree(folders: FolderWire[]): FolderNode[] {
  const childrenByParent = new Map<string | null, FolderWire[]>()
  for (const folder of folders) {
    const list = childrenByParent.get(folder.parentFolderId) ?? []
    list.push(folder)
    childrenByParent.set(folder.parentFolderId, list)
  }
  childrenByParent.forEach((list) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
  })

  const seen = new Set<string>()
  const build = (parentId: string | null, depth: number): FolderNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .filter((folder) => !seen.has(folder.id))
      .map((folder) => {
        seen.add(folder.id)
        return { ...folder, depth, children: build(folder.id, depth + 1) }
      })

  return build(null, 0)
}

/** folderPath returns root→folder (inclusive) for the breadcrumb, or [] for root. */
export function folderPath(folders: FolderWire[], folderId: string | null): FolderWire[] {
  if (folderId === null) return []
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: FolderWire[] = []
  const guard = new Set<string>()
  let current = byId.get(folderId)
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    path.unshift(current)
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined
  }
  return path
}

/** childFolders returns the direct sub-folders of a folder (root = null). */
export function childFolders(folders: FolderWire[], folderId: string | null): FolderWire[] {
  return folders
    .filter((f) => f.parentFolderId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** descendantIdSet returns `folderId` + every folder nested beneath it. */
export function descendantIdSet(folders: FolderWire[], folderId: string): Set<string> {
  const childrenByParent = new Map<string | null, FolderWire[]>()
  for (const folder of folders) {
    const list = childrenByParent.get(folder.parentFolderId) ?? []
    list.push(folder)
    childrenByParent.set(folder.parentFolderId, list)
  }
  const collected = new Set<string>([folderId])
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const child of childrenByParent.get(current) ?? []) {
      if (!collected.has(child.id)) {
        collected.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return collected
}

/**
 * moveTargetsForFolder lists the folders a given folder may be reparented into:
 * everything except itself and its descendants (offering those would be an
 * instant cycle). The caller prepends a "root" option separately.
 */
export function moveTargetsForFolder(folders: FolderWire[], folderId: string): FolderWire[] {
  const forbidden = descendantIdSet(folders, folderId)
  return folders
    .filter((f) => !forbidden.has(f.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}
