/**
 * SessionDetailPage — Story 3.5 (AC1/AC7/AC8). The `/sessions/:id` detail screen
 * (s12), deep-imported as its own Rolldown chunk. Owns the single useSession(id)
 * read (FW-1) and the UX-1 trilogy (skeleton / 404 / error) that resolves BEFORE
 * any content section mounts. Layout is a main column (session info → materials →
 * exercises → notes) + a 300–320px right rail (Actions card + the attendance
 * placeholder). Attendance sits LAST (right rail), never in the above-the-fold
 * slot (AC1). Edit/cancel reuse the existing SessionModal (3.4) — not rebuilt.
 */
import { useState, useSyncExternalStore, type ReactElement } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from '@/hooks/useRole'
import { queryClient } from '@/lib/query-client'
import { ApiError } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { useClasses, type ClassListScope } from '@/features/classes'
import { formatSessionDateTime, type SessionWire } from '@/features/schedule'
import { useSession } from '@/features/schedule'
import { SessionModal } from '@/features/schedule/components/SessionModal'
import { NotesSection } from './components/NotesSection'
import { MaterialsSection } from './components/MaterialsSection'
import { ExercisesSection } from './components/ExercisesSection'
import { AttendancePlaceholder } from './components/AttendancePlaceholder'

const NOT_FOUND_STATUS = 404

const SESSION_KEY_TUPLE = authKeys.session()
function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () => queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null,
    () => null,
  )
}

export function SessionDetailPage(): ReactElement {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const query = useSession(id)

  const role = useRole()
  const session = useSessionSnapshot()
  const centerId = session?.center?.id ?? null
  const scope: ClassListScope =
    role === 'teacher' ? `teacher:${session?.user?.id ?? 'self'}` : 'all'
  const classesQuery = useClasses(centerId, scope)

  const [modalOpen, setModalOpen] = useState(false)

  if (query.isPending) {
    return <DetailSkeleton />
  }
  if (query.isError) {
    const err = query.error
    if (err instanceof ApiError && err.status === NOT_FOUND_STATUS) {
      return <NotFoundCard />
    }
    return <ErrorState onRetry={() => query.refetch()} />
  }

  const detail = query.data.session

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="session-detail-page">
      <SessionDetailHead session={detail} locale={i18n.language} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <MaterialsSection sessionId={detail.id} />
          <ExercisesSection sessionId={detail.id} />
          <NotesSection sessionId={detail.id} />
        </div>

        <aside className="space-y-4">
          <div
            className="rounded-lg border border-dashed border-slate-300 p-4"
            data-testid="session-actions-card"
          >
            <h2 className="mb-2 font-fraunces text-base text-slate-900">
              {t('session.detail.actions.title')}
            </h2>
            <Button size="sm" className="w-full" onClick={() => setModalOpen(true)}>
              {t('session.detail.actions.edit')}
            </Button>
          </div>

          <AttendancePlaceholder />
        </aside>
      </div>

      {modalOpen && (
        <SessionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          classes={classesQuery.data ?? []}
          classesLoading={classesQuery.isLoading}
          classesError={classesQuery.isError}
          prefill={null}
          initial={detail}
          locale={i18n.language}
        />
      )}
    </div>
  )
}

function SessionDetailHead({
  session,
  locale,
}: {
  session: SessionWire
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  const tileColor = session.classColor ?? 'var(--cl-accent)'
  const isCancelled = session.status === 'cancelled'
  const isRecurring = session.recurrenceGroupId != null

  return (
    <header className="mb-6" data-testid="session-detail-head">
      <div className="flex items-start gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white"
          style={{ backgroundColor: tileColor }}
          aria-hidden="true"
        >
          {session.className.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-fraunces text-2xl text-slate-900">
              {session.topic ?? session.className}
            </h1>
            {isCancelled && (
              <span
                data-testid="session-cancelled-pill"
                className="rounded-full bg-[color:var(--cl-tint-red)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--cl-red)]"
              >
                {t('session.detail.head.cancelled')}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {session.className} · {formatSessionDateTime(session.startsAt, locale)}
          </p>
        </div>
      </div>

      {isRecurring && (
        <p
          data-testid="session-recurrence-banner"
          className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500"
        >
          {t('session.detail.head.recurrence')}
        </p>
      )}
    </header>
  )
}

function DetailSkeleton(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      data-testid="session-detail-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('session.detail.loading')}
    >
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function NotFoundCard(): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
        data-testid="session-detail-not-found"
      >
        <h1 className="font-fraunces text-xl text-slate-900">
          {t('session.detail.notFound.headline')}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {t('session.detail.notFound.body')}
        </p>
        <Link to="/schedule" className={buttonVariants()}>
          {t('session.detail.notFound.backCta')}
        </Link>
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div
        role="alert"
        data-testid="session-detail-error"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      >
        <span>{t('session.detail.error')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('session.detail.retry')}
        </Button>
      </div>
    </div>
  )
}
