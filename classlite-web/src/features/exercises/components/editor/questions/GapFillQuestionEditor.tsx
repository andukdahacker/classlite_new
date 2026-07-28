/**
 * GapFillQuestionEditor — Story 4.2 (AC3, authored — blank token per mockup
 * 02c:6135). The question text carries a `______` blank token; `correctAnswer`
 * is the primary answer (green "✓ KEY") and `acceptedVariants` are alternates.
 */
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { QuestionEditorProps } from './props'
import { KeyBadge } from './KeyBadge'
import { VariantChips } from './VariantChips'

const BLANK_TOKEN = '______'

export function GapFillQuestionEditor({ question, idPrefix, onChange }: QuestionEditorProps) {
  const { t } = useTranslation()
  const answerId = `${idPrefix}-gap-answer`
  return (
    <div className="flex flex-col gap-2" data-testid="gapfill-question-editor">
      <Input
        value={question.text}
        onChange={(e) => onChange({ ...question, text: e.target.value })}
        placeholder={t('exercises.editor.gapFill.textPlaceholder', { token: BLANK_TOKEN })}
        aria-label={t('exercises.editor.gapFill.textPlaceholder', { token: BLANK_TOKEN })}
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
