/**
 * ClassesPage — Story 3.1 (AC5/AC7/AC8). The `/classes` index (screen s07):
 * page-head with count → status tabs (upcoming|active|paused|ended with mono
 * counts) → list-table. Role-scoped: owner/admin see all center classes, a
 * teacher sees only their own (server-branched; the client keys the list cache
 * by scope so audiences don't share a slot).
 *
 * Loading/Empty/Error trilogy (UX-1): skeleton rows / s54 create-hero for the
 * truly-zero-classes case (a per-tab empty shows a quiet inline note, never the
 * hero) / inline role="alert" retry. Row click is inert this story — no
 * pointer affordance; interactivity attaches only to the status pill and the
 * Actions menu.
 */
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { MoreHorizontal } from 'lucide-react'
import { useRole } from '@/hooks/useRole'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useClasses, type ClassStatus, type ClassWire } from './api/useClasses'
import { useTransitionClassStatus } from './api/useTransitionClassStatus'
import type { ClassListScope } from './api/classesKeys'
import { ClassStatusPill } from './components/ClassStatusPill'
import { ClassFormDialog } from './components/ClassFormDialog'

const STATUS_TABS: readonly ClassStatus[] = [
  'upcoming',
  'active',
  'paused',
  'ended',
] as const

// Rows in these states are dimmed 0.7 per the shared list-table pattern
// (UX §5.6 / §6.5) — applies across s07/s10a/s15/etc; s07 is not special-cased.
const DIMMED_STATES: ReadonlySet<ClassStatus> = new Set(['upcoming', 'ended'])

// Read the session from the module-singleton query cache — the same source
// useRole() reads. In production the app's <QueryClientProvider> binds this
// exact singleton, so center/user/role stay consistent; in component tests the
// session is seeded on the singleton while a fresh provider client backs the
// data queries (Murat-INFO-2 pattern).
const SESSION_KEY_TUPLE = authKeys.session()

// Hoisted to stable module-level references so useSyncExternalStore does not
// unsubscribe+resubscribe to the whole QueryCache on every render (a fresh
// inline `subscribe` closure would — the CR-2-6 P1 footgun).
function subscribeToSessionCache(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notify)
}
function getSessionSnapshot(): Session | null {
  return queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null
}
function getSessionServerSnapshot(): Session | null {
  return null
}

function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(
    subscribeToSessionCache,
    getSessionSnapshot,
    getSessionServerSnapshot,
  )
}

