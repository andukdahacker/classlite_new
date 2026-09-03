/**
 * StaffListPage — Story 7.1b (Task 4, AC3-7). The s39 staff roster: page head
 * with an "Invite staff" CTA → All/Active/Pending/Archived tabs with client-side
 * mono counts → a list-table. Models on `ClassesPage` (tabs + `countByStatus` +
 * the UX-1 trilogy).
 *
 * The roster GET returns `{ members, pendingInvites }` (7-1a D3) — members
 * (active|archived) render in Active/Archived; pendingInvites render in Pending
 * with a dimmed `??` avatar and are non-navigable (no member detail exists yet,
 * AC7). Owners are excluded server-side; a note communicates it (AC6). The
 * default tab is the first (in order) with a non-zero count.
 *
 * Data fetch is a component `useQuery` (D2 — the app has zero loader-prefetch;
 * following the shipped convention, not introducing a lone loader). The
 * `?invite=new` deep-link opens the modal once on mount and clears the param.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadMeter } from '@/components/domain/LoadMeter'
import { StatusPill } from '@/components/domain/StatusPill'
import {
  useStaffRoster,
  type PendingInvite,
  type StaffMember,
} from './api/useStaff'
import { formatStaffDateTime } from './lib/formatStaffDate'
import { InviteStaffModal } from './components/InviteStaffModal'

type TabKey = 'all' | 'active' | 'pending' | 'archived'
const TAB_ORDER: readonly TabKey[] = ['all', 'active', 'pending', 'archived'] as const

const INVITE_DEEP_LINK_PARAM = 'invite'
const INVITE_DEEP_LINK_VALUE = 'new'

const STAFF_LIST_PANEL_ID = 'staff-list-panel'

export function StaffListPage(): ReactElement {
  const { t, i18n } = useTranslation()
  const rosterQuery = useStaffRoster()
  const [userTab, setUserTab] = useState<TabKey | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // Open state is seeded ONCE from the `?invite=new` deep-link via a lazy
  // initializer (not a setState-in-effect, which cascades renders — the app-wide
  // react-hooks/set-state-in-effect rule). The effect below only strips the
  // param (an external URL update), so a refresh doesn't re-open on remount.
  const [inviteOpen, setInviteOpen] = useState(
    () => searchParams.get(INVITE_DEEP_LINK_PARAM) === INVITE_DEEP_LINK_VALUE,
  )

  useEffect(() => {
    if (searchParams.get(INVITE_DEEP_LINK_PARAM) === INVITE_DEEP_LINK_VALUE) {
      const next = new URLSearchParams(searchParams)
      next.delete(INVITE_DEEP_LINK_PARAM)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot consume on mount
  }, [])

  const members = useMemo(
    () => rosterQuery.data?.members ?? [],
    [rosterQuery.data],
  )
  const pending = useMemo(
    () => rosterQuery.data?.pendingInvites ?? [],
    [rosterQuery.data],
  )

  const counts = useMemo<Record<TabKey, number>>(
    () => ({
      all: members.length + pending.length,
      active: members.filter((m) => m.status === 'active').length,
      pending: pending.length,
      archived: members.filter((m) => m.status === 'archived').length,
    }),
    [members, pending],
  )

  const defaultTab = useMemo<TabKey>(
    () => TAB_ORDER.find((k) => counts[k] > 0) ?? 'all',
    [counts],
  )
  const activeTab = userTab ?? defaultTab

  // Roving-tabindex refs (one per tab, in TAB_ORDER) so the arrow-key handler can
  // move DOM focus to the newly-selected tab (WAI-ARIA tabs pattern; mirrors the
  // shipped ClassDetailLayout precedent, CR-review P5).
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const currentIndex = TAB_ORDER.indexOf(activeTab)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % TAB_ORDER.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = TAB_ORDER.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setUserTab(TAB_ORDER[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  const visibleMembers = useMemo(() => {
    switch (activeTab) {
      case 'active':
        return members.filter((m) => m.status === 'active')
      case 'archived':
        return members.filter((m) => m.status === 'archived')
      case 'pending':
        return []
      default:
        return members
    }
  }, [activeTab, members])
  const visiblePending =
    activeTab === 'all' || activeTab === 'pending' ? pending : []

  const isEmpty =
    !rosterQuery.isPending &&
    !rosterQuery.isError &&
    members.length === 0 &&
    pending.length === 0

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="staff-list-page">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-2xl text-slate-900">
            {t('people.staff.list.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('people.staff.list.countLabel', { count: members.length })}
          </p>
        </div>
        {!isEmpty ? (
          <Button onClick={() => setInviteOpen(true)}>
            {t('people.staff.list.inviteCta')}
          </Button>
        ) : null}
      </header>

      {rosterQuery.isPending ? (
        <StaffRowSkeletons />
      ) : rosterQuery.isError ? (
        <ErrorAlert
          message={t('people.staff.list.error')}
          retryLabel={t('people.staff.list.retry')}
          onRetry={() => rosterQuery.refetch()}
        />
      ) : isEmpty ? (
        <EmptyState onInvite={() => setInviteOpen(true)} />
      ) : (
        <>
          <nav
            role="tablist"
            aria-label={t('people.staff.tabs.ariaLabel')}
            onKeyDown={handleTabsKeyDown}
            className="mb-4 flex gap-1 border-b border-slate-200"
          >
            {TAB_ORDER.map((tab, index) => {
              const selected = activeTab === tab
              return (
                <button
                  key={tab}
                  ref={(el) => {
                    tabRefs.current[index] = el
                  }}
                  id={`staff-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  aria-controls={STAFF_LIST_PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setUserTab(tab)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    selected
                      ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t(`people.staff.tabs.${tab}`)}{' '}
                  <span className="font-mono text-xs text-slate-400">
                    {counts[tab]}
                  </span>
                </button>
              )
            })}
          </nav>

          <div
            id={STAFF_LIST_PANEL_ID}
            role="tabpanel"
            aria-labelledby={`staff-tab-${activeTab}`}
            className="overflow-x-auto"
          >
            <table className="w-full text-sm" data-testid="staff-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">
                    {t('people.staff.table.columns.name')}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t('people.staff.table.columns.role')}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t('people.staff.table.columns.classes')}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t('people.staff.table.columns.load')}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t('people.staff.table.columns.status')}
                  </th>
                  <th className="py-2 font-medium">
                    {t('people.staff.table.columns.lastActive')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    locale={i18n.language}
                  />
                ))}
                {visiblePending.map((invite) => (
                  <PendingRow
                    key={invite.inviteId}
                    invite={invite}
                    locale={i18n.language}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p
            className="mt-3 text-xs text-slate-400"
            data-testid="owner-excluded-note"
          >
            {t('people.staff.list.ownerExcludedNote')}
          </p>
        </>
      )}

      {inviteOpen ? (
        <InviteStaffModal onClose={() => setInviteOpen(false)} />
      ) : null}
    </div>
  )
}

function MemberRow({
  member,
  locale,
}: {
  member: StaffMember
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  const initial = member.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <tr
      className="border-b border-slate-100"
      data-testid={`staff-row-${member.userId}`}
    >
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--cl-accent)] text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <Link
              to={`/people/staff/${member.userId}`}
              className="font-medium text-slate-900 hover:text-[color:var(--cl-accent)] hover:underline"
            >
              {member.name}
            </Link>
            <p className="font-mono text-xs text-slate-400">{member.email}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4">
        <Badge variant="outline" data-testid={`staff-role-${member.role}`}>
          {t(`people.staff.role.${member.role}`)}
        </Badge>
      </td>
      <td className="py-3 pr-4 text-slate-600">{member.classesAssigned}</td>
      <td className="py-3 pr-4">
        <LoadMeter
          value={member.load.nextSevenDaysSessionCount}
          capacity={member.load.weeklyCapacity}
          heavy={member.load.heavy}
        />
      </td>
      <td className="py-3 pr-4">
        <StatusPill tone={member.status} />
      </td>
      <td className="py-3 font-mono text-xs text-slate-600">
        {member.lastActiveAt
          ? formatStaffDateTime(member.lastActiveAt, locale)
          : t('people.staff.lastActive.never')}
      </td>
    </tr>
  )
}

function PendingRow({
  invite,
  locale,
}: {
  invite: PendingInvite
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  return (
    <tr
      className="border-b border-slate-100 opacity-70"
      data-testid={`pending-invite-row-${invite.inviteId}`}
    >
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-200 text-xs font-semibold text-slate-400"
            aria-hidden="true"
          >
            ??
          </span>
          <div className="min-w-0">
            <p className="font-medium text-slate-500">
              {invite.name ?? invite.email}
            </p>
            <p className="font-mono text-xs text-slate-400">{invite.email}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4">
        <Badge variant="outline" data-testid={`staff-role-${invite.role}`}>
          {t(`people.staff.role.${invite.role}`)}
        </Badge>
      </td>
      <td className="py-3 pr-4 text-slate-400">—</td>
      <td className="py-3 pr-4 text-slate-400">—</td>
      <td className="py-3 pr-4">
        <StatusPill tone="pending" />
      </td>
      <td className="py-3 font-mono text-xs text-slate-400">
        {t('people.staff.pending.expiresAt', {
          date: formatStaffDateTime(invite.expiresAt, locale),
        })}
      </td>
    </tr>
  )
}

function StaffRowSkeletons(): ReactElement {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="h-12 w-full"
          data-testid={`staff-row-skeleton-${i}`}
        />
      ))}
    </div>
  )
}

function ErrorAlert({
  message,
  retryLabel,
  onRetry,
}: {
  message: string
  retryLabel: string
  onRetry: () => void
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

function EmptyState({ onInvite }: { onInvite: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="staff-empty"
    >
      <h2 className="font-fraunces text-xl text-slate-900">
        {t('people.staff.empty.headline')}
      </h2>
      <p className="max-w-sm text-sm text-slate-500">
        {t('people.staff.empty.body')}
      </p>
      <Button onClick={onInvite}>{t('people.staff.list.inviteCta')}</Button>
      <p className="mt-2 text-xs text-slate-400" data-testid="owner-excluded-note">
        {t('people.staff.list.ownerExcludedNote')}
      </p>
    </div>
  )
}
