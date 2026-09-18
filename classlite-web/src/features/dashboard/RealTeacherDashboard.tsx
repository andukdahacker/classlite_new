/**
 * RealTeacherDashboard — the s06 teaching dashboard shown once a teacher's
 * onboarding is complete (Story 8-1b, D2). Mounted by `TeacherDashboard` in
 * place of the Epic-2 persona-preview bodies; the onboarding-incomplete shell
 * (WelcomeBackBanner / FinishSetupCard) is preserved and owns the pre-done
 * states.
 *
 * A `DashboardWeekStrip` over `teacher.weekSessions` + three rails in order —
 * Needs grading (overdue flag server-computed, D16) · Unanswered questions
 * ("N ago" via serverTime) · At-risk students (`PerfPill tone="at-risk"` +
 * reasons i18n, D6). Read-only glance: each rail's "View all →" routes OUT
 * (D11), no inline grading/reply. Owns the UX-1 trilogy over the single
 * `useDashboard` fetch.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionCenter, useSessionUser } from '@/hooks/useRole'
import { useDashboard } from '@/features/dashboard/api/useDashboard'
import { DashboardWeekStrip } from '@/features/dashboard/components/DashboardWeekStrip'
import { DashboardRailCard } from '@/features/dashboard/components/DashboardRailCard'
import { AtRiskRow } from '@/features/dashboard/components/AtRiskRow'
import { QuestionAge } from '@/features/dashboard/components/DashboardTimeLabels'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'
import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import type {
  ChecklistCtx,
  Persona,
} from '@/features/dashboard/lib/checklistDefinition'

const FALLBACK_TIMEZONE = 'UTC'
const GRADING_HREF = '/assignments'
const QUESTIONS_HREF = '/questions'
const ROSTER_HREF = '/students'

export interface RealTeacherDashboardProps {
  /** Onboarding persona — drives the secondary finish-setup checklist strip. */
  persona?: Persona | null
  /** Checklist context (center · templateDraft · teachersInvitedCount). */
  checklistCtx?: ChecklistCtx | null
}

export function RealTeacherDashboard({
  persona = null,
  checklistCtx = null,
}: RealTeacherDashboardProps = {}): ReactElement {
  const { t } = useTranslation()
  const user = useSessionUser()
  const timezone = useSessionCenter()?.timezone ?? FALLBACK_TIMEZONE
  const query = useDashboard()

  if (query.isLoading) return <DashboardSkeleton />

  if (query.isError || query.data == null || query.data.data.teacher == null) {
    return (
      <DashboardErrorAlert
        messageKey="dashboard.teacher.errorMessage"
        retryLabelKey="dashboard.teacher.retry"
        onRetry={() => void query.refetch()}
      />
    )
  }

  const { teacher } = query.data.data
  const serverTime = query.data.meta.serverTime
  const viewAll = t('dashboard.teacher.viewAll')

  return (
    <div data-testid="teacher-dashboard" className="space-y-6">
      <h1
        data-testid="teacher-dashboard-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        {t('dashboard.welcomeHeading', {
          name: user?.fullName ?? user?.email ?? '',
        })}
      </h1>

      <DashboardWeekStrip
        sessions={teacher.weekSessions}
        serverTime={serverTime}
        timezone={timezone}
        anchor="week"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <DashboardRailCard
          testId="rail-needs-grading"
          title={t('dashboard.teacher.needsGradingTitle')}
          count={teacher.needsGrading.count}
          viewAllHref={GRADING_HREF}
          viewAllLabel={viewAll}
          isEmpty={teacher.needsGrading.items.length === 0}
          emptyMessage={t('dashboard.teacher.needsGradingEmpty')}
        >
          {teacher.needsGrading.items.map((item) => (
            <li
              key={item.submissionId}
              data-overdue={String(item.overdue)}
              className="flex flex-col gap-0.5 rounded-lg border border-[var(--cl-border)] p-2"
            >
              <span className="font-medium text-[var(--cl-ink)]">
                {item.studentName}
              </span>
              <span className="text-xs text-[var(--cl-ink-soft)]">
                {item.assignmentTitle} · {item.className}
              </span>
              {item.overdue ? (
                <span className="text-xs font-semibold text-[var(--cl-red)]">
                  {t('dashboard.teacher.overdue')}
                </span>
              ) : null}
            </li>
          ))}
        </DashboardRailCard>

        <DashboardRailCard
          testId="rail-unanswered-questions"
          title={t('dashboard.teacher.unansweredTitle')}
          count={teacher.unansweredQuestions.count}
          viewAllHref={QUESTIONS_HREF}
          viewAllLabel={viewAll}
          isEmpty={teacher.unansweredQuestions.items.length === 0}
          emptyMessage={t('dashboard.teacher.unansweredEmpty')}
        >
          {teacher.unansweredQuestions.items.map((item) => (
            <li
              key={item.questionId}
              className="flex flex-col gap-0.5 rounded-lg border border-[var(--cl-border)] p-2"
            >
              <span className="text-sm text-[var(--cl-ink)]">{item.content}</span>
              {item.anchorExcerpt ? (
                <span className="truncate text-xs italic text-[var(--cl-ink-soft)]">
                  {item.anchorExcerpt}
                </span>
              ) : null}
              <span className="text-xs font-medium text-[var(--cl-ink-soft)]">
                {item.className}
              </span>
              <QuestionAge
                questionId={item.questionId}
                createdAt={item.createdAt}
                serverTime={serverTime}
              />
            </li>
          ))}
        </DashboardRailCard>

        <DashboardRailCard
          testId="rail-at-risk"
          title={t('dashboard.teacher.atRiskTitle')}
          count={teacher.atRiskStudents.count}
          viewAllHref={ROSTER_HREF}
          viewAllLabel={viewAll}
          isEmpty={teacher.atRiskStudents.items.length === 0}
          emptyMessage={t('dashboard.teacher.atRiskEmpty')}
        >
          {teacher.atRiskStudents.items.map((item) => (
            <AtRiskRow key={item.studentId} item={item} />
          ))}
        </DashboardRailCard>
      </div>

      <p className="text-xs text-[var(--cl-ink-soft)]">
        {t('dashboard.teacher.glanceDisclaimer')}
      </p>

      {/* Secondary finish-setup strip (Ducdo 2026-09-16): the Epic-2 checklist
          coexists with the real dashboard once onboarding is complete, rather
          than disappearing. FinishSetupCard self-hides when snoozed or when the
          center is absent, so it only shows while there is setup left to nudge. */}
      {persona !== null && checklistCtx !== null ? (
        <FinishSetupCard
          persona={persona}
          userId={user?.id ?? null}
          ctx={checklistCtx}
        />
      ) : null}
    </div>
  )
}
