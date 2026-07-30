/**
 * knowledgeHubKeys — TS-3 query-key factory for the Knowledge Hub (Story 4.4b).
 *
 * Folders are a single flat list per center (the client composes the tree via
 * `parentFolderId`). Files are listed per-folder, so the file-list key carries
 * the folder id — `null` is the root pseudo-folder. Detail is keyed by slug (the
 * detail route param); storage usage is a center-level singleton.
 */
export const knowledgeHubKeys = {
  all: ['knowledge-hub'] as const,

  folders: (centerId: string) =>
    [...knowledgeHubKeys.all, 'folders', centerId] as const,

  files: () => [...knowledgeHubKeys.all, 'files'] as const,
  fileList: (centerId: string, folderId: string | null) =>
    [...knowledgeHubKeys.all, 'files', centerId, folderId ?? '__root__'] as const,
  fileDetail: (slug: string) =>
    [...knowledgeHubKeys.all, 'file-detail', slug] as const,

  storageUsage: (centerId: string) =>
    [...knowledgeHubKeys.all, 'storage-usage', centerId] as const,
} as const
