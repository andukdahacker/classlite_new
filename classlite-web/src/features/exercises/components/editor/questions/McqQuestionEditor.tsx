/**
 * McqQuestionEditor — Story 4.2 (AC3, authored — extends the T/F/NG KEY grid to
 * a variable list). A stem + an option list: add / remove / move-up-down rows,
 * each a text input, one radio marks the correct option → green "✓ KEY". The
 * stored `correctAnswer` is the option TEXT; renaming the correct option keeps
 * the key synced. Server invariants (≥2 options, no duplicates, correctAnswer ∈
 * options) are mirrored client-side but the server is authoritative (AC7).
 */
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { moveItem } from '../../../lib/editorDocument'
import type { QuestionEditorProps } from './props'
import { KeyBadge } from './KeyBadge'

const MIN_OPTIONS = 2

export function McqQuestionEditor({ question, idPrefix, onChange }: QuestionEditorProps) {
  const { t } = useTranslation()
  const options = question.options

  function setOptionText(index: number, text: string) {
    const nextOptions = options.map((opt, i) => (i === index ? text : opt))
    // Keep the key synced if the correct option is being renamed.
    const nextCorrect =
      options[index] === question.correctAnswer && question.correctAnswer !== ''
        ? text
        : question.correctAnswer
    onChange({ ...question, options: nextOptions, correctAnswer: nextCorrect })
  }

  function markCorrect(index: number) {
    onChange({ ...question, correctAnswer: options[index] })
  }

  function addOption() {
    onChange({ ...question, options: [...options, ''] })
  }

  function removeOption(index: number) {
    const removed = options[index]
    onChange({
      ...question,
      options: options.filter((_, i) => i !== index),
      correctAnswer: removed === question.correctAnswer ? '' : question.correctAnswer,
    })
  }

  function move(index: number, to: number) {
    onChange({ ...question, options: moveItem(options, index, to) })
  }

  return (
    <div className="flex flex-col gap-2" data-testid="mcq-question-editor">
      <Input
        value={question.text}
        onChange={(e) => onChange({ ...question, text: e.target.value })}
        placeholder={t('exercises.editor.question.stemPlaceholder')}
        aria-label={t('exercises.editor.question.stemPlaceholder')}
        data-testid="question-text"
      />
      <ul className="flex list-none flex-col gap-1.5 p-0">
        {options.map((option, i) => {
          const id = `${idPrefix}-mcq-${i}`
          // Match the FIRST occurrence only — if two options share the same text
          // (a duplicate, which the server rejects at finalize) exactly one row
          // shows as correct, never two checked radios in the same group.
          const isCorrect =
            option !== '' && option === question.correctAnswer && options.indexOf(option) === i
          return (
            <li key={i} className="flex items-center gap-2" data-testid="mcq-option-row">
              <input
                type="radio"
                name={`${idPrefix}-mcq-correct`}
                id={id}
                checked={isCorrect}
                onChange={() => markCorrect(i)}
                aria-label={t('exercises.editor.mcq.markCorrect', { number: i + 1 })}
                data-testid={`mcq-mark-correct-${i}`}
              />
              <Input
                value={option}
                onChange={(e) => setOptionText(i, e.target.value)}
                placeholder={t('exercises.editor.mcq.optionPlaceholder', { number: i + 1 })}
                aria-label={t('exercises.editor.mcq.optionPlaceholder', { number: i + 1 })}
                data-testid={`mcq-option-input-${i}`}
              />
              {isCorrect ? <KeyBadge /> : null}
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={t('exercises.editor.mcq.moveOptionUp', { number: i + 1 })}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === options.length - 1}
                aria-label={t('exercises.editor.mcq.moveOptionDown', { number: i + 1 })}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={options.length <= MIN_OPTIONS}
                aria-label={t('exercises.editor.mcq.removeOption', { number: i + 1 })}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                data-testid={`mcq-remove-option-${i}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={addOption}
        className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
        data-testid="mcq-add-option"
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('exercises.editor.mcq.addOption')}
      </button>
    </div>
  )
}
