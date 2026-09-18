/**
 * StudentDashboard — the s29 student dashboard + s62 first-login welcome
 * (Story 8-1b). Root of the student lazy bundle group (mobile/4G students never
 * pull teacher/admin code). Mounted by `DashboardRoute` for role `student`.
 *
 * Read-only glance (D11/§8.4): a greeting, a week-strip glance over
 * `student.upcomingSessions`, and three rail cards — Due soon (countdown +
 * Continue-writing/Start deep-link, D15), Recent feedback (calmer treatment,
 * decline NEVER red per UX-DR22), My questions. NO management actions, NO
 * peer/classmate/class-average data anywhere. The s62 welcome is ADDITIVE — it
 * coexists with real data and is gated on a durable per-user flag (D12), never
 * empty-array inference.
 *
 * The single `useDashboard` fetch feeds every card; `meta.serverTime` drives the
 * countdown + "N ago" labels (D16).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSessionCenter, useSessionUser } from '@/hooks/useRole'
import { useDashboard } from '@/features/dashboard/api/useDashboard'
import { useStudentWelcome } from '@/features/dashboard/hooks/useStudentWelcome'
import { DashboardWeekStrip } from '@/features/dashboard/components/DashboardWeekStrip'
import { DashboardRailCard } from '@/features/dashboard/components/DashboardRailCard'
import { StudentWelcome } from '@/features/dashboard/components/StudentWelcome'
import {
  DueCountdown,
  FeedbackReleasedAge,
  QuestionAge,
} from '@/features/dashboard/components/DashboardTimeLabels'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'

const FALLBACK_TIMEZONE = 'UTC'
const ASSIGNMENTS_HREF = '/assignments'
const QUESTIONS_HREF = '/questions'

export default function StudentDashboard(): ReactElement {
  const { t } = useTranslation()
  const user = useSessionUser()
  const timezone = useSessionCenter()?.timezone ?? FALLBACK_TIMEZONE
  const query = useDashboard()
  const welcome = useStudentWelcome(user?.id ?? null)

  // The `student-dashboard` testid marks the LOADED dashboard, not the loading /
  // error shells — `findByTestId('student-dashboard')` must resolve only once
  // the cards (and the s62 welcome gate) are in the DOM.
  if (query.isLoading) return <DashboardSkeleton />

  if (query.isError || query.data == null || query.data.data.student == null) {
    return (
      <DashboardErrorAlert
        messageKey="dashboard.student.errorMessage"
        retryLabelKey="dashboard.student.retry"
        onRetry={() => void query.refetch()}
      />
    )
  }

  const { student } = query.data.data
  const serverTime = query.data.meta.serverTime
  const dueSoon = [...student.dueSoon].sort(
    (a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt),
  )
  const nextSessionLabel = student.upcomingSessions[0]?.className ?? null

  return (
    <div data-testid="student-dashboard" className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
          {t('dashboard.student.greeting', {
            name: user?.fullName ?? user?.email ?? '',
          })}
        </h1>
        <p className="text-sm text-[var(--cl-ink-soft)]">
          {t('dashboard.student.glanceDisclaimer')}
        </p>
      </header>

      {welcome.showWelcome ? (
        <StudentWelcome onDismiss={welcome.dismiss} nextSessionLabel={nextSessionLabel} />
      ) : null}

      <DashboardWeekStrip
        sessions={student.upcomingSessions}
        serverTime={serverTime}
        timezone={timezone}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <DashboardRailCard
          testId="rail-due-soon"
          title={t('dashboard.student.dueSoonTitle')}
          count={dueSoon.length}
          viewAllHref={ASSIGNMENTS_HREF}
          viewAllLabel={t('dashboard.student.viewAll')}
          isEmpty={dueSoon.length === 0}
          emptyMessage={t('dashboard.student.dueSoonEmpty')}
        >
          {dueSoon.map((item) => (
            <li
              key={item.assignmentId}
              className="flex flex-col gap-1 rounded-lg border border-[var(--cl-border)] p-2"
            >
              <span className="font-medium text-[var(--cl-ink)]">{item.title}</span>
              <div className="flex items-center gap-2 text-xs text-[var(--cl-ink-soft)]">
                <span lang="en" className="uppercase">
                  {item.skill}
                </span>
                <span>{item.className}</span>
                <DueCountdown
                  assignmentId={item.assignmentId}
                  deadlineAt={item.deadlineAt}
                  serverTime={serverTime}
                />
              </div>
              {item.submissionId != null ? (
                <Link
                  data-testid={`due-continue-${item.assignmentId}`}
                  to={`/assignments/${item.assignmentId}/write`}
                  onClick={welcome.dismiss}
                  className="text-sm font-medium text-[var(--cl-accent)] hover:underline"
                >
                  {t('dashboard.student.continueWriting')}
                </Link>
              ) : (
                <Link
                  data-testid={`due-start-${item.assignmentId}`}
                  to={`/assignments/${item.assignmentId}/attempt`}
                  onClick={welcome.dismiss}
                  className="text-sm font-medium text-[var(--cl-accent)] hover:underline"
                >
                  {t('dashboard.student.start')}
                </Link>
              )}
            </li>
          ))}
        </DashboardRailCard>

        <DashboardRailCard
          testId="rail-recent-feedback"
          title={t('dashboard.student.recentFeedbackTitle')}
          count={student.recentFeedback.length}
          viewAllHref={ASSIGNMENTS_HREF}
          viewAllLabel={t('dashboard.student.viewAll')}
          isEmpty={student.recentFeedback.length === 0}
          emptyMessage={t('dashboard.student.recentFeedbackEmpty')}
        >
          {student.recentFeedback.map((item) => (
            <li
              key={item.submissionId}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--cl-border)] p-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm text-[var(--cl-ink)]">
                  {item.assignmentTitle}
                </span>
                <FeedbackReleasedAge
                  submissionId={item.submissionId}
                  releasedAt={item.releasedAt}
                  serverTime={serverTime}
                />
              </div>
              <span className="font-mono text-sm text-[var(--cl-ink-soft)]">
                <span lang="en">{item.overallBand == null ? '—' : item.overallBand}</span>
              </span>
            </li>
          ))}
        </DashboardRailCard>

        <DashboardRailCard
          testId="rail-my-questions"
          title={t('dashboard.student.myQuestionsTitle')}
          count={student.myQuestions.length}
          viewAllHref={QUESTIONS_HREF}
          viewAllLabel={t('dashboard.student.viewAll')}
          isEmpty={student.myQuestions.length === 0}
          emptyMessage={t('dashboard.student.myQuestionsEmpty')}
        >
          {student.myQuestions.map((item) => (
            <li
              key={item.questionId}
              className="flex flex-col gap-1 rounded-lg border border-[var(--cl-border)] p-2"
            >
              <span className="text-sm text-[var(--cl-ink)]">{item.content}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--cl-ink-soft)]">
                  {t(`dashboard.student.questionStatus.${item.status}`, {
                    defaultValue: item.status,
                  })}
                </span>
                <QuestionAge
                  questionId={item.questionId}
                  createdAt={item.createdAt}
                  serverTime={serverTime}
                />
              </div>
            </li>
          ))}
        </DashboardRailCard>
      </div>
    </div>
  )
}
