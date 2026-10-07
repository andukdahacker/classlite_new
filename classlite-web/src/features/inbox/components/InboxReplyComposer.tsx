/**
 * InboxReplyComposer — Story 10-1b (AC7 / DD7). The teacher's inline reply to a
 * `question_asked` row, reusing the EXISTING `useReplyToQuestion` → `POST
 * /api/questions/{id}/replies` (TS-7 barrel import — pure FE reuse, no new BE).
 *
 * The `visibility` toggle (shared ↔ private) is load-bearing (Sally): it is
 * student-visible and the frozen `ReplyRequest` carries it — hardcoding it would
 * be a privacy regression vs the full Q&A surface. `resolve` defaults off (not
 * exposed in v1). On success the composer collapses and the caller optimistically
 * marks the question row read; no student-facing "teacher replied" notification is
 * created (no `question.answered` event — documented, OD1 / FU-10-1-QA-ANSWERED).
 */
import { useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/client'
import { useReplyToQuestion } from '@/features/questions'

type QuestionVisibility = components['schemas']['QuestionVisibility']

const replyFormSchema = z.object({
  content: z.string().trim().min(1, 'inbox.reply.error.required'),
})
type ReplyFormValues = z.infer<typeof replyFormSchema>

export interface InboxReplyComposerProps {
  questionId: string
  /** Called after a successful reply so the caller can collapse + mark the row read. */
  onReplied: () => void
}

export function InboxReplyComposer({ questionId, onReplied }: InboxReplyComposerProps): ReactElement {
  const { t } = useTranslation()
  const [visibility, setVisibility] = useState<QuestionVisibility>('shared')
  const reply = useReplyToQuestion()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReplyFormValues>({
    resolver: zodResolver(replyFormSchema),
    defaultValues: { content: '' },
  })

  const onSubmit = handleSubmit((values) => {
    reply.mutate(
      { questionId, body: { content: values.content.trim(), visibility, resolve: false } },
      {
        onSuccess: () => onReplied(),
        // A server/network failure must not be silent — the composer stays open
        // with the draft and the teacher gets an explicit error (code-review 10-1b P2).
        onError: () => toast.error(t('inbox.reply.error.failed')),
      },
    )
  })

  return (
    <form
      data-testid={`inbox-reply-composer-${questionId}`}
      onSubmit={onSubmit}
      className="flex flex-col gap-2 border-t border-[color:var(--cl-line-soft)] bg-muted/30 px-4 py-3"
    >
      <label className="sr-only" htmlFor={`inbox-reply-${questionId}`}>
        {t('inbox.reply.placeholder')}
      </label>
      <textarea
        id={`inbox-reply-${questionId}`}
        {...register('content')}
        rows={3}
        placeholder={t('inbox.reply.placeholder')}
        aria-invalid={errors.content ? 'true' : undefined}
        className="min-h-[72px] w-full rounded-lg border border-[color:var(--cl-line-soft)] bg-background p-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {errors.content ? (
        <p role="alert" className="text-xs text-[color:var(--cl-red)]">
          {t(errors.content.message ?? 'inbox.reply.error.required')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={t('inbox.reply.visibility.label')}
          className="inline-flex items-center gap-1"
        >
          {(['shared', 'personal'] as const).map((value) => {
            const active = visibility === value
            const labelKey =
              value === 'shared' ? 'inbox.reply.visibility.shared' : 'inbox.reply.visibility.private'
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                data-testid={`inbox-reply-visibility-${value}`}
                onClick={() => setVisibility(value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {t(labelKey)}
              </button>
            )
          })}
        </div>
        <Button type="submit" size="sm" disabled={reply.isPending}>
          {t('inbox.reply.send')}
        </Button>
      </div>
    </form>
  )
}
