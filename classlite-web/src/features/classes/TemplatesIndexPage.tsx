/**
 * TemplatesIndexPage — Story 3.3 (AC1/AC2). The templates management index
 * (screen s19, `/classes/templates`). Hand-rolled table mirroring
 * `ClassesPage.tsx:193-221` (the shared DataListTable is still deferred):
 * tile+name → skill → session count → "used N times" → scope badge → row
 * actions. Loading/Empty/Error trilogy (UX-1). Row actions are scope-gated —
 * Edit + Delete only for `scope:"center"` rows; system seeds are view-only (AC1).
 *
 * The route is gated owner+admin in routes.tsx (RouteRoleGate) — this page never
 * renders for a teacher (TEST-FE-6: the rows are ABSENT from the DOM, not hidden).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCenterId } from './lib/useCenterId'
import { useTemplates, type TemplateWire } from './api/useTemplates'
import { TemplateDeleteDialog } from './components/TemplateDeleteDialog'

export function TemplatesIndexPage(): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const centerId = useCenterId()
  const templatesQuery = useTemplates(centerId)
  const [deleting, setDeleting] = useState<TemplateWire | null>(null)

  const templates = templatesQuery.data ?? []

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      data-testid="templates-index-page"
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-2xl text-slate-900">
            {t('classes.templates.sectionHeading')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('classes.templates.countLabel', { count: templates.length })}
          </p>
        </div>
        <Button
          onClick={() => navigate('/classes/templates/new')}
          data-testid="template-new-cta"
        >
          {t('classes.templates.newCta')}
        </Button>
      </header>

      {templatesQuery.isPending ? (
        <TemplateRowSkeletons />
      ) : templatesQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
        >
          <span>{t('classes.templates.error.body')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => templatesQuery.refetch()}
          >
            {t('classes.templates.error.retry')}
          </Button>
        </div>
      ) : templates.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
          data-testid="templates-empty-hero"
        >
          <h2 className="font-fraunces text-xl text-slate-900">
            {t('classes.templates.empty.headline')}
          </h2>
          <p className="max-w-sm text-sm text-slate-500">
            {t('classes.templates.empty.body')}
          </p>
          <Button onClick={() => navigate('/classes/templates/new')}>
            {t('classes.templates.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="templates-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">
                  {t('classes.templates.table.columns.template')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('classes.templates.table.columns.skill')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('classes.templates.table.columns.sessions')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('classes.templates.table.columns.usedCount')}
                </th>
                <th className="py-2 pr-4 font-medium">
                  {t('classes.templates.table.columns.scope')}
                </th>
                <th className="py-2 font-medium">
                  {t('classes.templates.table.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <TemplateRow
                  key={tpl.id}
                  template={tpl}
                  onEdit={() =>
                    navigate(`/classes/templates/${tpl.id}/edit`)
                  }
                  onDelete={() => setDeleting(tpl)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting ? (
        <TemplateDeleteDialog
          templateId={deleting.id}
          templateName={deleting.name}
          usedCount={deleting.usedCount}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  )
}

function TemplateRow({
  template,
  onEdit,
  onDelete,
}: {
  template: TemplateWire
  onEdit: () => void
  onDelete: () => void
}): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tileColor = template.color ?? 'var(--cl-accent)'
  const initial = template.name.trim().charAt(0).toUpperCase() || '?'
  const isCenter = template.scope === 'center'
  const detailPath = `/classes/templates/${template.id}`

  return (
    <tr className="border-b border-slate-100">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold text-white"
            style={{ backgroundColor: tileColor }}
            aria-hidden="true"
          >
            {initial}
          </span>
          <Link
            to={detailPath}
            className="font-medium text-slate-900 hover:text-[color:var(--cl-accent)] hover:underline"
          >
            {template.name}
          </Link>
        </div>
      </td>
      <td className="py-3 pr-4 text-slate-600">
        {t(`classes.skill.${template.primarySkill}`)}
      </td>
      <td className="py-3 pr-4 text-slate-600">{template.sessionCount}</td>
      <td className="py-3 pr-4 text-slate-600" data-testid={`template-usedcount-${template.id}`}>
        {t('classes.templates.usedCount', { count: template.usedCount })}
      </td>
      <td className="py-3 pr-4">
        <Badge variant={isCenter ? 'secondary' : 'outline'}>
          {t(`classes.templates.scope.${template.scope}`)}
        </Badge>
      </td>
      <td className="py-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
            aria-label={t('classes.templates.table.actionsFor', {
              name: template.name,
            })}
            data-testid={`template-actions-${template.id}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(detailPath)}>
              {t('classes.templates.table.viewCta')}
            </DropdownMenuItem>
            {isCenter ? (
              <>
                <DropdownMenuItem
                  onSelect={onEdit}
                  data-testid={`template-edit-${template.id}`}
                >
                  {t('classes.templates.table.editCta')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onDelete}
                  data-testid={`template-delete-${template.id}`}
                >
                  {t('classes.templates.table.deleteCta')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}

function TemplateRowSkeletons(): ReactElement {
  // AC1 — skeleton rows mirror the loaded table's column shape (tile+name,
  // skill, sessions, usedCount, scope badge, actions), never a plain bar.
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {[0, 1, 2, 3].map((i) => (
            <tr
              key={i}
              className="border-t border-slate-100"
              data-testid={`template-row-skeleton-${i}`}
            >
              <td className="py-3 pr-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </td>
              <td className="py-3 pr-4">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="py-3 pr-4">
                <Skeleton className="h-4 w-8" />
              </td>
              <td className="py-3 pr-4">
                <Skeleton className="h-4 w-8" />
              </td>
              <td className="py-3 pr-4">
                <Skeleton className="h-5 w-16 rounded-full" />
              </td>
              <td className="py-3">
                <Skeleton className="h-8 w-8 rounded-md" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
