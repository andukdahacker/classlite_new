/**
 * AIGenerateDialog — Story 4.3b (s17; AC1/AC3/AC4/AC5/AC6/AC7). The AI
 * content-generation dialog that opens from the editor's three affordances
 * (generate section / questions / distractors), drives the async job via
 * `useAiGenerationJob`, and previews the result before it touches the exercise.
 *
 * State machine (rendered from the hook's derived `phase`):
 *   idle       → the RHF + zodResolver config form (mode-specific fields)
 *   generating → an honest "Generating…" state (aria-live announced)
 *   preview    → <AiGenerationPreview> (Accept / Edit / Dismiss / Regenerate)
 *   stuck      → the 5-min "taking longer" surface (Cancel and retry)
 *   failed     → a mode-honest failure: invalid_ai_response (adjust the prompt —
 *                a retry is pointless) vs generation_failed (retry or go manual)
 *
 * The section form's chips (type/band/count/mix) fold into the single `topic`
 * seed (see `composeSectionTopicSeed`) — 4.3a's contract takes `{topic}` only.
 * Questions/distractors submit only `count` (+ the id handle threaded from the
 * trigger). Insertion is the parent's job (merge + 4.2 autosave) — this dialog
 * only decides WHAT to insert, via `onInsert`.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api-fetch'
import type { ExerciseContent, ExerciseSectionType, QuestionGroupType } from './lib/editorTypes'
import { isPromptOnlySection, sectionTypeLabelKey } from './lib/sectionTypes'
import { questionTypeLabelKey } from './lib/questionTypes'
import {
  AI_DISTRACTORS_COUNTS,
  AI_QUESTIONS_COUNTS,
  AI_QUESTION_MIX_TYPES,
  AI_SECTION_QUESTION_COUNTS,
  AI_SECTION_TYPES,
  AI_TARGET_BAND_OPTIONS,
  EST_CREDIT_COST,
  composeSectionTopicSeed,
  type AiGenerationMode,
  type SectionFormValues,
} from './lib/aiGeneration'
import { KnowledgeHubPicker } from '@/features/knowledge-hub'
import { AiChipGroup } from './components/ai/AiChipGroup'
import { AiGenerationPreview } from './components/ai/AiGenerationPreview'
import { useAiCredits, type AiCredits } from './hooks/useAiCredits'
import { useAiGenerationJob } from './hooks/useAiGenerationJob'

const NOT_FOUND_STATUS = 404
const FORBIDDEN_STATUS = 403
const EXERCISES_PATH = '/exercises'

/** How the editor asked to open the dialog. `targetId` is the index-based handle
 * of the target section (questions) or question (distractors) — the id-less 4.2
 * content model has no real ids; 4.3a validates presence but the worker ignores
 * the value (insertion is client-side here). See FU-4-3-B. */
export interface AiGenerateOpenRequest {
  mode: AiGenerationMode
  targetId?: string
}

export interface AIGenerateDialogProps {
  exerciseId: string
  request: AiGenerateOpenRequest
  /** Merge the accepted fragment into the editor doc + persist via autosave.
   * `focus` asks the editor to scroll/focus the inserted content (Edit). */
  onInsert: (mode: AiGenerationMode, content: ExerciseContent, opts: { focus: boolean }) => void
  onClose: () => void
}

