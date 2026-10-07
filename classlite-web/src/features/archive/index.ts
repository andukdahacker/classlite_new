/**
 * Archive feature barrel (Story 10.2). Public surface for cross-feature imports
 * (TS-7 — consumers import from '@/features/archive', never deep paths).
 */
export { ArchiveRoute } from './ArchiveRoute'
export { ArchiveView } from './components/ArchiveView'
export { useArchive, type ArchiveListResult } from './api/useArchive'
export { useDuplicateArchiveExercise } from './api/useDuplicateArchiveExercise'
export {
  archiveKeys,
  ARCHIVE_PAGE_SIZE,
  type ArchiveScope,
  type ArchiveTypeFilter,
  type ArchiveListParams,
} from './api/archiveKeys'
export { toArchiveRow, type ArchiveItem, type ArchiveRowData } from './lib/archiveMapping'
