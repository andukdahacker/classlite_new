/**
 * QuestionGroupCard — Story 4.2 (AC3/AC5). A question group inside a section: a
 * type badge + instructions + its questions. For `matching` the group renders
 * the two-column MatchingHeadingsEditor (group-level shared bank); every other
 * type renders a reorderable list of per-question editors with add/remove
 * (≥1 question enforced in the UI + server). The card is wrapped by a
 * SortableItem in the section card (that provides the group's own reorder).
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SortableItem, SortableList } from './SortableList'
import { newQuestion, questionTypeLabelKey } from '../../lib/questionTypes'
import { moveItem } from '../../lib/editorDocument'
import type { ExerciseQuestion, QuestionGroup } from '../../lib/editorTypes'
import { TfngQuestionEditor } from './questions/TfngQuestionEditor'
import { McqQuestionEditor } from './questions/McqQuestionEditor'
import { GapFillQuestionEditor } from './questions/GapFillQuestionEditor'
import { ShortAnswerQuestionEditor } from './questions/ShortAnswerQuestionEditor'
import { MatchingHeadingsEditor } from './questions/MatchingHeadingsEditor'
import type { QuestionEditorProps } from './questions/props'

export interface QuestionGroupCardProps {
  group: QuestionGroup
  idPrefix: string
  onChange: (next: QuestionGroup) => void
  onDelete: () => void
}

const PER_QUESTION_EDITORS: Record<
  Exclude<QuestionGroup['type'], 'matching'>,
  (props: QuestionEditorProps) => React.JSX.Element
> = {
  true_false_not_given: TfngQuestionEditor,
  multiple_choice: McqQuestionEditor,
  fill_in_blank: GapFillQuestionEditor,
  short_answer: ShortAnswerQuestionEditor,
}

export function QuestionGroupCard({ group, idPrefix, onChange, onDelete }: QuestionGroupCardProps) {
  const { t } = useTranslation()
  const questions = group.questions
  // AC9 focus return: a deleted question's trash button is unmounted, so focus
  // would drop to <body>. Return it to the always-present "add question" button.
  const addQuestionRef = useRef<HTMLButtonElement>(null)

  function setQuestion(qi: number, next: ExerciseQuestion) {
    onChange({ ...group, questions: questions.map((q, i) => (i === qi ? next : q)) })
  }

  function deleteQuestion(qi: number) {
    onChange({ ...group, questions: questions.filter((_, i) => i !== qi) })
    addQuestionRef.current?.focus()
  }

  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid="question-group-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge variant="secondary" data-testid="question-group-type-badge">
          {t(questionTypeLabelKey(group.type))}
        </Badge>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('exercises.editor.group.delete')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
          data-testid="question-group-delete"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      <Input
        value={group.instructions}
        onChange={(e) => onChange({ ...group, instructions: e.target.value })}
        placeholder={t('exercises.editor.group.instructionsPlaceholder')}
        aria-label={t('exercises.editor.group.instructionsPlaceholder')}
        className="mb-3"
        data-testid="question-group-instructions"
      />

      {group.type === 'matching' ? (
        <MatchingHeadingsEditor group={group} idPrefix={idPrefix} onChange={onChange} />
      ) : (
        <>
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="question-group-empty">
              {t(`exercises.editor.emptyQuestions.${group.type}`)}
            </p>
          ) : null}
          <SortableList
            idPrefix={`${idPrefix}-q`}
            count={questions.length}
            onReorder={(from, to) =>
              onChange({ ...group, questions: moveItem(questions, from, to) })
            }
            ariaLabel={t('exercises.editor.group.questionsListLabel')}
          >
            {questions.map((question, qi) => {
              const Editor =
                PER_QUESTION_EDITORS[
                  group.type as Exclude<QuestionGroup['type'], 'matching'>
                ]
              return (
                <SortableItem
                  key={qi}
                  idPrefix={`${idPrefix}-q`}
                  index={qi}
                  total={questions.length}
                  itemLabel={t('exercises.editor.group.questionLabel', { number: qi + 1 })}
                  onMoveUp={() =>
                    onChange({ ...group, questions: moveItem(questions, qi, qi - 1) })
                  }
                  onMoveDown={() =>
                    onChange({ ...group, questions: moveItem(questions, qi, qi + 1) })
                  }
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Editor
                        question={question}
                        idPrefix={`${idPrefix}-q${qi}`}
                        onChange={(next: ExerciseQuestion) => setQuestion(qi, next)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteQuestion(qi)}
                      disabled={questions.length <= 1}
                      aria-label={t('exercises.editor.group.deleteQuestion', { number: qi + 1 })}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"
                      data-testid={`question-delete-${qi}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </SortableItem>
              )
            })}
          </SortableList>
          <button
            ref={addQuestionRef}
            type="button"
            onClick={() => onChange({ ...group, questions: [...questions, newQuestion(group.type)] })}
            className="mt-2 inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
            data-testid="question-group-add-question"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('exercises.editor.group.addQuestion')}
          </button>
        </>
      )}
    </div>
  )
}
