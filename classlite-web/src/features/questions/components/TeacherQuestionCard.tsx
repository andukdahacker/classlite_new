/**
 * TeacherQuestionCard — one console row (Story 7.4b, AC8/AC9/AC11). Wraps the
 * presentational AnchoredQuestionCard, owning the per-card RHF reply form
 * (content + personal/shared visibility) and the reply / send-&-resolve /
 * standalone-resolve mutations. Adds the console-only chrome the card doesn't
 * host: a multi-select checkbox (AC10) and a standalone Resolve button (AC11).
 * Data + mutations live here; the card stays presentational.
 */
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { AnchoredQuestionCard } from '@/components/domain/AnchoredQuestionCard'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-fetch'
import { useReplyToQuestion, useResolveQuestion } from '../api/useQuestionActions'
import type { Question } from '../api/useQuestions'
import { toTeacherCardModel } from '../lib/questionCardModel'
import { formatQuestionTimestamp } from '../lib/questionFormat'
import {
  useReplyComposerSchema,
  type ReplyComposerValues,
} from '../lib/questionSchemas'

export interface TeacherQuestionCardProps {
  question: Question
  selected: boolean
  onToggleSelected: (questionId: string) => void
}

function replyErrorKey(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.status === 404) return 'questions.reply.error.notFound'
    if (error.status === 422) return 'questions.reply.error.validation'
  }
  return 'questions.reply.error.generic'
}

function resolveErrorKey(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiError && error.status === 404) {
    return 'questions.resolve.error.notFound'
  }
  return 'questions.resolve.error.generic'
}

export function TeacherQuestionCard({
  question,
  selected,
  onToggleSelected,
}: TeacherQuestionCardProps) {
  const { t, i18n } = useTranslation()
  const schema = useReplyComposerSchema()
  const form = useForm<ReplyComposerValues>({
    resolver: zodResolver(schema),
    defaultValues: { content: '', visibility: 'personal' },
    mode: 'onChange',
  })
  const replyMutation = useReplyToQuestion()
  const resolveMutation = useResolveQuestion()

  const content = form.watch('content')
  const visibility = form.watch('visibility')

  const send = (resolve: boolean) =>
    form.handleSubmit((values) => {
      replyMutation.mutate(
        { questionId: question.id, body: { ...values, resolve } },
        { onSuccess: () => form.reset({ content: '', visibility: values.visibility }) },
      )
    })

  const model = toTeacherCardModel(question, t, (iso) =>
    formatQuestionTimestamp(iso, i18n.language),
  )
  const busy = replyMutation.isPending || resolveMutation.isPending
  const replyError = replyErrorKey(replyMutation.error)
  const resolveError = resolveErrorKey(resolveMutation.error)

  return (
    <div className="flex flex-col gap-2" data-testid={`teacher-question-${question.id}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-[var(--cl-ink-soft)]">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(question.id)}
            data-testid={`teacher-question-${question.id}-select`}
            aria-label={t('questions.console.selectQuestion')}
          />
          {t('questions.console.selectQuestion')}
        </label>
        {question.status === 'open' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => resolveMutation.mutate(question.id)}
            data-testid={`teacher-question-${question.id}-resolve`}
          >
            {t('questions.console.resolve')}
          </Button>
        ) : (
          <span
            data-testid={`teacher-question-${question.id}-resolved`}
            className="text-xs font-medium text-[color:var(--cl-success)]"
          >
            {t('questions.console.resolved')}
          </span>
        )}
      </div>

      {resolveError ? (
        <p
          role="alert"
          data-testid={`teacher-question-${question.id}-resolve-error`}
          className="text-xs text-[color:var(--cl-danger)]"
        >
          {t(resolveError)}
        </p>
      ) : null}

      <AnchoredQuestionCard
        question={model}
        reply={{
          value: content,
          onChange: (value) => form.setValue('content', value, { shouldValidate: true }),
          visibility,
          onVisibilityChange: (next) =>
            form.setValue('visibility', next, { shouldValidate: true }),
          onSubmit: () => void send(false)(),
          onSendAndResolve: () => void send(true)(),
          submitting: busy,
          canSubmit: form.formState.isValid,
          error: replyError ? t(replyError) : null,
        }}
      />
    </div>
  )
}
