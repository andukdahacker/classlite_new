/**
 * StudentDetailPage — Story 7.2b (Task 5, AC11-14). The shared s10 student
 * detail, class-agnostic over the whole-student `GET /api/students/{id}` (D1,
 * Ducdo ruling): a hand-rolled head (crumb-back + avatar + name h1 + inline
 * PerfPill + at-risk reasons + meta) → a 6-up stat strip → a perf-card
 * (`BandScoreChart` + `SkillPerfBars`) → the enrolled-classes list → the
 * teacher-notes panel. Mounted at BOTH `/students/:id` (teacher) and
 * `/people/students/:id` (owner/admin); a 404 `STUDENT_NOT_FOUND` renders a
 * not-found state (the teacher out-of-scope non-disclosure surface, 7-2a D11),
 * never a crash. Models on `StaffDetailPage` (D2 component `useQuery`, UX-1
 * trilogy, ApiError-404 → not-found split).
 *
 * Scope is notes-only (D14): NO enrollment Actions card / Share / PDF /
 * inquiries / projection / Message CTA / BandTrendSparkline — all deferred.
 */
import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BandScoreChart } from '@/components/domain/BandScoreChart'
import { SkillPerfBars } from '@/components/domain/SkillPerfBars'
import { PerfPill } from '@/components/domain/PerfPill'
import { perfToneFromStatus } from '@/components/domain/perfTone'
import { useRole } from '@/hooks/useRole'
import {
  useStudentDetail,
  type StudentDetail,
  type StudentDetailClass,
} from './api/useStudents'
import { formatStaffDateTime } from './lib/formatStaffDate'
import { StudentNotesPanel } from './components/StudentNotesPanel'

const NOT_FOUND_STATUS = 404
const PERCENT = 100

/** Reason slug → i18n key camelCase segment (D12/AC14). */
const REASON_KEY: Record<string, string> = {
  attendance_below_floor: 'attendanceBelowFloor',
  consecutive_missed: 'consecutiveMissed',
  band_drop: 'bandDrop',
}

function maxTargetBand(classes: StudentDetailClass[]): number | null {
  const targets = classes
    .map((cls) => cls.targetBand)
    .filter((band): band is number => band !== null)
  return targets.length > 0 ? Math.max(...targets) : null
}

export function StudentDetailPage(): ReactElement {
  const { id } = useParams()
  const query = useStudentDetail(id)

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
  return <DetailBody detail={query.data} studentId={id ?? ''} />
}

function DetailBody({
  detail,
  studentId,
}: {
  detail: StudentDetail
  studentId: string
}): ReactElement {
  const { t, i18n } = useTranslation()
  const role = useRole()
  const backTo = role === 'teacher' ? '/students' : '/people/students'

  const { profile, performanceSummary, atRisk, enrolledClasses, notes } = detail
  const targetBand = useMemo(() => maxTargetBand(enrolledClasses), [enrolledClasses])
  const initial = profile.name.trim().charAt(0).toUpperCase() || '?'

  const percent = (rate: number | null): string =>
    rate !== null ? `${Math.round(rate * PERCENT)}%` : t('people.student.band.empty')
  const band = (value: number | null): string =>
    value !== null ? value.toFixed(1) : t('people.student.band.empty')

  const stats = useMemo(
    () => [
      { label: t('people.student.detail.stats.attendance'), value: percent(performanceSummary.attendanceRate) },
      { label: t('people.student.detail.stats.avgBand'), value: band(performanceSummary.overallBand) },
      { label: t('people.student.detail.stats.pending'), value: String(performanceSummary.pendingCount) },
      { label: t('people.student.detail.stats.missing'), value: String(performanceSummary.missingCount) },
      { label: t('people.student.detail.stats.onTime'), value: percent(performanceSummary.onTimeRate) },
      { label: t('people.student.detail.stats.classes'), value: String(enrolledClasses.length) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- percent/band are pure locals over t
    [performanceSummary, enrolledClasses, t],
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="student-detail-page">
      <Link
        to={backTo}
        className="mb-4 inline-block text-sm text-[color:var(--cl-accent)] hover:underline"
      >
        {t('people.student.detail.back')}
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
            <h1 className="font-fraunces text-2xl text-slate-900">{profile.name}</h1>
            <PerfPill tone={perfToneFromStatus(atRisk.status)} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {profile.email} · {formatStaffDateTime(profile.joinedAt, i18n.language)} ·{' '}
            {targetBand !== null
              ? t('people.student.detail.meta.target', { band: targetBand.toFixed(1) })
              : t('people.student.detail.meta.noTarget')}
          </p>
          {atRisk.reasons.length > 0 ? (
            <ul
              data-testid="student-at-risk-reasons"
              className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--cl-red)]"
              aria-label={t('people.student.detail.atRisk.label')}
            >
              {atRisk.reasons.map((reason) => (
                <li key={reason} className="rounded bg-[color:var(--cl-tint-red)] px-2 py-0.5">
                  {REASON_KEY[reason]
                    ? t(`people.student.atRisk.reason.${REASON_KEY[reason]}`)
                    : reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div
        className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        data-testid="student-stat-strip"
        aria-label={t('people.student.detail.statStripAria')}
      >
        {stats.map((stat) => (
          <div
            key={stat.label}
            role="group"
            aria-label={stat.label}
            className="rounded-md border border-slate-200 p-3"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 font-fraunces text-lg text-slate-900">
            {t('people.student.detail.perfCard.heading')}
          </h2>
          <BandScoreChart
            overallBand={performanceSummary.overallBand}
            currentVsFirstDelta={performanceSummary.currentVsFirstDelta}
            targetBand={targetBand}
          />
          <p className="mt-4 mb-2 text-xs uppercase tracking-wide text-slate-400">
            {t('people.student.band.skillsHeading')}
          </p>
          <SkillPerfBars perSkill={performanceSummary.perSkill} />
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 font-fraunces text-lg text-slate-900">
            {t('people.student.detail.enrolledClasses.heading')}
          </h2>
          {enrolledClasses.length === 0 ? (
            <p
              data-testid="student-classes-empty"
              className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
            >
              {t('people.student.detail.enrolledClasses.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {enrolledClasses.map((cls) => (
                <li key={cls.classId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-800">{cls.className}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {cls.teacherName ?? '—'}
                    {cls.targetBand !== null
                      ? ` · ${t('people.student.detail.enrolledClasses.target', { band: cls.targetBand.toFixed(1) })}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <StudentNotesPanel studentId={studentId} initialNotes={notes} />
    </div>
  )
}

function DetailSkeleton(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      data-testid="student-detail-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('people.student.detail.loading')}
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
  const role = useRole()
  const backTo = role === 'teacher' ? '/students' : '/people/students'
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
        data-testid="student-not-found"
      >
        <h1 className="font-fraunces text-xl text-slate-900">
          {t('people.student.detail.notFound.headline')}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {t('people.student.detail.notFound.body')}
        </p>
        <Link to={backTo} className="text-sm text-[color:var(--cl-accent)] underline">
          {t('people.student.detail.notFound.backCta')}
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
        <span>{t('people.student.detail.error')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('people.student.detail.retry')}
        </Button>
      </div>
    </div>
  )
}
