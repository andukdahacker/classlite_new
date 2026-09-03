/**
 * StaffDetailPage — Story 7.1b (Task 5, AC8-10, 15). The s40 tabbed detail shell:
 * a hand-rolled head (crumb-back + name h1 + StatusPill + meta) → a 6-up stat
 * strip → Overview/Classes/Schedule/Activity tabs (local state, mirroring the
 * `/classes/:id` precedent) → the dashed Owner-actions card.
 *
 * TEST-FE-6 (MANDATORY, the one security-adjacent assertion): the Owner-actions
 * card is rendered ONLY when `useRole() === 'owner'`. An Admin sees the detail
 * read-only and the card is ABSENT FROM THE DOM — not merely hidden. Gating in
 * the parent (here) rather than inside the card is what makes the negative-render
 * assertion (`queryByTestId('owner-actions')` is null) hold.
 *
 * The UX-1 trilogy wraps the whole shell (D2 component `useQuery`); a 404
 * STAFF_NOT_FOUND renders a not-found state (the 7-1a non-disclosure path), not
 * a crash.
 */
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadMeter } from '@/components/domain/LoadMeter'
import { StatusPill } from '@/components/domain/StatusPill'
import { useRole } from '@/hooks/useRole'
import { useStaffMemberDetail, type StaffMemberDetail } from './api/useStaff'
import { formatStaffDateTime } from './lib/formatStaffDate'
import { OwnerActionsCard } from './components/OwnerActionsCard'

const NOT_FOUND_STATUS = 404

type DetailTab = 'overview' | 'classes' | 'schedule' | 'activity'
const DETAIL_TABS: readonly DetailTab[] = [
  'overview',
  'classes',
  'schedule',
  'activity',
] as const

const STAFF_DETAIL_PANEL_ID = 'staff-detail-panel'

export function StaffDetailPage(): ReactElement {
  const { userId } = useParams()
  const query = useStaffMemberDetail(userId)

  if (query.isPending) {
    return <DetailSkeleton />
  }

  if (query.isError) {
    const err = query.error
    if (err instanceof ApiError && err.status === NOT_FOUND_STATUS) {
      return <NotFoundState />
    }
    return <ErrorState onRetry={() => query.refetch()} />
  }

  return <DetailBody detail={query.data} />
}

