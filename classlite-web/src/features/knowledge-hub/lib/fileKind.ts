/**
 * fileKind — maps a Knowledge Hub file's Content-Type to a coarse kind used for
 * icon tinting, tile grouping, preview branching, and the picker `allowedTypes`
 * contract (Story 4.4b). The server allowlist (upload_allowlist.go) is the
 * source of truth for which Content-Types can ever reach the client, so the
 * mapping only needs to cover the seven allowlisted types; `other` is a
 * defensive catch-all that renders a generic document affordance.
 */
export type FileKind = 'pdf' | 'image' | 'svg' | 'audio' | 'other'

/** fileKindOf classifies a Content-Type into a {@link FileKind}. */
export function fileKindOf(contentType: string): FileKind {
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType === 'image/svg+xml') return 'svg'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'other'
}

/**
 * isWebmAudio flags `audio/webm`, the one audio type Safari/iOS can't decode in
 * an `<audio>` element — the AC5b "Download to play" preview fallback keys off
 * it.
 */
export function isWebmAudio(contentType: string): boolean {
  return contentType === 'audio/webm'
}

/**
 * FILE_KIND_TINT — CSS custom-property-backed tile/icon tints per kind, reusing
 * the project design tokens (never a raw hex, project-context Tailwind rule).
 * Returned as a `color` string for a `style={{ backgroundColor }}` on the icon
 * chip (the shadcn tiles use tokens the same way the exercise skill tiles do).
 */
export const FILE_KIND_TINT: Record<FileKind, string> = {
  pdf: 'var(--cl-red)',
  image: 'var(--cl-accent)',
  svg: 'var(--cl-accent-2)',
  audio: 'var(--cl-green)',
  other: 'var(--cl-muted)',
}

/** i18n key suffix for a kind's human label (`knowledgeHub.kind.<suffix>`). */
export function fileKindLabelKey(kind: FileKind): string {
  return `knowledgeHub.kind.${kind}`
}