export function ClassesPage(): ReactElement {
  const { t } = useTranslation()
  const role = useRole()
  const session = useSessionSnapshot()

  const centerId = session?.center?.id ?? null
  const scope: ClassListScope =
    role === 'teacher' ? `teacher:${session?.user?.id ?? 'self'}` : 'all'

  const classesQuery = useClasses(centerId, scope)
  const transition = useTransitionClassStatus(centerId ?? '')

  // Story 3.3 — the s20 "Use this template" affordance routes here with
  // `state.createWithTemplateId`; open the create dialog preselected on it.
  // CR-3-3 fix — capture the id ONCE into local state (lazy init), then clear
  // the router state below so it doesn't (a) re-open the dialog on refresh
  // (history.state survives reload) nor (b) re-preselect on a later manual
  // "New class". The preselect is reset when the dialog closes.
  const location = useLocation()
  const navigate = useNavigate()
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(
    () =>
      (location.state as { createWithTemplateId?: string } | null)
        ?.createWithTemplateId ?? null,
  )

  const [userTab, setUserTab] = useState<ClassStatus | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; cls: ClassWire | null }>(
    () => ({ open: initialTemplateId !== null, cls: null }),
  )
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(
    null,
  )

  useEffect(() => {
    // Consume the one-shot navigation state on mount so it does not survive a
    // page refresh. Router state lives in history.state, so a bare remount
    // would otherwise re-read it. Local `initialTemplateId` already captured it.
    if (location.state) {
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: null,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot consume on mount
  }, [])

  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data])
  const counts = useMemo(() => countByStatus(classes), [classes])
  // Default to the first status tab (in tab order) that has classes so the
  // user never lands on an empty tab; a manual selection overrides it.
  const defaultTab = useMemo(
    () => STATUS_TABS.find((s) => counts[s] > 0) ?? 'upcoming',
    [counts],
  )
  const activeTab = userTab ?? defaultTab
  const visible = useMemo(
    () => classes.filter((c) => c.status === activeTab),
    [classes, activeTab],
  )

  const scopeLabel =
    role === 'teacher'
      ? t('classes.scope.own')
      : t('classes.scope.all')

  function handleTransition(cls: ClassWire, next: ClassStatus): void {
    setRowError(null)
    transition.mutate(
      { id: cls.id, status: next },
      {
        onError: (err) =>
          setRowError({
            id: cls.id,
            message:
              err.message || t('classes.transition.errors.invalidTransition'),
          }),
      },
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="classes-page">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-2xl text-slate-900">
            {t('classes.sectionHeading')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('classes.countLabel', { count: classes.length })} · {scopeLabel}
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true, cls: null })}>
          {t('classes.createCta')}
        </Button>
      </header>

      <nav
        className="mb-4 flex gap-1 border-b border-slate-200"
        aria-label={t('classes.statusTabs.ariaLabel')}
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setUserTab(tab)}
            data-testid={`class-status-tab-${tab}`}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              activeTab === tab
                ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(`classes.statusTabs.${tab}`)}{' '}
            <span className="font-mono text-xs text-slate-400">
              {counts[tab]}
            </span>
          </button>
        ))}
      </nav>

      {classesQuery.isPending ? (
        <ClassRowSkeletons />
      ) : classesQuery.isError ? (
        <ErrorAlert onRetry={() => classesQuery.refetch()} message={t('classes.error.body')} retryLabel={t('classes.error.retry')} />
      ) : classes.length === 0 ? (
        <EmptyHero
          headline={t('classes.empty.headline')}
          body={t('classes.empty.body')}
          cta={t('classes.empty.cta')}
          onCta={() => setDialog({ open: true, cls: null })}
        />
      ) : visible.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
          data-testid="class-tab-empty"
        >
          {t('classes.emptyTab', { status: t(`classes.status.${activeTab}`) })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="classes-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.class')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.skill')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.schedule')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.students')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.sessions')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.status')}</th>
                <th className="py-2 pr-4 font-medium">{t('classes.table.columns.targetBand')}</th>
                <th className="py-2 font-medium">{t('classes.table.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((cls) => (
                <ClassRow
                  key={cls.id}
                  cls={cls}
                  dimmed={DIMMED_STATES.has(cls.status)}
                  rowError={rowError?.id === cls.id ? rowError.message : null}
                  onTransition={(next) => handleTransition(cls, next)}
                  onEdit={() => setDialog({ open: true, cls })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.open ? (
        <ClassFormDialog
          centerId={centerId ?? ''}
          initial={dialog.cls}
          initialTemplateId={dialog.cls === null ? initialTemplateId : null}
          onClose={() => {
            setDialog({ open: false, cls: null })
            setInitialTemplateId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function ClassRow({
  cls,
  dimmed,
  rowError,
  onTransition,
  onEdit,
}: {
  cls: ClassWire
  dimmed: boolean
  rowError: string | null
  onTransition: (next: ClassStatus) => void
  onEdit: () => void
}): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tileColor = cls.color ?? 'var(--cl-accent)'
  const initial = cls.name.trim().charAt(0).toUpperCase() || '?'
  // Story 3.2 (AC5) — the class name is now the detail link (closes 3.1 AC7's
  // deferral). The row stays otherwise inert: no full-row pointer/onClick;
  // interactivity is the name link, the status pill, and the Actions menu only.
  const detailPath = `/classes/${cls.id}/overview`

  return (
    <>
      <tr className={`border-b border-slate-100 ${dimmed ? 'opacity-70' : ''}`}>
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
              {cls.name}
            </Link>
          </div>
        </td>
        <td className="py-3 pr-4 text-slate-600">
          {cls.primarySkill ? t(`classes.skill.${cls.primarySkill}`) : '—'}
        </td>
        <td className="py-3 pr-4 font-mono text-xs text-slate-600">
          {cls.startDate ?? '—'}
        </td>
        <td className="py-3 pr-4">
          <span className="text-xs text-slate-300" data-testid="class-cell-students-dormant">
            {t('classes.table.comingSoon')}
          </span>
        </td>
        <td className="py-3 pr-4">
          <span className="text-xs text-slate-300" data-testid="class-cell-sessions-dormant">
            {t('classes.table.comingSoon')}
          </span>
        </td>
        <td className="py-3 pr-4">
          <ClassStatusPill status={cls.status} onTransition={onTransition} />
        </td>
        <td className="py-3 pr-4 text-slate-600">
          {cls.targetBand != null ? cls.targetBand.toFixed(1) : '—'}
        </td>
        <td className="py-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
              aria-label={t('classes.table.actionsFor', { name: cls.name })}
              data-testid={`class-actions-${cls.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(detailPath)}>
                {t('classes.detail.actions.viewDetails')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}>
                {t('classes.table.editCta')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {rowError ? (
        <tr>
          <td colSpan={8}>
            <p
              role="alert"
              className="mb-2 rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-xs text-[color:var(--cl-red)]"
            >
              {rowError}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function ClassRowSkeletons(): ReactElement {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="h-12 w-full"
          data-testid={`class-row-skeleton-${i}`}
        />
      ))}
    </div>
  )
}

function ErrorAlert({
  onRetry,
  message,
  retryLabel,
}: {
  onRetry: () => void
  message: string
  retryLabel: string
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
    >
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}

function EmptyHero({
  headline,
  body,
  cta,
  onCta,
}: {
  headline: string
  body: string
  cta: string
  onCta: () => void
}): ReactElement {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="classes-empty-hero"
    >
      <h2 className="font-fraunces text-xl text-slate-900">{headline}</h2>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
      <Button onClick={onCta}>{cta}</Button>
    </div>
  )
}

function countByStatus(classes: ClassWire[]): Record<ClassStatus, number> {
  const counts: Record<ClassStatus, number> = {
    upcoming: 0,
    active: 0,
    paused: 0,
    ended: 0,
  }
  for (const c of classes) counts[c.status] += 1
  return counts
}
