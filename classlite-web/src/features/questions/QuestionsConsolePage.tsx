/**
 * QuestionsConsolePage — the teacher Q&A console (s18, Story 7.4b, AC6–AC12).
 * Lists questions across the classes the teacher teaches (role-scoped in the
 * service — the page adds no role check; the route gate makes it teacher-only,
 * UX-3), with an "Unanswered" filter (?unanswered), per-card reply + visibility
 * toggle + send-&-resolve, standalone resolve, and an all-or-nothing batch
 * reply over a multi-select. UX-1 trilogy throughout. Route-level protection
 * keeps the console absent from the DOM for non-teachers (AC12).
 */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { AnchoredQuestionsRailShell } from '@/components/domain/AnchoredQuestionsRailShell'
import { BatchActionBar } from '@/components/domain/BatchActionBar'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-fetch'
import { useQuestions } from './api/useQuestions'
import { useBatchReply } from './api/useQuestionActions'
import { TeacherQuestionCard } from './components/TeacherQuestionCard'
import {
  useReplyComposerSchema,
  type ReplyComposerValues,
} from './lib/questionSchemas'

const UNANSWERED_PARAM = 'unanswered'

/** Batch reply hard cap (7-4a contract); the server rejects a larger batch. */
const BATCH_MAX = 50

function batchErrorKey(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.status === 404) return 'questions.batch.error.notFound'
    if (error.status === 422) return 'questions.batch.error.validation'
  }
  return 'questions.batch.error.generic'
}

export function QuestionsConsolePage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const unanswered = searchParams.get(UNANSWERED_PARAM) === 'true'
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const clearSelection = () => setSelected(new Set())

  const setUnanswered = (next: boolean) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next) nextParams.set(UNANSWERED_PARAM, 'true')
    else nextParams.delete(UNANSWERED_PARAM)
    setSearchParams(nextParams, { replace: true })
    setPage(1)
    // Selection is page/filter-scoped — a stale off-view selection must not be
    // silently swept into a batch reply (all-or-nothing aborts on any 404).
    clearSelection()
  }

  const goToPage = (next: number) => {
    setPage(next)
    clearSelection()
  }

  const questions = useQuestions({ page, unanswered: unanswered || undefined })

  // The open-count badge is the true open-queue total, not a page-local tally:
  // the count of open questions across all pages under the reader's scope.
  const openCountQuery = useQuestions({ page: 1, unanswered: true })
  const openCount = openCountQuery.data?.meta.pagination.total ?? 0

  const toggleSelected = (questionId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  const batchSchema = useReplyComposerSchema()
  const batchForm = useForm<ReplyComposerValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: { content: '', visibility: 'personal' },
    mode: 'onChange',
  })
  const batchMutation = useBatchReply()

  const submitBatch = (resolve: boolean) =>
    batchForm.handleSubmit((values) => {
      batchMutation.mutate(
        {
          questionIds: [...selected],
          content: values.content,
          visibility: values.visibility,
          resolve,
        },
        {
          onSuccess: () => {
            clearSelection()
            batchForm.reset({ content: '', visibility: values.visibility })
          },
        },
      )
    })

  const rows = questions.data?.data ?? []
  const totalPages = questions.data?.meta.pagination.totalPages ?? 1

  // Reconcile local pagination state when the result set shrinks (e.g. the last
  // unanswered question on page 2 is resolved → totalPages drops to 1). Without
  // this the console strands on an empty page with the nav hidden. UI-state
  // reconciliation, not data fetching — a permitted useEffect (FW-4).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const overBatchLimit = selected.size > BATCH_MAX
  const batchError = overBatchLimit
    ? 'questions.batch.error.tooMany'
    : batchErrorKey(batchMutation.error)

  const filter = (
    <Button
      type="button"
      variant={unanswered ? 'default' : 'outline'}
      size="sm"
      aria-pressed={unanswered}
      onClick={() => setUnanswered(!unanswered)}
      data-testid="questions-unanswered-filter"
    >
      {t('questions.console.unansweredFilter')}
    </Button>
  )

  const batchBar =
    selected.size > 0 ? (
      <BatchActionBar
        selectedCount={selected.size}
        value={batchForm.watch('content')}
        onChange={(value) => batchForm.setValue('content', value, { shouldValidate: true })}
        visibility={batchForm.watch('visibility')}
        onVisibilityChange={(next) =>
          batchForm.setValue('visibility', next, { shouldValidate: true })
        }
        onReply={() => void submitBatch(false)()}
        onReplyResolve={() => void submitBatch(true)()}
        onClear={clearSelection}
        submitting={batchMutation.isPending}
        canSubmit={batchForm.formState.isValid && !overBatchLimit}
        error={batchError ? t(batchError, { max: BATCH_MAX }) : null}
      />
    ) : null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <AnchoredQuestionsRailShell
        title={t('questions.console.title')}
        count={openCount}
        filter={filter}
        batchBar={batchBar}
      >
        {questions.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('questions.list.loading')}
            data-testid="questions-console-skeleton"
            className="flex flex-col gap-3"
          >
            <div className="h-32 animate-pulse rounded-xl bg-[var(--cl-line)]" />
            <div className="h-32 animate-pulse rounded-xl bg-[var(--cl-line)]" />
          </div>
        ) : questions.isError ? (
          <div
            role="alert"
            data-testid="questions-console-error"
            className="flex flex-col items-start gap-2 rounded-xl border border-[color:var(--cl-line)] p-4 text-sm"
          >
            <p>{t('questions.list.error')}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void questions.refetch()}
              data-testid="questions-console-retry"
            >
              {t('questions.list.retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div
            data-testid="questions-console-empty"
            className="rounded-xl border border-dashed border-[color:var(--cl-line)] p-8 text-center text-sm text-[var(--cl-ink-soft)]"
          >
            <p className="font-medium text-foreground">{t('questions.empty.teacher.title')}</p>
            <p>{t('questions.empty.teacher.body')}</p>
          </div>
        ) : (
          rows.map((question) => (
            <TeacherQuestionCard
              key={question.id}
              question={question}
              selected={selected.has(question.id)}
              onToggleSelected={toggleSelected}
            />
          ))
        )}
      </AnchoredQuestionsRailShell>

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label={t('questions.console.pagination')}
          data-testid="questions-console-pagination"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(Math.max(1, page - 1))}
            data-testid="questions-console-prev"
          >
            {t('questions.console.prev')}
          </Button>
          <span className="text-xs text-[var(--cl-ink-soft)]">
            {t('questions.console.pageOf', { page, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            data-testid="questions-console-next"
          >
            {t('questions.console.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

export default QuestionsConsolePage
