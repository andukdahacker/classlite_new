import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { QUESTION_CONTENT_MAX } from './AnchoredQuestionCard'

/**
 * BatchActionBar — `s18` multi-select batch-reply strip (Story 1d-4 inventory;
 * wired by the 7.4b teacher console, AC10). Shows "N selected · similar
 * questions" with a combined reply composer (content + personal/shared toggle +
 * "Reply to N" / optional "Reply & resolve" + clear). PRESENTATIONAL and
 * controlled — the console owns the batch mutation (all-or-nothing) and passes
 * values/handlers. Rendered only when a selection is active.
 */
export type BatchVisibility = 'personal' | 'shared'

export interface BatchActionBarProps {
  selectedCount: number
  value: string
  onChange: (value: string) => void
  visibility: BatchVisibility
  onVisibilityChange: (visibility: BatchVisibility) => void
  onReply: () => void
  onReplyResolve?: () => void
  onClear: () => void
  submitting?: boolean
  canSubmit?: boolean
  /** i18n-resolved error string (UX-1), never a raw code. */
  error?: string | null
}

export function BatchActionBar({
  selectedCount,
  value,
  onChange,
  visibility,
  onVisibilityChange,
  onReply,
  onReplyResolve,
  onClear,
  submitting = false,
  canSubmit = false,
  error = null,
}: BatchActionBarProps) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('questions.batch.label')}
      data-testid="batch-action-bar"
      className="flex flex-col gap-2 rounded-xl border border-[color:var(--cl-accent)] bg-[color:var(--cl-tint-blue)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground" data-testid="batch-action-bar-summary">
          {t('questions.batch.summary', { count: selectedCount })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          data-testid="batch-action-bar-clear"
        >
          {t('questions.batch.clear')}
        </Button>
      </div>

      <Textarea
        rows={2}
        maxLength={QUESTION_CONTENT_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={submitting}
        aria-label={t('questions.batch.contentLabel')}
        placeholder={t('questions.batch.contentPlaceholder')}
        data-testid="batch-action-bar-content"
      />

      <div
        role="group"
        aria-label={t('anchoredQuestion.visibility.label')}
        className="flex items-center gap-1"
      >
        {(['personal', 'shared'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={visibility === option ? 'default' : 'outline'}
            aria-pressed={visibility === option}
            disabled={submitting}
            data-testid={`batch-action-bar-visibility-${option}`}
            onClick={() => onVisibilityChange(option)}
          >
            {t(`anchoredQuestion.visibility.${option}`)}
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" data-testid="batch-action-bar-error" className="text-xs text-[color:var(--cl-danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {onReplyResolve ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSubmit || submitting}
            onClick={onReplyResolve}
            data-testid="batch-action-bar-reply-resolve"
          >
            {t('questions.batch.replyResolve')}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit || submitting}
          onClick={onReply}
          data-testid="batch-action-bar-reply"
        >
          {t('questions.batch.reply', { count: selectedCount })}
        </Button>
      </div>
    </div>
  )
}
