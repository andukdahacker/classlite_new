/**
 * TemplateDetailPage — Story 3.3 (AC3). The template detail (screen s20,
 * `/classes/templates/:id`): class-info head (tile + name + band + skill +
 * session count + usedCount) + the ordered session blueprint (order / topic /
 * duration). Loading/Error trilogy + a 404 NotFoundCard for absent / soft-deleted
 * / cross-tenant-invisible templates (identical surface — no metadata leak).
 *
 * Actions: Edit + Delete for `scope:"center"` only; "Use this template" routes
 * to class creation with the template preselected (reuses the 3.1 prefill).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTemplate } from './api/useTemplate'
import { TemplateDeleteDialog } from './components/TemplateDeleteDialog'

const NOT_FOUND_STATUS = 404
// A malformed (non-UUID) id makes the API reject with 422 before it can 404;
// treat it as the same "no such template" surface rather than a retryable error
// (CR-3-3 fix — a generic ErrorState's Retry can never resolve a bad id).
const INVALID_ID_STATUS = 422

export default function TemplateDetailPage(): ReactElement {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const query = useTemplate(id)
  const [deleting, setDeleting] = useState(false)

  if (query.isPending) {
    return <DetailSkeleton />
  }
  if (query.isError) {
    const err = query.error
    if (
      err instanceof ApiError &&
      (err.status === NOT_FOUND_STATUS || err.status === INVALID_ID_STATUS)
    ) {
      return <NotFoundCard />
    }
    return <ErrorState onRetry={() => query.refetch()} />
  }

  const template = query.data
  const isCenter = template.scope === 'center'

  return (
    <div
      className="mx-auto w-full max-w-4xl px-4 py-6"
      data-testid="template-detail-page"
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white"
            style={{ backgroundColor: template.color ?? 'var(--cl-accent)' }}
            aria-hidden="true"
          >
            {template.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-fraunces text-2xl text-slate-900">
                {template.name}
              </h1>
              <Badge variant={isCenter ? 'secondary' : 'outline'}>
                {t(`classes.templates.scope.${template.scope}`)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {[
                t(`classes.skill.${template.primarySkill}`),
                t('classes.templates.detail.bandMeta', {
                  band: template.targetBand.toFixed(1),
                }),
                t('classes.templates.detail.sessionMeta', {
                  count: template.sessionCount,
                }),
                t('classes.templates.usedCount', { count: template.usedCount }),
              ].join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button
          onClick={() =>
            navigate('/classes', {
              state: { createWithTemplateId: template.id },
            })
          }
          data-testid="template-use-cta"
        >
          {t('classes.templates.detail.useCta')}
        </Button>
        {isCenter ? (
          <>
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/classes/templates/${template.id}/edit`)
              }
              data-testid="template-detail-edit"
            >
              {t('classes.templates.detail.editCta')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDeleting(true)}
              data-testid="template-detail-delete"
            >
              {t('classes.templates.detail.deleteCta')}
            </Button>
          </>
        ) : null}
      </div>

      <section className="rounded-lg border border-slate-200 p-5">
        <h2 className="mb-4 font-fraunces text-lg text-slate-900">
          {t('classes.templates.detail.blueprintHeading')}
        </h2>
        {template.sessions.length === 0 ? (
          <p className="text-sm text-slate-400">
            {t('classes.templates.detail.noSessions')}
          </p>
        ) : (
          <ol className="space-y-2" data-testid="template-blueprint">
            {template.sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-start gap-3 rounded-md border border-slate-100 p-3"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
                  {session.sessionOrder + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {session.title}
                  </p>
                  {session.description ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {session.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {session.duration != null
                    ? t('classes.templates.detail.durationMinutes', {
                        count: session.duration,
                      })
                    : t('classes.templates.detail.noDuration')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {deleting ? (
        <TemplateDeleteDialog
          templateId={template.id}
          templateName={template.name}
          usedCount={template.usedCount}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate('/classes/templates')}
        />
      ) : null}
    </div>
  )
}

function DetailSkeleton(): ReactElement {
  return (
    <div
      className="mx-auto w-full max-w-4xl px-4 py-6"
      data-testid="template-detail-skeleton"
      role="status"
      aria-busy="true"
    >
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function NotFoundCard(): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
        data-testid="template-detail-not-found"
      >
        <h1 className="font-fraunces text-xl text-slate-900">
          {t('classes.templates.detail.notFound.headline')}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {t('classes.templates.detail.notFound.body')}
        </p>
        <Link to="/classes/templates" className={buttonVariants()}>
          {t('classes.templates.detail.notFound.backCta')}
        </Link>
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      >
        <span>{t('classes.templates.error.body')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('classes.templates.error.retry')}
        </Button>
      </div>
    </div>
  )
}
