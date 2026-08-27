/**
 * GradingRoute — Story 6.3a (AC11 · D8). The fetch-before-dispatch parent for the
 * teacher grading detail route. The route can't branch at resolution (the exercise
 * skill isn't known there), so this reads useGradingSubmission(submissionId), then
 * dynamically imports WritingGradingPage vs SpeakingGradingPage — keeping separate lazy
 * chunks so no student code (and no waveform engine) loads for the other skill. It owns
 * the first skeleton; the child page re-runs the same query (TanStack cache dedups).
 */
import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api-fetch'

import { useGradingSubmission } from './api/useGradingSubmission'

const LazyWritingGradingPage = lazy(() =>
  import('./WritingGradingPage').then((m) => ({ default: m.WritingGradingPage })),
)
const LazySpeakingGradingPage = lazy(() =>
  import('./SpeakingGradingPage').then((m) => ({ default: m.SpeakingGradingPage })),
)
const LazyObjectiveGradingPage = lazy(() =>
  import('./ObjectiveGradingPage').then((m) => ({ default: m.ObjectiveGradingPage })),
)

// The objective skills 6-4a auto-grades. An objective submission whose auto-grade FAILED
// at submit (6-4a D13 SAVEPOINT fault boundary) has NO working row → `autoGrade` is null
// even though the exercise IS objective. Keying dispatch on `autoGrade` alone would then
// mislabel a supported-but-failed reading exercise as `unsupportedSkill` (D1/AC16); this
// set lets the error branch tell "supported but failed" from genuinely unsupported.
const OBJECTIVE_SKILLS = ['reading', 'listening', 'grammar', 'vocabulary'] as const

export function GradingRoute() {
  const { t } = useTranslation()
  const params = useParams()
  const submissionId = params.sid ?? ''
  const query = useGradingSubmission(submissionId)

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center" role="alert" data-testid="grading-dispatch-error">
        <p className="text-sm text-foreground">
          {query.error instanceof ApiError ? query.error.message : t('grading.error.generic')}
        </p>
        <Button size="sm" onClick={() => query.refetch()}>
          {t('grading.error.retry')}
        </Button>
      </div>
    )
  }
  if (!query.data) {
    return <DispatchSkeleton />
  }

  // Objective dispatch runs BEFORE the skill check (D1/AC1): an objective submission is
  // identified by `autoGrade != null` (6-4a sets it only for an exercise with >=1 gradable
  // group), NOT by `exercise.skill`. A reading/listening/grammar submission with a working
  // row renders the objective review page instead of dead-ending at unsupportedSkill.
  if (query.data.autoGrade) {
    return (
      <Suspense fallback={<DispatchSkeleton />}>
        <LazyObjectiveGradingPage />
      </Suspense>
    )
  }

  // Dispatch ONLY the two skills with a grading surface — never fall a reading/listening/
  // grammar/… submission through to the writing page against a non-essay payload (P4).
  const skill = query.data.exercise.skill
  if (skill !== 'writing' && skill !== 'speaking') {
    // AC16/D1: an objective-skill exercise with no working row means auto-grade FAILED at
    // submit (6-4a D13 SAVEPOINT) — an honest "auto-grade unavailable, retry", NOT the
    // misleading unsupported-skill dead-end. `unsupportedSkill` remains only for genuinely
    // non-objective, non-writing/speaking skills.
    if ((OBJECTIVE_SKILLS as readonly string[]).includes(skill)) {
      return (
        <div
          className="flex flex-col items-center gap-3 p-12 text-center"
          role="alert"
          data-testid="grading-dispatch-autograde-unavailable"
        >
          <p className="text-sm font-medium text-foreground">
            {t('objectiveGrading.autoGradeUnavailable.title')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('objectiveGrading.autoGradeUnavailable.body')}
          </p>
          <Button size="sm" onClick={() => query.refetch()}>
            {t('objectiveGrading.autoGradeUnavailable.retry')}
          </Button>
        </div>
      )
    }
    return (
      <div
        className="flex flex-col items-center gap-3 p-12 text-center"
        role="alert"
        data-testid="grading-dispatch-unsupported"
      >
        <p className="text-sm text-foreground">{t('grading.error.unsupportedSkill')}</p>
      </div>
    )
  }
  return (
    <Suspense fallback={<DispatchSkeleton />}>
      {skill === 'speaking' ? <LazySpeakingGradingPage /> : <LazyWritingGradingPage />}
    </Suspense>
  )
}

function DispatchSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="grading-dispatch-skeleton" role="status">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
