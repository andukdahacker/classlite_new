/**
 * MaterialsSection — Story 3.5 (AC4). Add / edit / delete link materials
 * (title + external URL). File upload is out of scope (R2 presign lands later);
 * materials are link-only, kind defaults to 'link'. Optimistic mutations (FW-2).
 */
import { useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useSessionMaterials,
  useCreateMaterial,
  useUpdateMaterial,
  useDeleteMaterial,
  type SessionMaterialWire,
} from '../api/sessionContentApi'
import { materialFormSchema, isHttpUrl, type MaterialFormValues } from '../lib/contentSchemas'
import { ContentSectionFrame } from './ContentSectionFrame'
import { useEditFocusReturn, isOptimisticId } from '../lib/rowState'

export function MaterialsSection({ sessionId }: { sessionId: string }): ReactElement {
  const { t } = useTranslation()
  const query = useSessionMaterials(sessionId)
  const create = useCreateMaterial(sessionId)
  const materials = query.data ?? []

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: { title: '', url: '' },
  })

  const onAdd = form.handleSubmit((values) => {
    create.mutate(
      { title: values.title, url: values.url },
      { onSuccess: () => form.reset({ title: '', url: '' }) },
    )
  })

  return (
    <ContentSectionFrame
      titleKey="session.materials.title"
      testid="session-materials"
      count={materials.length}
      isPending={query.isPending}
      isError={query.isError}
      isEmpty={materials.length === 0}
      onRetry={() => query.refetch()}
      emptyKey="session.materials.empty"
      addForm={
        <form onSubmit={onAdd} className="space-y-2" data-testid="session-materials-add-form">
          <Input
            {...form.register('title')}
            aria-label={t('session.materials.field.title')}
            placeholder={t('session.materials.field.titlePlaceholder')}
          />
          <Input
            {...form.register('url')}
            aria-label={t('session.materials.field.url')}
            placeholder={t('session.materials.field.urlPlaceholder')}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t('session.materials.add')}
            </Button>
          </div>
        </form>
      }
    >
      <ul className="space-y-2" data-testid="session-materials-list">
        {materials.map((material) => (
          <MaterialRow key={material.id} sessionId={sessionId} material={material} />
        ))}
      </ul>
    </ContentSectionFrame>
  )
}

function MaterialRow({
  sessionId,
  material,
}: {
  sessionId: string
  material: SessionMaterialWire
}): ReactElement {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const create = useCreateMaterial(sessionId)
  const update = useUpdateMaterial(sessionId)
  const remove = useDeleteMaterial(sessionId)
  const editTriggerRef = useEditFocusReturn(editing)
  const isOptimistic = isOptimisticId(material.id)
  // Guard the rendered href: never emit a non-http(s) scheme as a live link,
  // even if a legacy value slipped past the (now http-only) form validation.
  const safeUrl = isHttpUrl(material.url)

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: { title: material.title, url: material.url },
  })

  const onSave = form.handleSubmit((values) => {
    update.mutate(
      { id: material.id, body: { title: values.title, url: values.url } },
      { onSuccess: () => setEditing(false) },
    )
  })

  const onDelete = () => {
    remove.mutate(material.id, {
      onSuccess: () => {
        toast.success(t('session.detail.content.deleted'), {
          action: {
            label: t('session.detail.content.undo'),
            onClick: () => create.mutate({ title: material.title, url: material.url }),
          },
        })
      },
      onError: () => toast.error(t('session.detail.content.deleteError')),
    })
  }

  if (editing) {
    return (
      <li className="space-y-2 rounded-md border border-slate-200 p-2">
        <form onSubmit={onSave} className="space-y-2">
          <Input {...form.register('title')} autoFocus aria-label={t('session.materials.field.title')} />
          <Input {...form.register('url')} aria-label={t('session.materials.field.url')} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('session.detail.content.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {t('session.detail.content.save')}
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-slate-200 p-2" data-testid="session-material-row">
      {safeUrl ? (
        <a
          href={material.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate text-sm text-[color:var(--cl-accent)] underline"
        >
          {material.title}
        </a>
      ) : (
        <span className="min-w-0 truncate text-sm text-slate-700">{material.title}</span>
      )}
      <div className="flex shrink-0 gap-1">
        <Button ref={editTriggerRef} size="sm" variant="ghost" disabled={isOptimistic} onClick={() => setEditing(true)}>
          {t('session.detail.content.edit')}
        </Button>
        <Button size="sm" variant="ghost" disabled={isOptimistic || remove.isPending} onClick={onDelete}>
          {t('session.detail.content.delete')}
        </Button>
      </div>
    </li>
  )
}
