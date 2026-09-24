/**
 * MyPerformanceContainer — the REAL student `s37` `/my-performance` view (Story
 * 8-3b, Task 1/2/4, AC4/AC11-13), replacing the 8-2b placeholder body. ONE
 * aggregate `useMyPerformance()` read (framing "student", peer fields stripped
 * server-side) → the trilogy (skeleton / inline alert + retry). Success composes a
 * mobile-real single-column glance: an above-fold overall-band hero, then a 2-tab
 * shell (Overview + softened "Focus areas"). The whole surface is softened via
 * `perf.framing` (never route/role) — no "mistakes" language, no red, no peer data.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMyPerformance } from '../api/useMyPerformance'
import { StudentPerformanceOverview } from './StudentPerformanceOverview'
import { StudentPatternsList } from './StudentPatternsList'
import { ShareSummaryButton } from './ShareSummaryButton'

const MIN_GRADED_FOR_PATTERNS = 3

export function MyPerformanceContainer(): ReactElement {
  const { t } = useTranslation()
  const query = useMyPerformance()

  if (query.isPending) return <DashboardSkeleton />
  if (query.isError) {
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
    <div
      data-testid="my-performance"
      className="mx-auto flex max-w-3xl flex-col gap-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--cl-ink)]">
          {t('analytics.myPerformance.title')}
        </h1>
        <ShareSummaryButton perf={perf} />
      </header>

      {belowThreshold ? (
        <p
          data-testid="my-performance-ghosted-banner"
          className="rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-muted)] px-3 py-2 text-sm text-[var(--cl-ink-soft)]"
        >
          {t('analytics.myPerformance.ghosted.banner')}
        </p>
      ) : null}

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="my-performance-tab-overview">
            {t('analytics.myPerformance.tab.overview')}
          </TabsTrigger>
          <TabsTrigger value="patterns" data-testid="my-performance-tab-patterns">
            {t('analytics.myPerformance.tab.patterns')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <StudentPerformanceOverview perf={perf} />
        </TabsContent>
        <TabsContent value="patterns">
          <StudentPatternsList
            patterns={perf.mistakePatterns.patterns}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