export function AIGenerateDialog({ exerciseId, request, onInsert, onClose }: AIGenerateDialogProps) {
  const { t } = useTranslation()
  const credits = useAiCredits()
  const { phase, result, errorKind, enqueue, regenerate, cancel, isEnqueuing, enqueueError } =
    useAiGenerationJob(exerciseId)

  // Remember the last submitted config so a failed→adjust cycle (which routes
  // back through `idle`) re-seeds the form instead of dropping the teacher's
  // input. State (not a ref) because the value feeds the form's defaultValues at
  // render time (react-hooks/refs forbids reading a ref during render).
  const [lastSectionValues, setLastSectionValues] = useState<SectionFormValues | null>(null)
  const [lastCount, setLastCount] = useState<number | null>(null)

  function handleClose() {
    cancel()
    onClose()
  }

  function submitSection(values: SectionFormValues) {
    setLastSectionValues(values)
    enqueue({ mode: 'section', params: { topic: composeSectionTopicSeed(values) } })
  }

  function submitCount(count: number) {
    setLastCount(count)
    if (request.mode === 'questions') {
      enqueue({ mode: 'questions', params: { sectionId: request.targetId ?? '', count } })
    } else {
      enqueue({ mode: 'distractors', params: { questionId: request.targetId ?? '', count } })
    }
  }

  function backToForm() {
    cancel()
  }

  const liveMessage =
    phase === 'generating'
      ? t('exercises.ai.generating.announce')
      : phase === 'preview'
        ? t('exercises.ai.preview.announce')
        : phase === 'stuck'
          ? t('exercises.ai.stuck.announce')
          : phase === 'failed'
            ? t('exercises.ai.failed.announce')
            : ''

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent
        className="max-h-[85vh] w-full overflow-y-auto sm:max-w-lg"
        data-testid="ai-generate-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t(`exercises.ai.title.${request.mode}`)}</DialogTitle>
          <DialogDescription>{t(`exercises.ai.subtitle.${request.mode}`)}</DialogDescription>
        </DialogHeader>

        {/* aria-live announces generating → complete → failed transitions (AC6). */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="ai-live-region">
          {liveMessage}
        </p>

        {/* A re-enqueue (regenerate / retry) from a non-idle surface can fail
            (403/404/network); the idle form shows this in its footer, so mirror
            it here so the click is never a silent no-op (AC7). */}
        {phase !== 'idle' && enqueueError ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            data-testid="ai-enqueue-error"
          >
            {humanEnqueueError(t, enqueueError)}
          </p>
        ) : null}

        {phase === 'idle' &&
          (request.mode === 'section' ? (
            <SectionForm
              defaultValues={lastSectionValues}
              credits={credits}
              isEnqueuing={isEnqueuing}
              enqueueError={enqueueError}
              onSubmit={submitSection}
              onCancel={handleClose}
            />
          ) : (
            <CountForm
              mode={request.mode}
              defaultCount={lastCount}
              credits={credits}
              isEnqueuing={isEnqueuing}
              enqueueError={enqueueError}
              onSubmit={submitCount}
              onCancel={handleClose}
            />
          ))}

        {phase === 'generating' && <GeneratingState onCancel={handleClose} />}

        {phase === 'preview' && result !== null && (
          <AiGenerationPreview
            mode={request.mode}
            content={result}
            isEnqueuing={isEnqueuing}
            onAccept={() => {
              onInsert(request.mode, result, { focus: false })
              onClose()
            }}
            onEdit={() => {
              onInsert(request.mode, result, { focus: true })
              onClose()
            }}
            onDismiss={handleClose}
            onRegenerate={regenerate}
          />
        )}

        {phase === 'stuck' && (
          <StuckState onRetry={regenerate} onCancel={handleClose} isEnqueuing={isEnqueuing} />
        )}

        {phase === 'failed' && (
          <FailedState
            errorKind={errorKind}
            onAdjust={backToForm}
            onRetry={regenerate}
            onCancel={handleClose}
            isEnqueuing={isEnqueuing}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- config forms ------------------------------------------------------------

interface SharedFormProps {
  credits: AiCredits
  isEnqueuing: boolean
  enqueueError: ApiError | null
  onCancel: () => void
}

function humanEnqueueError(
  t: ReturnType<typeof useTranslation>['t'],
  error: ApiError,
): string {
  if (error.status === NOT_FOUND_STATUS) return t('exercises.ai.error.notFound')
  if (error.status === FORBIDDEN_STATUS) return t('exercises.ai.error.forbidden')
  return t('exercises.ai.error.generic')
}

function toggleMembership<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

function SectionForm({
  defaultValues,
  credits,
  isEnqueuing,
  enqueueError,
  onSubmit,
  onCancel,
}: SharedFormProps & {
  defaultValues: SectionFormValues | null
  onSubmit: (values: SectionFormValues) => void
}) {
  const { t } = useTranslation()
  const schema = useMemo(
    () =>
      z.object({
        sectionType: z.enum(['reading', 'listening', 'writing', 'speaking', 'grammar']),
        topic: z.string().trim().min(1, t('exercises.ai.errors.topicRequired')),
        targetBand: z.number().nullable(),
        questionCount: z.number().nullable(),
        questionMix: z.array(
          z.enum([
            'multiple_choice',
            'true_false_not_given',
            'fill_in_blank',
            'short_answer',
            'matching',
          ]),
        ),
      }),
    [t],
  )

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SectionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      sectionType: 'reading',
      topic: '',
      targetBand: null,
      questionCount: null,
      questionMix: [],
    },
  })

  const sectionType = watch('sectionType')
  const targetBand = watch('targetBand')
  const questionCount = watch('questionCount')
  const questionMix = watch('questionMix')
  const promptOnly = isPromptOnlySection(sectionType)
  const [topicPickerOpen, setTopicPickerOpen] = useState(false)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" data-testid="ai-section-form">
      <FieldBlock label={t('exercises.ai.field.sectionType')}>
        <AiChipGroup<ExerciseSectionType>
          ariaLabel={t('exercises.ai.field.sectionType')}
          options={AI_SECTION_TYPES}
          selected={(option) => option === sectionType}
          onToggle={(option) => setValue('sectionType', option, { shouldValidate: true })}
          renderLabel={(option) => t(sectionTypeLabelKey(option))}
          testIdPrefix="ai-section-type"
        />
        {promptOnly ? (
          <p className="text-xs text-muted-foreground" data-testid="ai-prompt-only-hint">
            {t('exercises.ai.field.promptOnlyHint')}
          </p>
        ) : null}
      </FieldBlock>

      <FieldBlock label={t('exercises.ai.field.topic')} htmlFor="ai-topic" error={errors.topic?.message}>
        <Textarea
          id="ai-topic"
          rows={3}
          placeholder={t('exercises.ai.field.topicPlaceholder')}
          {...register('topic')}
          data-testid="ai-topic-input"
        />
        {/* Story 4.4b seam (AC6c): the picked file SEEDS the free-text topic; it
            is NOT attached to the exercise — the "Use as topic" verb telegraphs
            that. Client-only (FU-4-3-B-1); no file reference is persisted. */}
        <button
          type="button"
          onClick={() => setTopicPickerOpen(true)}
          className="mt-1 self-start text-xs text-[color:var(--cl-accent)] hover:underline"
          data-testid="ai-topic-from-hub"
        >
          {t('knowledgeHub.picker.fromHub')}
        </button>
        <KnowledgeHubPicker
          open={topicPickerOpen}
          onOpenChange={setTopicPickerOpen}
          mode={{
            allowedTypes: 'all',
            selection: 'single',
            confirmVerbKey: 'knowledgeHub.picker.verb.useAsTopic',
            emptyKey: 'knowledgeHub.picker.empty.topic',
            onConfirm: (files) => {
              const picked = files[0]
              // Seed the free-text topic with the filename minus its extension —
              // "reading.pdf" as a generation topic reads as a filename, not a subject.
              if (picked) {
                setValue('topic', picked.name.replace(/\.[^/.]+$/, ''), { shouldValidate: true })
              }
            },
          }}
        />
      </FieldBlock>

      <FieldBlock label={t('exercises.ai.field.targetBand')}>
        <AiChipGroup<number>
          ariaLabel={t('exercises.ai.field.targetBand')}
          options={AI_TARGET_BAND_OPTIONS}
          selected={(option) => option === targetBand}
          onToggle={(option) => setValue('targetBand', option === targetBand ? null : option)}
          renderLabel={(option) => t('exercises.ai.bandValue', { band: option })}
          testIdPrefix="ai-target-band"
        />
      </FieldBlock>

      {promptOnly ? null : (
        <>
          <FieldBlock label={t('exercises.ai.field.questionCount')}>
            <AiChipGroup<number>
              ariaLabel={t('exercises.ai.field.questionCount')}
              options={AI_SECTION_QUESTION_COUNTS}
              selected={(option) => option === questionCount}
              onToggle={(option) =>
                setValue('questionCount', option === questionCount ? null : option)
              }
              renderLabel={(option) => t('exercises.ai.questionCount', { count: option })}
              testIdPrefix="ai-question-count"
            />
          </FieldBlock>

          <FieldBlock label={t('exercises.ai.field.questionMix')}>
            <AiChipGroup<QuestionGroupType>
              ariaLabel={t('exercises.ai.field.questionMix')}
              options={AI_QUESTION_MIX_TYPES}
              selected={(option) => questionMix.includes(option)}
              onToggle={(option) => setValue('questionMix', toggleMembership(questionMix, option))}
              renderLabel={(option) => t(questionTypeLabelKey(option))}
              testIdPrefix="ai-question-mix"
            />
          </FieldBlock>
        </>
      )}

      <AiConfigFooter
        credits={credits}
        isEnqueuing={isEnqueuing}
        enqueueError={enqueueError}
        onCancel={onCancel}
      />
    </form>
  )
}

