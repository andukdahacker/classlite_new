/**
 * ShortAnswerQuestionEditor — Story 4.2 (AC3, authored). A question stem +
 * `correctAnswer` (green "✓ KEY") + `acceptedVariants` chips. Same key pattern
 * as gap-fill without the blank token.
 */
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { QuestionEditorProps } from './props'
import { KeyBadge } from './KeyBadge'
import { VariantChips } from './VariantChips'

export function ShortAnswerQuestionEditor({ question, idPrefix, onChange }: QuestionEditorProps) {
  const { t } = useTranslation()
  const answerId = `${idPrefix}-short-answer`
  return (
    <div className="flex flex-col gap-2" data-testid="shortanswer-question-editor">
      <Input
        value={question.text}
        onChange={(e) => onChange({ ...question, text: e.target.value })}
        placeholder={t('exercises.editor.question.stemPlaceholder')}
        aria-label={t('exercises.editor.question.stemPlaceholder')}
        data-testid="question-text"
      />
      <div className="flex items-center gap-2">
        <Label htmlFor={answerId} className="shrink-0 font-normal">
          {t('exercises.editor.question.correctAnswerLabel')}
        </Label>
        <Input
          id={answerId}
          value={question.correctAnswer}
          onChange={(e) => onChange({ ...question, correctAnswer: e.target.value })}
          data-testid="question-correct-answer"
        />
        {question.correctAnswer.trim() !== '' ? <KeyBadge /> : null}
      </div>
      <VariantChips
        variants={question.acceptedVariants}
        onChange={(acceptedVariants) => onChange({ ...question, acceptedVariants })}
      />
    </div>
  )
}
