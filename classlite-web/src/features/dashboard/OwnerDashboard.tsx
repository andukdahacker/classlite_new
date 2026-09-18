/**
 * OwnerDashboard — the s48 center-pulse dashboard (Story 8-1b). ONE component
 * serves owner AND admin (D9): both roles populate the `owner` block, and no
 * material owner-only dashboard element exists in v1, so they render
 * identically. Mounted by `DashboardRoute` for role `owner` | `admin`.
 *
 * Surfaces (all from the single `useDashboard` payload — the page makes exactly
 * one fetch, D8):
 *   - a 4-up center-pulse `StatTile` row (`owner.pulse`, Geist Mono);
 *   - "Today across the center" (`owner.todaySessions`) with teacherName +
 *     enrolledCount, the in-progress session flagged live via serverTime (D16);
 *   - the pre-bundled "Needs your attention" card (`NeedsAttentionList` is NOT
 *     mounted — no second fetch). NO Q&A rail (D10); NO plan/seat capacity.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionCenter } from '@/hooks/useRole'
import { useDashboard } from '@/features/dashboard/api/useDashboard'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'
import { StatTile } from '@/features/dashboard/components/StatTile'
import { NeedsAttentionCard } from '@/features/dashboard/components/NeedsAttentionCard'
import { isLiveNow, zonedTimeLabel } from '@/features/dashboard/lib/dashboardTime'

const FALLBACK_TIMEZONE = 'UTC'

export function OwnerDashboard(): ReactElement {
  const { t } = useTranslation()
  const timezone = useSessionCenter()?.timezone ?? FALLBACK_TIMEZONE
  const query = useDashboard()

  // The `owner-dashboard` testid marks the LOADED dashboard, not the loading /
  // error shells — so `findByTestId('owner-dashboard')` resolves only once the
  // pulse + cards are actually in the DOM (the assert-absence spine relies on
  // this).
  if (query.isLoading) return <DashboardSkeleton />

  if (query.isError || query.data == null || query.data.data.owner == null) {
    return (
      <DashboardErrorAlert
        messageKey="dashboard.owner.errorMessage"
        retryLabelKey="dashboard.owner.retry"
        onRetry={() => void query.refetch()}
      />
    )
  }

  const { owner } = query.data.data
  const serverTime = query.data.meta.serverTime
  const { pulse, todaySessions, needsAttention } = owner

  return (
    <div data-testid="owner-dashboard" className="space-y-6">
      <h1 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
        {t('dashboard.owner.pulseTitle')}
      </h1>

      <section
        data-testid="owner-pulse"
        aria-label={t('dashboard.owner.pulseTitle')}
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <StatTile
          testId="pulse-stat-activeClasses"
          label={t('dashboard.owner.stat.activeClasses')}
          value={pulse.activeClasses}
        />
        <StatTile
          testId="pulse-stat-studentsEnrolled"
          label={t('dashboard.owner.stat.studentsEnrolled')}
          value={pulse.studentsEnrolled}
        />
        <StatTile
          testId="pulse-stat-staffActiveToday"
          label={t('dashboard.owner.stat.staffActiveToday')}
          value={pulse.staffActiveToday}
        />
        <StatTile
          testId="pulse-stat-sessionsThisWeek"
          label={t('dashboard.owner.stat.sessionsThisWeek')}
          value={pulse.sessionsThisWeek}
        />
      </section>

      <section
        data-testid="today-sessions"
        aria-label={t('dashboard.owner.todayTitle')}
        className="space-y-2"
      >
        <h2 className="text-sm font-semibold text-[var(--cl-ink)]">
          {t('dashboard.owner.todayTitle')}
        </h2>
        {todaySessions.length === 0 ? (
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('dashboard.owner.todayEmpty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {todaySessions.map((session) => {
              const live = isLiveNow(session.startsAt, session.endsAt, serverTime)
              return (
                <li
                  key={session.sessionId}
                  data-testid={live ? `session-live-${session.sessionId}` : undefined}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 ${
                    live
                      ? 'border-l-4 border-l-[var(--cl-amber)] bg-[var(--cl-tint-gold)]'
                      : 'border-[var(--cl-border)]'
                  }`}
                >
                  <span className="font-mono text-sm text-[var(--cl-ink)]">
                    {zonedTimeLabel(session.startsAt, timezone)}
                  </span>
                  <span className="font-medium text-[var(--cl-ink)]">
                    {session.className}
                  </span>
                  <span className="text-sm text-[var(--cl-ink-soft)]">
                    {session.teacherName}
                  </span>
                  <span className="text-sm text-[var(--cl-ink-soft)]">
                    {t('dashboard.owner.enrolledCount', {
                      count: session.enrolledCount ?? 0,
                    })}
                  </span>
                  {live ? (
                    <span className="rounded-full bg-[var(--cl-amber)] px-2 py-0.5 text-xs font-semibold text-[var(--cl-surface)]">
                      {t('dashboard.owner.liveNow')}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <NeedsAttentionCard needsAttention={needsAttention} />
    </div>
  )
}

export default OwnerDashboard