function CountForm({
  mode,
  defaultCount,
  credits,
  isEnqueuing,
  enqueueError,
  onSubmit,
  onCancel,
}: SharedFormProps & {
  mode: 'questions' | 'distractors'
  defaultCount: number | null
  onSubmit: (count: number) => void
}) {
  const { t } = useTranslation()
  const options = mode === 'questions' ? AI_QUESTIONS_COUNTS : AI_DISTRACTORS_COUNTS
  const schema = useMemo(
    () => z.object({ count: z.number().int().min(1).max(20) }),
    [],
  )
  const {
    handleSubmit,
    watch,
    setValue,
  } = useForm<{ count: number }>({
    resolver: zodResolver(schema),
    defaultValues: { count: defaultCount ?? options[0] },
  })
  const count = watch('count')

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values.count))}
      className="flex flex-col gap-4"
      data-testid="ai-count-form"
    >
      <FieldBlock label={t('exercises.ai.field.count')}>
        <AiChipGroup<number>
          ariaLabel={t('exercises.ai.field.count')}
          options={options}
          selected={(option) => option === count}
          onToggle={(option) => setValue('count', option, { shouldValidate: true })}
          renderLabel={(option) => String(option)}
          testIdPrefix="ai-count"
        />
      </FieldBlock>

      <AiConfigFooter
        credits={credits}
        isEnqueuing={isEnqueuing}
        enqueueError={enqueueError}
        onCancel={onCancel}
      />
    </form>
  )
}

