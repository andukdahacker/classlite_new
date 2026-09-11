/**
 * StudentQuestionPanel — the in-attempt anchored-Q&A rail (s36, Story 7.4b,
 * AC1–AC4). A right-side Sheet mirrored to the `?questions=open` URL param
 * (replace:true, deleted on close) so it is an OVERLAY, never a route change —
 * the attempt's answer draft / timer / navigator state is preserved (AC1). The
 * student asks anchored to the current item, a selected passage, or the whole
 * exercise (AC2), submits over POST /api/questions (AC3), and reads their own
 * threads in-panel (AC4). Class/exercise/student are server-derived (SEC-7); the
 * body carries only assignmentId + anchor + content.
 */
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ApiError } from '@/lib/api-fetch'
import { captureSelectionOffsets, normalizeAnchor } from '@/lib/essayAnchors'
import { useQuestions } from '../api/useQuestions'
import { useAskQuestion } from '../api/useQuestionActions'
import { itemAnchorFromHandle, passageAnchor } from '../lib/questionAnchor'
import {
  QUESTION_CONTENT_MAX,
  useAskComposerSchema,
  type AskComposerValues,
} from '../lib/questionSchemas'
import { StudentQuestionThread } from './StudentQuestionThread'

const QUESTIONS_PARAM = 'questions'
const OPEN_VALUE = 'open'
const MAX_EXCERPT = 2000

type AskScope = 'item' | 'exercise' | 'passage'

interface PassageDraft {
  sectionIndex: number
  charStart: number
  charEnd: number
  excerpt: string
}

export interface StudentQuestionPanelProps {
  assignmentId: string
  exerciseId: string
  /** The focused item handle (`si:gi:qi`) for the "This item" anchor; null when none. */
  currentHandle: string | null
}

function itemExcerpt(handle: string): string | null {
  const wrap = document.getElementById(`qwrap-${handle}`)
  const text = wrap?.textContent?.trim()
  if (!text) return null
  return text.slice(0, MAX_EXCERPT)
}

