/**
 * StudentPerformanceDetail — the teacher/owner/admin `s47` route view at
 * `/analytics/student/:id` (Story 8-3b, Task 1/2/3, AC1/AC3/AC5-10). ONE aggregate
 * `useStudentPerformance(id)` read, so the trilogy is: loading skeleton / 404
 * non-disclosure not-found / 403 permission / whole-view inline alert + retry
 * (AC24 — no partial-failure surface). Success composes a 2-TAB shell (Overview +
 * Mistakes — EXACTLY 2 tabs, Recommendations is Story 8-3c, NO headstone / D2),
 * the share-summary affordance, and an honest desktop hint on phone widths.
 */
import type { ReactElement } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api-fetch'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudentPerformance } from '../api/useStudentPerformance'
import { StudentPerformanceOverview } from './StudentPerformanceOverview'
import { StudentMistakesList } from './StudentMistakesList'
import { ShareSummaryButton } from './ShareSummaryButton'

const NOT_FOUND_STATUS = 404
const FORBIDDEN_STATUS = 403
const MIN_GRADED_FOR_PATTERNS = 3

export function StudentPerformanceDetail(): ReactElement {
  const { t } = useTranslation()
  const { id } = useParams()
  const query = useStudentPerformance(id ?? '')

  if (query.isPending) return <DashboardSkeleton />

  if (query.isError) {
    const status =
      query.error instanceof ApiError ? query.error.status : undefined
    if (status === NOT_FOUND_STATUS) {
      return (
        <div
          data-testid="student-perf-not-found"
          className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            🔍
          </span>
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('analytics.studentPerformance.notFound')}
          </p>
        </div>
      )
    }
    if (status === FORBIDDEN_STATUS) {
      return (
        <div
          data-testid="student-perf-forbidden"
          className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            🔒
          </span>
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('analytics.studentPerformance.forbidden')}
          </p>
        </div>
      )
    }
    return (
      <DashboardErrorAlert
        messageKey="analytics.error.message"
        retryLabelKey="analytics.error.retry"
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }

  const perf = query.data.data
  const belowThreshold =
    perf.submissionStats.gradedSubmissionCount < MIN_GRADED_FOR_PATTERNS

  return (
    <div className="flex flex-col gap-6">
      <p
        data-testid="student-perf-desktop-hint"
        className="rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-surface)] px-3 py-2 text-xs text-[var(--cl-ink-soft)] md:hidden"
      >
        {t('analytics.desktopHint')}
      </p>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-[var(--cl-ink)]">
            {perf.studentName}
          </h1>
          <span className="text-xs text-[var(--cl-ink-soft)]">
            {t('analytics.studentPerformance.title')}
          </span>
        </div>
        <ShareSummaryButton perf={perf} />
      </header>

      {belowThreshold ? (
        <p
          data-testid="student-perf-ghosted-banner"
          className="rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-muted)] px-3 py-2 text-sm text-[var(--cl-ink-soft)]"
        >
          {t('analytics.studentPerformance.ghosted.banner')}
        </p>
      ) : null}

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="student-perf-tab-overview">
            {t('analytics.studentPerformance.tab.overview')}
          </TabsTrigger>
          <TabsTrigger value="mistakes" data-testid="student-perf-tab-mistakes">
            {t('analytics.studentPerformance.tab.mistakes')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <StudentPerformanceOverview perf={perf} />
        </TabsContent>
        <TabsContent value="mistakes">
          <StudentMistakesList
            patterns={perf.mistakePatterns.patterns}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