function AiConfigFooter({
  credits,
  isEnqueuing,
  enqueueError,
  onCancel,
}: SharedFormProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="ai-est-cost">
          {t('exercises.ai.estCost', { count: EST_CREDIT_COST })}
        </span>
        <span data-testid="ai-credit-counter">
          {t('exercises.ai.creditCounter', { used: credits.used, total: credits.total })}
        </span>
      </div>

      {enqueueError ? (
        <p
          role="alert"
          className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
          data-testid="ai-enqueue-error"
        >
          {humanEnqueueError(t, enqueueError)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} data-testid="ai-cancel">
          {t('exercises.ai.cancel')}
        </Button>
        <Button type="submit" disabled={isEnqueuing} data-testid="ai-generate-submit">
          {t('exercises.ai.generate')}
        </Button>
      </div>
    </div>
  )
}

// --- non-idle state panels ---------------------------------------------------

function GeneratingState({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-4 py-8 text-center"
      data-testid="ai-generating"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('exercises.ai.generating.message')}</p>
      <Button variant="ghost" size="sm" onClick={onCancel} data-testid="ai-generating-cancel">
        {t('exercises.ai.cancel')}
      </Button>
    </div>
  )
}

function StuckState({
  onRetry,
  onCancel,
  isEnqueuing,
}: {
  onRetry: () => void
  onCancel: () => void
  isEnqueuing: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4 py-6 text-center" data-testid="ai-stuck">
      <p className="text-sm font-medium">{t('exercises.ai.stuck.title')}</p>
      <p className="text-sm text-muted-foreground">{t('exercises.ai.stuck.body')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" onClick={onCancel} data-testid="ai-stuck-cancel">
          {t('exercises.ai.cancel')}
        </Button>
        <Button onClick={onRetry} disabled={isEnqueuing} data-testid="ai-stuck-retry">
          {t('exercises.ai.stuck.retry')}
        </Button>
      </div>
    </div>
  )
}

function FailedState({
  errorKind,
  onAdjust,
  onRetry,
  onCancel,
  isEnqueuing,
}: {
  errorKind: 'invalid_ai_response' | 'generation_failed' | null
  onAdjust: () => void
  onRetry: () => void
  onCancel: () => void
  isEnqueuing: boolean
}) {
  const { t } = useTranslation()
  const isInvalidResponse = errorKind === 'invalid_ai_response'
  return (
    <div className="flex flex-col gap-4 py-6 text-center" data-testid="ai-failed">
      <p className="text-sm font-medium text-[color:var(--cl-red)]" role="alert">
        {isInvalidResponse
          ? t('exercises.ai.failed.invalidResponse')
          : t('exercises.ai.failed.generic')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" onClick={onCancel} data-testid="ai-failed-cancel">
          {t('exercises.ai.cancel')}
        </Button>
        {isInvalidResponse ? (
          <Button onClick={onAdjust} data-testid="ai-failed-adjust">
            {t('exercises.ai.failed.adjust')}
          </Button>
        ) : (
          <>
            <Link
              to={EXERCISES_PATH}
              className={buttonVariants({ variant: 'outline' })}
              onClick={onCancel}
              data-testid="ai-failed-manual"
            >
              {t('exercises.ai.failed.manual')}
            </Link>
            <Button onClick={onRetry} disabled={isEnqueuing} data-testid="ai-failed-retry">
              {t('exercises.ai.failed.retry')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function FieldBlock({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{label}</Label>
      ) : (
        <span className="text-sm font-medium">{label}</span>
      )}
      {children}
      {error ? (
        <p className="text-xs text-[color:var(--cl-red)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
