/**
 * StorageTab — Settings → Storage (Story 4.4b, AC7). A READ-ONLY usage display:
 * a used/limit meter + a role-split 100% "Storage full" state. The 80% / 95%
 * warning ladder and any plan-upgrade/purchase UI are deferred (Epic 9); this
 * tab only reads `GET /api/storage/usage`. Trilogy per UX-1.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/hooks/useRole'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useStorageUsage } from '@/features/knowledge-hub'
import {
  formatFileSize,
  isStorageFull,
  storagePercent,
} from '@/features/knowledge-hub'
import { storageFullBodyKey } from '@/features/knowledge-hub'

export function StorageTab({ centerId }: { centerId: string }): ReactElement {
  const { t, i18n } = useTranslation()
  const role = useRole()
  const query = useStorageUsage(centerId)

  if (query.isPending) {
    return (
      <div className="space-y-3" data-testid="storage-tab-skeleton" role="status" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
        data-testid="storage-tab-error"
      >
        <span>{t('knowledgeHub.error.body')}</span>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          {t('knowledgeHub.error.retry')}
        </Button>
      </div>
    )
  }

  const { usedBytes, limitBytes } = query.data
  const percent = storagePercent(usedBytes, limitBytes)
  const full = isStorageFull(usedBytes, limitBytes)

  return (
    <div className="max-w-xl space-y-4" data-testid="storage-tab">
      <div>
        <h2 className="font-fraunces text-lg text-slate-900">{t('knowledgeHub.storage.tab.heading')}</h2>
        <p className="mt-1 text-sm text-slate-500" data-testid="storage-usage-label">
          {t('knowledgeHub.storage.usage', {
            used: formatFileSize(usedBytes, i18n.language),
            limit: formatFileSize(limitBytes, i18n.language),
            percent,
          })}
        </p>
      </div>

      <div
        className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('knowledgeHub.storage.tab.heading')}
        data-testid="storage-meter"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${percent}%`,
            backgroundColor: full ? 'var(--cl-red)' : 'var(--cl-accent)',
          }}
        />
      </div>

      {full ? (
        <div
          className="space-y-1 rounded-md border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] px-4 py-3 text-sm"
          role="alert"
          data-testid="storage-full-state"
        >
          <p className="font-medium text-[color:var(--cl-amber)]">{t('knowledgeHub.storage.full.title')}</p>
          <p className="text-slate-600">{t(storageFullBodyKey(role))}</p>
        </div>
      ) : null}
    </div>
  )
}
