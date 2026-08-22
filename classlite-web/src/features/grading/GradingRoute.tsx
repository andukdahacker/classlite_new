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

  // Dispatch ONLY the two skills with a grading surface — never fall a reading/listening/
  // grammar/… submission through to the writing page against a non-essay payload (P4).
  const skill = query.data.exercise.skill
  if (skill !== 'writing' && skill !== 'speaking') {
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
