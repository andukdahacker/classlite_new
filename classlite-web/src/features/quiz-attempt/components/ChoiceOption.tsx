/**
 * ChoiceOption — Story 5.2b Task 6 (AC4). Radio input for the single-choice
 * groups: `true_false_not_given` → the fixed `true / notGiven / false` triad
 * (TFNG_ANSWERS order), `multiple_choice` → the question's `options`. Reuses the
 * `ui/radio-group` primitive (FW-7); the answer reduces to one chosen string.
 */
import { useTranslation } from 'react-i18next'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { TFNG_ANSWERS } from '@/features/exercises/lib/questionTypes'
import type { QuestionFieldProps } from './questionField'

type ChoiceOptionProps = QuestionFieldProps & {
  /** The parent group type — decides the choice set. */
  groupType: 'true_false_not_given' | 'multiple_choice'
}

export function ChoiceOption({
  handle,
  questionNumber,
  question,
  groupType,
  value,
  onChange,
  disabled,
}: ChoiceOptionProps) {
  const { t } = useTranslation()

  const choices: { value: string; label: string }[] =
    groupType === 'true_false_not_given'
      ? TFNG_ANSWERS.map((answer) => ({
          value: answer,
          label: t(`attempt.tfng.${answer}`),
        }))
      : question.options.map((option) => ({ value: option, label: option }))

  const legendId = `q-${handle}-legend`

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-labelledby={legendId}
      data-testid={`question-${handle}`}
    >
      <legend
        id={legendId}
        className="text-sm font-medium text-[var(--cl-ink)]"
      >
        <span className="mr-1.5 text-[var(--cl-ink-soft)]">
          {t('attempt.question.label', { number: questionNumber })}
        </span>
        {question.text}
      </legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(String(next))}
        disabled={disabled}
        className="flex flex-col gap-1.5"
      >
        {choices.map((choice) => {
          const id = `q-${handle}-${choice.value}`
          return (
            <label
              key={choice.value}
              htmlFor={id}
              className="flex items-center gap-2 text-sm text-[var(--cl-ink)]"
            >
              <RadioGroupItem
                id={id}
                value={choice.value}
                disabled={disabled}
                data-testid={`choice-${handle}-${choice.value}`}
              />
              {choice.label}
            </label>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}
