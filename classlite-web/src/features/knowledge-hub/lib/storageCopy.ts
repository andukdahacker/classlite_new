/**
 * storageCopy — role-split copy for the storage-full state (Story 4.4b, AC7).
 * The owner can act on it (delete or upgrade); everyone else can only ask the
 * owner. Shared by the upload-seam block (UploadDialog) and the Settings →
 * Storage tab so the two never diverge (UX-3 role rendering).
 */
import type { Role } from '@/hooks/useRole'

/**
 * storageFullBodyKey returns the i18n key for the storage-full explanation.
 * Owner → upgrade/delete CTA copy; admin/teacher/student → ask-the-owner copy
 * (only the owner controls the plan).
 */
export function storageFullBodyKey(role: Role | null): string {
  return role === 'owner'
    ? 'knowledgeHub.storage.full.ownerBody'
    : 'knowledgeHub.storage.full.memberBody'
}
