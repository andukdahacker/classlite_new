/**
 * Knowledge Hub feature barrel (Story 4.4b). Public surface for cross-feature
 * imports (TS-7 — consumers import from '@/features/knowledge-hub', never deep
 * paths). The reusable picker + its mode contract are the main cross-feature
 * export (exercise audio / materials / AI topic seed seams); the storage
 * helpers back the Settings → Storage tab.
 */
export { KnowledgeHubPage } from './KnowledgeHubPage'
export { KnowledgeFileDetailPage } from './KnowledgeFileDetailPage'
export {
  KnowledgeHubPicker,
  type KnowledgeHubPickerMode,
} from './components/KnowledgeHubPicker'

export { useStorageUsage } from './api/useStorageUsage'
export { type FileWire } from './api/filesApi'

export { storageFullBodyKey } from './lib/storageCopy'
export {
  formatFileSize,
  isStorageFull,
  storagePercent,
} from './lib/formatFileSize'
export { fileKindOf, type FileKind } from './lib/fileKind'
