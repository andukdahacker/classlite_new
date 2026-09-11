/**
 * StudentQuestionThread — one own-thread row in the student rail (Story 7.4b,
 * AC4). A child component so each thread owns its own useQuestionThread hook
 * (the reader-scoped replies). Renders the presentational AnchoredQuestionCard
 * from the list `question` immediately (awaiting), then upgrades to the answered
 * state with the teacher reply once the thread loads. If the thread read fails
 * it surfaces an inline error + retry (UX-1) rather than silently showing
 * "awaiting" when a reply may exist.
 */
import { useTranslation } from 'react-i18next'
import { AnchoredQuestionCard } from '@/components/domain/AnchoredQuestionCard'
import { Button } from '@/components/ui/button'
import { useQuestionThread, type Question } from '../api/useQuestions'
import { toStudentCardModel } from '../lib/questionCardModel'
import { formatQuestionTimestamp } from '../lib/questionFormat'

export function StudentQuestionThread({ question }: { question: Question }) {
  const { t, i18n } = useTranslation()
  const thread = useQuestionThread(question.id)

  if (thread.isError) {
    return (
      <div
        role="alert"
        data-testid={`student-question-thread-${question.id}-error`}
        className="flex flex-col items-start gap-2 rounded-xl border border-[color:var(--cl-line)] p-4 text-sm"
      >
        <p>{t('questions.list.error')}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void thread.refetch()}
          data-testid={`student-question-thread-${question.id}-retry`}
        >
          {t('questions.list.retry')}
        </Button>
      </div>
    )
  }

  const head = thread.data?.question ?? question
  const replies = thread.data?.replies ?? []
  const model = toStudentCardModel(head, replies, t, (iso) =>
    formatQuestionTimestamp(iso, i18n.language),
  )
  return <AnchoredQuestionCard question={model} />
}
