/**
 * GapInput — Story 5.2b Task 6 (AC5). Text input for `fill_in_blank` /
 * `short_answer` (empty `options`). No client-side correctness / case logic —
 * grading is Epic 6. Reuses the `ui/input` primitive (FW-7).
 */
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import type { QuestionFieldProps } from './questionField'

export function GapInput({
  handle,
  questionNumber,
  question,
  value,
  onChange,
  disabled,
}: QuestionFieldProps) {
  const { t } = useTranslation()
  const inputId = `q-${handle}`
  return (
    <div className="flex flex-col gap-1.5" data-testid={`question-${handle}`}>
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[var(--cl-ink)]"
      >
        <span className="mr-1.5 text-[var(--cl-ink-soft)]">
          {t('attempt.question.label', { number: questionNumber })}
        </span>
        {question.text}
      </label>
      <Input
        id={inputId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('attempt.gap.placeholder')}
        aria-label={t('attempt.question.ariaLabel', {
          number: questionNumber,
          text: question.text,
        })}
        data-testid={`gap-input-${handle}`}
      />
    </div>
  )
}
