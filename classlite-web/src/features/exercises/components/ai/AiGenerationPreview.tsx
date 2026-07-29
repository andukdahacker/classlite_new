/**
 * AiGenerationPreview — Story 4.3b (AC3). Renders a summary of the generated
 * `ExerciseContent` fragment (counts/band-agnostic shape) plus the four terminal
 * actions: Accept/Insert · Edit · Dismiss · Regenerate. Nothing is persisted
 * until the teacher chooses Accept or Edit (both merge via 4.2's autosave) —
 * Dismiss discards, Regenerate re-enqueues a fresh (paid) job.
 *
 * The summary follows the established interpolated stat-line precedent
 * (`exercises.meta.line`): a single i18n template per mode with the sectionType
 * noun and the counts interpolated — never clause concatenation (UX-2).
 */
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ExerciseContent } from '../../lib/editorTypes'
import { sectionTypeLabelKey } from '../../lib/sectionTypes'
import { summarizeFragment, type AiGenerationMode } from '../../lib/aiGeneration'

export interface AiGenerationPreviewProps {
  mode: AiGenerationMode
  content: ExerciseContent
  /** Disable Regenerate while a re-enqueue is in flight — a rapid double-click
   * would otherwise create a second paid job. */
  isEnqueuing: boolean
  onAccept: () => void
  onEdit: () => void
  onDismiss: () => void
  onRegenerate: () => void
}

export function AiGenerationPreview({
  mode,
  content,
  isEnqueuing,
  onAccept,
  onEdit,
  onDismiss,
  onRegenerate,
}: AiGenerationPreviewProps) {
  const { t } = useTranslation()
  const summary = summarizeFragment(content)

  let summaryLine: string
  if (mode === 'section') {
    summaryLine = t('exercises.ai.preview.sectionSummary', {
      sectionType: summary.sectionType
        ? t(sectionTypeLabelKey(summary.sectionType))
        : '',
      words: summary.words,
      questions: summary.questionCount,
    })
  } else if (mode === 'questions') {
    summaryLine = t('exercises.ai.preview.questionsSummary', {
      groups: summary.groupCount,
      questions: summary.questionCount,
    })
  } else {
    summaryLine = t('exercises.ai.preview.distractorsSummary', {
      options: summary.optionCount,
    })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ai-generation-preview">
      <div className="rounded-md border border-border bg-muted/40 p-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('exercises.ai.preview.heading')}
        </p>
        <p className="text-sm" data-testid="ai-preview-summary">
          {summaryLine}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onDismiss} data-testid="ai-preview-dismiss">
          {t('exercises.ai.preview.dismiss')}
        </Button>
        <Button
          variant="outline"
          onClick={onRegenerate}
          disabled={isEnqueuing}
          data-testid="ai-preview-regenerate"
        >
          {t('exercises.ai.preview.regenerate')}
        </Button>
        <Button variant="outline" onClick={onEdit} data-testid="ai-preview-edit">
          {t('exercises.ai.preview.edit')}
        </Button>
        <Button onClick={onAccept} data-testid="ai-preview-accept">
          {t('exercises.ai.preview.accept')}
        </Button>
      </div>
    </div>
  )
}