export function StudentQuestionPanel({
  assignmentId,
  exerciseId,
  currentHandle,
}: StudentQuestionPanelProps) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const open = searchParams.get(QUESTIONS_PARAM) === OPEN_VALUE

  const setOpen = useCallback(
    (next: boolean) => {
      const nextParams = new URLSearchParams(searchParams)
      if (next) nextParams.set(QUESTIONS_PARAM, OPEN_VALUE)
      else nextParams.delete(QUESTIONS_PARAM)
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const [scope, setScope] = useState<AskScope>(currentHandle ? 'item' : 'exercise')
  const [passageDraft, setPassageDraft] = useState<PassageDraft | null>(null)

  const askSchema = useAskComposerSchema()
  const form = useForm<AskComposerValues>({
    resolver: zodResolver(askSchema),
    defaultValues: { content: '' },
    mode: 'onChange',
  })
  const ask = useAskQuestion()

  // Passage-selection capture (AC2): a mouseup inside a `[data-qa-passage]`
  // element snapshots the char span + text into a durable draft and opens the
  // rail scoped to that passage. DOM-imperative → a permitted useEffect (FW-4).
  useEffect(() => {
    function onMouseUp() {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
      const anchorNode = selection.anchorNode
      const host =
        anchorNode instanceof Element
          ? anchorNode.closest('[data-qa-passage]')
          : anchorNode?.parentElement?.closest('[data-qa-passage]')
      if (!(host instanceof HTMLElement)) return
      const rawIndex = host.dataset.sectionIndex
      if (rawIndex === undefined) return
      const offsets = captureSelectionOffsets(host)
      if (!offsets) return
      const normalized = normalizeAnchor(host.textContent ?? '', offsets.start, offsets.end)
      if (!normalized) return
      const excerpt = selection.toString().trim().slice(0, MAX_EXCERPT)
      if (!excerpt) return
      setPassageDraft({
        sectionIndex: Number(rawIndex),
        charStart: normalized.start,
        charEnd: normalized.end,
        excerpt,
      })
      setScope('passage')
      setOpen(true)
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [setOpen])

  const questions = useQuestions({ page: 1, exerciseId })

  const submit = form.handleSubmit((values) => {
    let anchorType: 'item' | 'exercise'
    let anchorRef: ReturnType<typeof itemAnchorFromHandle> | null
    let anchorExcerpt: string | null
    if (scope === 'exercise') {
      anchorType = 'exercise'
      anchorRef = null
      anchorExcerpt = null
    } else if (scope === 'passage') {
      if (!passageDraft) return
      anchorType = 'item'
      anchorRef = passageAnchor(passageDraft.sectionIndex, passageDraft.charStart, passageDraft.charEnd)
      anchorExcerpt = passageDraft.excerpt
    } else {
      if (!currentHandle) return
      anchorType = 'item'
      anchorRef = itemAnchorFromHandle(currentHandle)
      anchorExcerpt = itemExcerpt(currentHandle)
    }
    ask.mutate(
      { assignmentId, anchorType, anchorRef, anchorExcerpt, content: values.content },
      {
        onSuccess: () => {
          form.reset({ content: '' })
          setPassageDraft(null)
          setScope(currentHandle ? 'item' : 'exercise')
          window.getSelection()?.removeAllRanges()
        },
      },
    )
  })

  const scopeUnavailable =
    (scope === 'item' && !currentHandle) || (scope === 'passage' && !passageDraft)
  const submitDisabled = !form.formState.isValid || scopeUnavailable || ask.isPending

  const askErrorKey = askErrorMessageKey(ask.error)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        data-testid="student-question-panel"
      >
        <SheetHeader>
          <SheetTitle>{t('questions.panel.title')}</SheetTitle>
          <SheetDescription>{t('questions.panel.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Composer (AC2/AC3) */}
          <form
            onSubmit={submit}
            className="flex flex-col gap-2"
            data-testid="student-question-composer"
            aria-label={t('questions.composer.ariaLabel')}
          >
            <div
              role="group"
              aria-label={t('questions.composer.scopeLabel')}
              className="flex flex-wrap items-center gap-1"
            >
              <Button
                type="button"
                size="sm"
                variant={scope === 'item' ? 'default' : 'outline'}
                aria-pressed={scope === 'item'}
                disabled={!currentHandle}
                data-testid="student-question-scope-item"
                onClick={() => setScope('item')}
              >
                {t('questions.composer.scope.item')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scope === 'exercise' ? 'default' : 'outline'}
                aria-pressed={scope === 'exercise'}
                data-testid="student-question-scope-exercise"
                onClick={() => setScope('exercise')}
              >
                {t('questions.composer.scope.exercise')}
              </Button>
              {passageDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant={scope === 'passage' ? 'default' : 'outline'}
                  aria-pressed={scope === 'passage'}
                  data-testid="student-question-scope-passage"
                  onClick={() => setScope('passage')}
                >
                  {t('questions.composer.scope.passage')}
                </Button>
              ) : null}
            </div>

            {scope === 'passage' && passageDraft ? (
              <blockquote
                data-testid="student-question-passage-excerpt"
                className="rounded-md border-l-2 border-[color:var(--cl-line)] bg-[color:var(--cl-paper)] px-3 py-2 text-xs italic text-foreground"
              >
                {passageDraft.excerpt}
              </blockquote>
            ) : null}

            <Textarea
              rows={3}
              maxLength={QUESTION_CONTENT_MAX}
              aria-label={t('questions.composer.contentLabel')}
              placeholder={t('questions.composer.contentPlaceholder')}
              data-testid="student-question-content"
              {...form.register('content')}
            />

            {askErrorKey ? (
              <p
                role="alert"
                data-testid="student-question-ask-error"
                className="text-xs text-[color:var(--cl-danger)]"
              >
                {t(askErrorKey)}
              </p>
            ) : null}

            <Button
              type="submit"
              size="sm"
              className="self-end"
              disabled={submitDisabled}
              data-testid="student-question-submit"
            >
              {t('questions.composer.submit')}
            </Button>
          </form>

          {/* Own threads (AC4) — UX-1 trilogy */}
          <div className="flex flex-col gap-3">
            {questions.isPending ? (
              <div
                role="status"
                aria-busy="true"
                aria-label={t('questions.list.loading')}
                data-testid="student-question-list-skeleton"
                className="flex flex-col gap-3"
              >
                <div className="h-24 animate-pulse rounded-xl bg-[var(--cl-line)]" />
                <div className="h-24 animate-pulse rounded-xl bg-[var(--cl-line)]" />
              </div>
            ) : questions.isError ? (
              <div
                role="alert"
                data-testid="student-question-list-error"
                className="flex flex-col items-start gap-2 rounded-xl border border-[color:var(--cl-line)] p-4 text-sm"
              >
                <p>{t('questions.list.error')}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void questions.refetch()}
                  data-testid="student-question-list-retry"
                >
                  {t('questions.list.retry')}
                </Button>
              </div>
            ) : questions.data.data.length === 0 ? (
              <div
                data-testid="student-question-list-empty"
                className="rounded-xl border border-dashed border-[color:var(--cl-line)] p-6 text-center text-sm text-[var(--cl-ink-soft)]"
              >
                <p className="font-medium text-foreground">{t('questions.empty.student.title')}</p>
                <p>{t('questions.empty.student.body')}</p>
              </div>
            ) : (
              questions.data.data.map((question) => (
                <StudentQuestionThread key={question.id} question={question} />
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Map an ask ApiError to a UX-1 i18n key (never a raw code). */
function askErrorMessageKey(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.status === 404) return 'questions.composer.error.targetNotFound'
    if (error.status === 403) return 'questions.composer.error.forbidden'
    if (error.status === 422) return 'questions.composer.error.validation'
  }
  return 'questions.composer.error.generic'
}
