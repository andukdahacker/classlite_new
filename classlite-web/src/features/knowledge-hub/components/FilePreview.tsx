/**
 * FilePreview — type-specific preview of a Knowledge Hub file with the mandatory
 * AC5 fallbacks (Story 4.4b). The preview needs a presigned GET URL, so it owns
 * the download-URL query and its own loading/error legs of the trilogy.
 *
 * Fallback matrix (AC5):
 *   - (a) SVG is rendered through an `<img>` — the browser never executes script
 *     in an image-loaded SVG, so an uploaded SVG bomb can't run (stored-XSS
 *     guard). We NEVER inline `<svg>` markup or use `<object>`/`<embed>` for it.
 *   - (b) WebM audio → "Download to play" when the browser can't decode it.
 *   - (c) PDF on a small screen → an Open button (thumbnail-less degraded
 *     fallback), not an inline paged viewer; desktop gets the inline `<embed>`.
 *   - (d) A universal "Preview unavailable — Download to view" whenever a preview
 *     can't render (unknown type, or the URL failed) — the Error leg of the
 *     preview pane. Metadata still renders in the parent detail page.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileWarning } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFileDownloadUrl } from '../api/useFileDownloadUrl'
import { fileKindOf, isWebmAudio } from '../lib/fileKind'

/** canPlayAudio reports whether the browser can decode a given audio MIME. Any
 * failure (SSR, jsdom's unimplemented media stub) is treated as "can't play", so
 * the honest "Download to play" fallback is what shows when in doubt. */
function canPlayAudio(contentType: string): boolean {
  try {
    if (typeof document === 'undefined') return false
    const probe = document.createElement('audio')
    return probe.canPlayType(contentType) !== ''
  } catch {
    return false
  }
}

interface FilePreviewProps {
  slug: string
  name: string
  contentType: string
}

export function FilePreview({ slug, name, contentType }: FilePreviewProps): ReactElement {
  const { t } = useTranslation()
  // Inline URL backs the preview tags; a separate attachment URL backs the
  // Download link so it forces a real download with the original filename (the
  // cross-origin `download` attribute is ignored) and never opens a stored SVG
  // inline as a document (AC5a stored-XSS guard).
  const query = useFileDownloadUrl(slug, true)
  const downloadQuery = useFileDownloadUrl(slug, true, 'attachment')
  const kind = fileKindOf(contentType)
  // Whether webm can decode is stable for the session — memoize the probe.
  const webmPlayable = useMemo(() => canPlayAudio(contentType), [contentType])
  // A media element whose src load fails (e.g. the 5-min signed URL expired
  // mid-view) drops back to the universal "Preview unavailable" leg instead of a
  // broken tag (AC5d). onError is a permitted DOM event use, not server state.
  const [mediaError, setMediaError] = useState(false)

  if (query.isPending) {
    return (
      <Skeleton
        className="h-64 w-full rounded-lg"
        data-testid="kh-preview-skeleton"
        role="status"
        aria-busy="true"
      />
    )
  }

  if (query.isError || !query.data) {
    return (
      <PreviewUnavailable
        message={t('knowledgeHub.preview.unavailable')}
        onRetry={() => {
          setMediaError(false)
          void query.refetch()
        }}
      />
    )
  }

  const url = query.data.url
  // Fall back to the inline URL if the attachment URL hasn't resolved yet — a
  // working link beats a dead one; the filename fix lands once it settles.
  const downloadUrl = downloadQuery.data?.url ?? url

  const download = (
    <a
      href={downloadUrl}
      download={name}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      data-testid="kh-preview-download"
    >
      <Download className="size-4" aria-hidden="true" />
      {t('knowledgeHub.preview.download')}
    </a>
  )

  return (
    <div className="space-y-3" data-testid="kh-preview">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {mediaError ? (
          <InlineNote
            testid="kh-preview-media-error"
            message={t('knowledgeHub.preview.unavailable')}
          />
        ) : (
          <PreviewBody
            kind={kind}
            url={url}
            name={name}
            contentType={contentType}
            webmPlayable={webmPlayable}
            onMediaError={() => setMediaError(true)}
          />
        )}
      </div>
      <div>{download}</div>
    </div>
  )
}

function PreviewBody({
  kind,
  url,
  name,
  contentType,
  webmPlayable,
  onMediaError,
}: {
  kind: ReturnType<typeof fileKindOf>
  url: string
  name: string
  contentType: string
  webmPlayable: boolean
  onMediaError: () => void
}): ReactElement {
  const { t } = useTranslation()

  // Image + SVG both render through <img> — never inline <svg> / <object>, so an
  // uploaded SVG cannot execute script (AC5a stored-XSS guard).
  if (kind === 'image' || kind === 'svg') {
    return (
      <img
        src={url}
        alt={name}
        onError={onMediaError}
        className="mx-auto max-h-[70vh] w-auto max-w-full"
        data-testid="kh-preview-image"
      />
    )
  }

  if (kind === 'audio') {
    if (isWebmAudio(contentType) && !webmPlayable) {
      return (
        <InlineNote testid="kh-preview-webm-fallback" message={t('knowledgeHub.preview.webmFallback')} />
      )
    }
    return (
      <audio controls src={url} onError={onMediaError} className="w-full" data-testid="kh-preview-audio">
        <track kind="captions" />
      </audio>
    )
  }

  if (kind === 'pdf') {
    return (
      <>
        {/* Desktop: inline viewer. */}
        <embed
          src={url}
          type="application/pdf"
          className="hidden h-[70vh] w-full md:block"
          data-testid="kh-preview-pdf"
        />
        {/* Small screens: no inline paged viewer — Open, not a broken embed (AC5c). */}
        <div className="flex items-center justify-center p-8 md:hidden" data-testid="kh-preview-pdf-mobile">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            {t('knowledgeHub.preview.openPdf')}
          </a>
        </div>
      </>
    )
  }

  // Unknown type — universal unavailable (AC5d).
  return <InlineNote testid="kh-preview-generic-unavailable" message={t('knowledgeHub.preview.unavailable')} />
}

function InlineNote({ message, testid }: { message: string; testid: string }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center" data-testid={testid}>
      <FileWarning className="size-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  )
}

function PreviewUnavailable({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-8 text-center"
      data-testid="kh-preview-unavailable"
      role="alert"
    >
      <FileWarning className="size-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm text-slate-500">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('knowledgeHub.error.retry')}
      </Button>
    </div>
  )
}
