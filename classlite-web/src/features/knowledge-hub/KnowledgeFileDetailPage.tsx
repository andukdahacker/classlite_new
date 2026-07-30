/**
 * KnowledgeFileDetailPage — `/knowledge-hub/files/:slug` (Story 4.4b, AC5). Shows
 * a type-specific preview (with all AC5 fallbacks, delegated to FilePreview),
 * metadata (type / size / upload date via the TS-6 local date formatter), and
 * linked locations (sessions/exercises referencing the file). No view-rate
 * (deferred). The UX-1 trilogy wraps the whole page: skeleton / error+retry /
 * not-found. Route-gated owner/admin/teacher (see routes.tsx).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate, Link } from 'react-router'
import { ArrowLeft, FileText, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFileDetail, type LinkedLocation } from './api/useFileDetail'
import { FilePreview } from './components/FilePreview'
import { fileKindLabelKey, fileKindOf } from './lib/fileKind'
import { formatFileSize } from './lib/formatFileSize'
import { formatFileDate } from './lib/formatFileDate'

export function KnowledgeFileDetailPage(): ReactElement {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const params = useParams()
  const slug = params.slug ?? null
  const query = useFileDetail(slug)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6" data-testid="knowledge-file-detail-page">
      <button
        type="button"
        onClick={() => navigate('/knowledge-hub')}
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        data-testid="kh-detail-back"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('knowledgeHub.detail.back')}
      </button>

      {query.isPending ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <DetailError
          notFound={query.error.status === 404}
          onRetry={() => query.refetch()}
        />
      ) : (
        <DetailBody
          name={query.data.name}
          slug={query.data.slug}
          contentType={query.data.contentType}
          sizeBytes={query.data.sizeBytes}
          createdAt={query.data.createdAt}
          linkedLocations={query.data.linkedLocations}
          locale={i18n.language}
        />
      )}
    </div>
  )
}

function DetailBody({
  name,
  slug,
  contentType,
  sizeBytes,
  createdAt,
  linkedLocations,
  locale,
}: {
  name: string
  slug: string
  contentType: string
  sizeBytes: number
  createdAt: string
  linkedLocations: LinkedLocation[]
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  const kind = fileKindOf(contentType)
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <FileText className="size-6 text-slate-400" aria-hidden="true" />
        <h1 className="min-w-0 truncate font-fraunces text-2xl text-slate-900" data-testid="kh-detail-name">
          {name}
        </h1>
      </header>

      <FilePreview slug={slug} name={name} contentType={contentType} />

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-3" data-testid="kh-detail-meta">
        <MetaCell label={t('knowledgeHub.detail.type')} value={t(fileKindLabelKey(kind))} />
        <MetaCell label={t('knowledgeHub.detail.size')} value={formatFileSize(sizeBytes, locale)} />
        <MetaCell label={t('knowledgeHub.detail.uploaded')} value={formatFileDate(createdAt, locale)} />
      </dl>

      <section data-testid="kh-detail-links">
        <h2 className="mb-2 font-fraunces text-lg text-slate-900">{t('knowledgeHub.detail.usedIn')}</h2>
        {linkedLocations.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="kh-detail-links-empty">
            {t('knowledgeHub.detail.notUsed')}
          </p>
        ) : (
          <ul className="space-y-1">
            {linkedLocations.map((location) => (
              <li key={`${location.type}-${location.id}`}>
                <LinkedLocationRow location={location} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function LinkedLocationRow({ location }: { location: LinkedLocation }): ReactElement {
  const { t } = useTranslation()
  const href =
    location.type === 'exercise'
      ? `/exercises/${location.id}/edit`
      : `/schedule?session=${location.id}`
  return (
    <Link
      to={href}
      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 hover:bg-slate-200"
      data-testid={`kh-detail-link-${location.id}`}
    >
      <Link2 className="size-3.5" aria-hidden="true" />
      <span className="text-xs uppercase text-slate-400">{t(`knowledgeHub.detail.linkType.${location.type}`)}</span>
      <span className="min-w-0 truncate">{location.label}</span>
    </Link>
  )
}

function MetaCell({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function DetailSkeleton(): ReactElement {
  return (
    <div className="space-y-6" data-testid="kh-detail-skeleton" role="status" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  )
}

function DetailError({ notFound, onRetry }: { notFound: boolean; onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-6 py-12 text-center text-sm text-[color:var(--cl-red)]"
      data-testid="kh-detail-error"
    >
      <span>{notFound ? t('knowledgeHub.detail.notFound') : t('knowledgeHub.error.body')}</span>
      {notFound ? null : (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('knowledgeHub.error.retry')}
        </Button>
      )}
    </div>
  )
}
