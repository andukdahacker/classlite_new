/**
 * AnalyticsHome — the `s45` analytics-home content (Story 8-2b, Task 4, AC6-9).
 * A PRESENTATIONAL component over the already-fetched `AnalyticsHome` payload
 * (the container owns the fetch + three-state). It fills the pre-built 1d-4
 * `AnalyticsHomeShell` slot with one `ClassSummaryCard` per class, an inline
 * empty state, and — for owner/admin ONLY — the honest "Teacher performance —
 * coming soon" card.
 *
 * Role-branch is DOM ABSENCE, not CSS hide (R-A / TEST-FE-6): the owner-only
 * card renders only when `data.role` is an explicit `owner | admin` (an
 * ALLOWLIST, never `!== 'teacher'`), so an unresolved / null / undefined role
 * can never leak it. The ScopeBar is presentational (D15): scope is derived from
 * role (the non-active scopes are gated), the date range is a STATIC period
 * label, and the class-picker is the one live control (navigates).
 */
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AnalyticsHomeShell } from '@/components/domain/AnalyticsHomeShell'
import type { AnalyticsScope } from '@/components/domain/ScopeBar'
import type { Role } from '@/hooks/useRole'
import type { components } from '@/lib/api/client'
import { ClassSummaryCard } from './ClassSummaryCard'

type AnalyticsHomeData = components['schemas']['AnalyticsHome']

export interface AnalyticsHomeProps {
  data: AnalyticsHomeData
}

/** Owner/admin see center-wide; a teacher sees only their own classes (D7). */
function scopeForRole(role: AnalyticsHomeData['role']): AnalyticsScope {
  return role === 'owner' || role === 'admin' ? 'center-wide' : 'mine'
}

export function AnalyticsHome({ data }: AnalyticsHomeProps): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = data.role
  // Explicit ALLOWLIST — a null/undefined role can never render the owner card.
  const isOwnerOrAdmin = role === 'owner' || role === 'admin'
  const activeScope = scopeForRole(role)

  return (
    <AnalyticsHomeShell
      role={role as Role}
      titleKey="analytics.home.title"
      subKey="analytics.home.subtitle"
      scopeBar={{
        role: role as Role,
        activeScope,
        // D15 — presentational-honest: the scope renders as a static
        // role-derived label and the period as a static label, never a
        // toggle-looking pill or a dead date-range button (there is no scope to
        // switch and no date-range param in v1 — FU-8-2-D).
        presentational: true,
        selectedClassId: null,
        classOptions: data.classes.map((summary) => ({
          id: summary.classId,
          // Literal class name (user data), rendered verbatim — never an i18n key.
          label: summary.className,
        })),
        dateRange: { startIso: '', endIso: '' },
        dateRangeLabel: t('analytics.scope.period'),
        // The ONE live control: pick a class → navigate to its performance view.
        onClassChange: (classId) => {
          if (classId) navigate(`/analytics/class/${classId}`)
        },
      }}
    >
      {/* Desktop-only-by-design (AC24): a non-blocking hint that is VISIBLE
          below the md breakpoint and CSS-hidden (`md:hidden` → display:none) at
          or above it. The node stays in the DOM at all widths — assert
          visibility (`not.toBeVisible()`), not DOM-absence, at ≥md. */}
      <p
        data-testid="analytics-desktop-hint"
        className="col-span-full rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-surface)] px-3 py-2 text-xs text-[var(--cl-ink-soft)] md:hidden"
      >
        {t('analytics.desktopHint')}
      </p>
      {data.classes.length === 0 ? (
        <div
          data-testid="analytics-home-empty"
          className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--cl-border)] bg-[var(--cl-surface)] px-6 py-12 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            📊
          </span>
          <h2 className="text-base font-semibold text-[var(--cl-ink)]">
            {t('analytics.home.empty.headline')}
          </h2>
          {isOwnerOrAdmin ? (
            // Owner/admin can create classes → an actionable CTA (UX-1).
            <button
              type="button"
              onClick={() => navigate('/classes')}
              className="rounded-lg border border-[var(--cl-border)] px-3 py-1.5 text-sm font-medium text-[var(--cl-ink)] hover:border-[var(--cl-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('analytics.home.empty.action')}
            </button>
          ) : (
            // Teachers don't create classes (D12 / AC6a — role-appropriate): a
            // hint that assigned classes will appear here, no misleading CTA.
            <p
              data-testid="analytics-home-empty-teacher-hint"
              className="max-w-sm text-sm text-[var(--cl-ink-soft)]"
            >
              {t('analytics.home.empty.teacherHint')}
            </p>
          )}
        </div>
      ) : (
        <>
          {data.classes.map((summary) => (
            <ClassSummaryCard key={summary.classId} summary={summary} />
          ))}
          {isOwnerOrAdmin ? (
            <div
              data-testid="analytics-teacher-perf-card"
              className="flex flex-col items-start gap-2 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
            >
              <span className="text-base font-semibold text-[var(--cl-ink)]">
                {t('analytics.home.teacherPerf.title')}
              </span>
              <span className="text-sm text-[var(--cl-ink-soft)]">
                {t('analytics.home.teacherPerf.comingSoon')}
              </span>
              <span className="rounded-full bg-[var(--cl-muted)] px-2 py-0.5 text-xs text-[var(--cl-ink-soft)]">
                {t('analytics.home.teacherPerf.notVisibleTag')}
              </span>
            </div>
          ) : null}
        </>
      )}
    </AnalyticsHomeShell>
  )
}