function DetailBody({ detail }: { detail: StaffMemberDetail }): ReactElement {
  const { t, i18n } = useTranslation()
  const role = useRole()
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')

  // Roving-tabindex refs so arrow keys move DOM focus to the newly-selected tab
  // (WAI-ARIA tabs pattern; mirrors the ClassDetailLayout precedent, CR-review P5).
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const currentIndex = DETAIL_TABS.indexOf(activeTab)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % DETAIL_TABS.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + DETAIL_TABS.length) % DETAIL_TABS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = DETAIL_TABS.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setActiveTab(DETAIL_TABS[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  const lastActive = detail.lastActiveAt
    ? formatStaffDateTime(detail.lastActiveAt, i18n.language)
    : t('people.staff.lastActive.never')

  const initial = detail.name.trim().charAt(0).toUpperCase() || '?'

  const stats = useMemo(
    () => [
      { label: t('people.staff.detail.stats.role'), value: t(`people.staff.role.${detail.role}`) },
      { label: t('people.staff.detail.stats.status'), value: t(`people.staff.status.${detail.status}`) },
      { label: t('people.staff.detail.stats.classes'), value: String(detail.assignedClasses.length) },
      {
        label: t('people.staff.detail.stats.load'),
        value: `${detail.load.nextSevenDaysSessionCount}/${detail.load.weeklyCapacity}`,
      },
      { label: t('people.staff.detail.stats.upcoming'), value: String(detail.scheduleGlance.length) },
      // The last-active value lives in the Overview tab (AC9); the strip's 6th
      // box uses the recent-activity count instead so the "—"/"never" token
      // renders exactly once on the page (dev-defined strip per Dev Notes).
      { label: t('people.staff.detail.stats.activity'), value: String(detail.recentActivity.length) },
    ],
    [detail, t],
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="staff-detail-page">
      <Link
        to="/people/staff"
        className="mb-4 inline-block text-sm text-[color:var(--cl-accent)] hover:underline"
      >
        {t('people.staff.detail.back')}
      </Link>

      <header className="mb-6 flex items-start gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[color:var(--cl-accent)] text-lg font-semibold text-white"
          aria-hidden="true"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-fraunces text-2xl text-slate-900">{detail.name}</h1>
            <StatusPill tone={detail.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {detail.email} · {t(`people.staff.role.${detail.role}`)}
          </p>
        </div>
      </header>

      <div
        className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        data-testid="staff-stat-strip"
      >
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-slate-200 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {stat.label}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <nav
        role="tablist"
        aria-label={t('people.staff.detail.tablistAria')}
        onKeyDown={handleTabsKeyDown}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200"
      >
        {DETAIL_TABS.map((tab, index) => {
          const selected = activeTab === tab
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              id={`staff-detail-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={STAFF_DETAIL_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                selected
                  ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t(`people.staff.detail.tabs.${tab}`)}
            </button>
          )
        })}
      </nav>

      <div
        id={STAFF_DETAIL_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`staff-detail-tab-${activeTab}`}
      >
        {activeTab === 'overview' ? <OverviewTab detail={detail} lastActive={lastActive} /> : null}
        {activeTab === 'classes' ? <ClassesTab detail={detail} /> : null}
        {activeTab === 'schedule' ? <ScheduleTab detail={detail} /> : null}
        {activeTab === 'activity' ? <ActivityTab detail={detail} /> : null}
      </div>

      {role === 'owner' ? <OwnerActionsCard detail={detail} /> : null}
    </div>
  )
}

function OverviewTab({
  detail,
  lastActive,
}: {
  detail: StaffMemberDetail
  lastActive: string
}): ReactElement {
  const { t } = useTranslation()
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Field label={t('people.staff.detail.overview.name')} value={detail.name} />
      <Field label={t('people.staff.detail.overview.email')} value={detail.email} />
      <Field
        label={t('people.staff.detail.overview.role')}
        value={t(`people.staff.role.${detail.role}`)}
      />
      <Field
        label={t('people.staff.detail.overview.language')}
        value={detail.languagePref}
      />
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">
          {t('people.staff.detail.overview.load')}
        </dt>
        <dd className="mt-1">
          <LoadMeter
            value={detail.load.nextSevenDaysSessionCount}
            capacity={detail.load.weeklyCapacity}
            heavy={detail.load.heavy}
          />
        </dd>
      </div>
      <Field label={t('people.staff.detail.overview.lastActive')} value={lastActive} />
    </dl>
  )
}

function ClassesTab({ detail }: { detail: StaffMemberDetail }): ReactElement {
  const { t } = useTranslation()
  if (detail.assignedClasses.length === 0) {
    return <EmptyTab testId="staff-classes-empty" message={t('people.staff.detail.classes.empty')} />
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {detail.assignedClasses.map((cls) => (
        <li key={cls.classId} className="px-3 py-2 text-sm text-slate-700">
          {cls.name}
        </li>
      ))}
    </ul>
  )
}

function ScheduleTab({ detail }: { detail: StaffMemberDetail }): ReactElement {
  const { t, i18n } = useTranslation()
  if (detail.scheduleGlance.length === 0) {
    return <EmptyTab testId="staff-schedule-empty" message={t('people.staff.detail.schedule.empty')} />
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {detail.scheduleGlance.map((item) => (
        <li key={item.sessionId} className="px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">{item.className}</span>{' '}
          <span className="font-mono text-xs text-slate-500">
            {formatStaffDateTime(item.startsAt, i18n.language)} —{' '}
            {formatStaffDateTime(item.endsAt, i18n.language)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ActivityTab({ detail }: { detail: StaffMemberDetail }): ReactElement {
  const { t, i18n } = useTranslation()
  if (detail.recentActivity.length === 0) {
    return <EmptyTab testId="staff-activity-empty" message={t('people.staff.detail.activity.empty')} />
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {detail.recentActivity.map((item, index) => (
        <li
          key={`${item.event}-${item.at}-${index}`}
          className="px-3 py-2 text-sm text-slate-700"
        >
          <span className="font-medium">{item.event}</span>{' '}
          <span className="text-xs text-slate-500">{item.entityType}</span>{' '}
          <span className="font-mono text-xs text-slate-400">
            {formatStaffDateTime(item.at, i18n.language)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  )
}

function EmptyTab({ testId, message }: { testId: string; message: string }): ReactElement {
  return (
    <p
      className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
      data-testid={testId}
    >
      {message}
    </p>
  )
}

function DetailSkeleton(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      data-testid="staff-detail-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('people.staff.detail.loading')}
    >
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="mb-6 h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function NotFoundState(): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
        data-testid="staff-not-found"
      >
        <h1 className="font-fraunces text-xl text-slate-900">
          {t('people.staff.detail.notFound.headline')}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {t('people.staff.detail.notFound.body')}
        </p>
        <Link to="/people/staff" className="text-sm text-[color:var(--cl-accent)] underline">
          {t('people.staff.detail.notFound.backCta')}
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
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      >
        <span>{t('people.staff.detail.error')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('people.staff.detail.retry')}
        </Button>
      </div>
    </div>
  )
}
