/**
 * TfngQuestionEditor — Story 4.2 (AC3, mockup-canonical 02c:6108-6124). A fixed
 * True / Not Given / False triad; the teacher marks exactly one correct →
 * green "✓ KEY". No add/remove (the triad is fixed). `correctAnswer` ∈
 * {true, notGiven, false}; `options` unused.
 */
import { useTranslation } from 'react-i18next'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TFNG_ANSWERS } from '../../../lib/questionTypes'
import { KeyBadge } from './KeyBadge'
import type { QuestionEditorProps } from './props'

export function TfngQuestionEditor({ question, idPrefix, onChange }: QuestionEditorProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2" data-testid="tfng-question-editor">
      <Input
        value={question.text}
        onChange={(e) => onChange({ ...question, text: e.target.value })}
        placeholder={t('exercises.editor.question.statementPlaceholder')}
        aria-label={t('exercises.editor.question.statementPlaceholder')}
        data-testid="question-text"
      />
      <RadioGroup
        value={question.correctAnswer}
        onValueChange={(value) => onChange({ ...question, correctAnswer: value })}
        className="flex flex-col gap-1.5"
      >
        {TFNG_ANSWERS.map((answer) => {
          const id = `${idPrefix}-tfng-${answer}`
          const selected = question.correctAnswer === answer
          return (
            <div key={answer} className="flex items-center gap-2">
              <RadioGroupItem value={answer} id={id} data-testid={`tfng-option-${answer}`} />
              <Label htmlFor={id} className="font-normal">
                {t(`exercises.editor.tfng.${answer}`)}
              </Label>
              {selected ? <KeyBadge /> : null}
            </div>
          )
        })}
      </RadioGroup>
    </div>
  )
}
