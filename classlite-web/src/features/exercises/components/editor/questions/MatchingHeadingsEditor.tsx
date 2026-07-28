/**
 * MatchingHeadingsEditor — Story 4.2 (AC3, authored — grounded in grading-view
 * 02c:8018 "iii — Storage challenges"). A TWO-COLUMN pairing:
 *   - left: a SHARED heading bank (add/remove/move, auto roman-numeral labels)
 *   - right: one item (paragraph reference) per group question, each selecting
 *     its correct heading from the bank → "✓ KEY"
 *
 * v1 representation: the bank is replicated into EVERY item's `options` (via
 * `withMatchingBank`); each item's `correctAnswer` is the chosen heading. This
 * editor is GROUP-level (the bank is shared), so it takes the whole group.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  matchingBank,
  newQuestion,
  renameMatchingHeading,
  withMatchingBank,
} from '../../../lib/questionTypes'
import { moveItem } from '../../../lib/editorDocument'
import type { QuestionGroup } from '../../../lib/editorTypes'
import { KeyBadge } from './KeyBadge'

export interface MatchingHeadingsEditorProps {
  group: QuestionGroup
  idPrefix: string
  onChange: (next: QuestionGroup) => void
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']

function romanLabel(index: number): string {
  return ROMAN[index] ?? `${index + 1}`
}

export function MatchingHeadingsEditor({ group, idPrefix, onChange }: MatchingHeadingsEditorProps) {
  const { t } = useTranslation()
  const bank = matchingBank(group)
  const items = group.questions
  // AC9 focus return: a deleted item's trash button unmounts, so return focus to
  // the always-present "add item" button rather than dropping it to <body>.
  const addItemRef = useRef<HTMLButtonElement>(null)

  function setBank(next: string[]) {
    onChange(withMatchingBank(group, next))
  }

  function deleteItem(qi: number) {
    onChange({ ...group, questions: items.filter((_, idx) => idx !== qi) })
    addItemRef.current?.focus()
  }

  function setItem(qi: number, patch: Partial<QuestionGroup['questions'][number]>) {
    onChange({
      ...group,
      questions: items.map((q, i) => (i === qi ? { ...q, ...patch } : q)),
    })
  }

  function addItem() {
    onChange({ ...group, questions: [...items, { ...newQuestion('matching'), options: bank }] })
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="matching-question-editor">
      {/* Heading bank */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('exercises.editor.matching.bankHeading')}
        </span>
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {bank.map((heading, i) => (
            <li key={i} className="flex items-center gap-1.5" data-testid="matching-heading-row">
              <span className="w-6 font-mono text-xs text-muted-foreground">{romanLabel(i)}.</span>
              <Input
                value={heading}
                onChange={(e) => onChange(renameMatchingHeading(group, i, e.target.value))}
                aria-label={t('exercises.editor.matching.headingLabel', { label: romanLabel(i) })}
                data-testid={`matching-heading-input-${i}`}
              />
              <button
                type="button"
                onClick={() => setBank(moveItem(bank, i, i - 1))}
                disabled={i === 0}
                aria-label={t('exercises.editor.matching.moveHeadingUp', { label: romanLabel(i) })}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setBank(moveItem(bank, i, i + 1))}
                disabled={i === bank.length - 1}
                aria-label={t('exercises.editor.matching.moveHeadingDown', { label: romanLabel(i) })}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setBank(bank.filter((_, idx) => idx !== i))}
                aria-label={t('exercises.editor.matching.removeHeading', { label: romanLabel(i) })}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                data-testid={`matching-remove-heading-${i}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setBank([...bank, ''])}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
          data-testid="matching-add-heading"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('exercises.editor.matching.addHeading')}
        </button>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('exercises.editor.matching.itemsHeading')}
        </span>
        <ul className="flex list-none flex-col gap-2 p-0">
          {items.map((item, qi) => {
            const selectId = `${idPrefix}-match-item-${qi}`
            return (
              <li key={qi} className="flex flex-col gap-1.5" data-testid="matching-item-row">
                <Input
                  value={item.text}
                  onChange={(e) => setItem(qi, { text: e.target.value })}
                  placeholder={t('exercises.editor.matching.itemPlaceholder', { number: qi + 1 })}
                  aria-label={t('exercises.editor.matching.itemPlaceholder', { number: qi + 1 })}
                  data-testid={`matching-item-input-${qi}`}
                />
                <div className="flex items-center gap-2">
                  <Label htmlFor={selectId} className="shrink-0 text-xs font-normal">
                    {t('exercises.editor.matching.selectHeading')}
                  </Label>
                  <select
                    id={selectId}
                    value={item.correctAnswer}
                    onChange={(e) => setItem(qi, { correctAnswer: e.target.value })}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                    data-testid={`matching-item-select-${qi}`}
                  >
                    <option value="">{t('exercises.editor.matching.noSelection')}</option>
                    {bank.map((heading, hi) => (
                      <option key={hi} value={heading}>
                        {romanLabel(hi)}. {heading}
                      </option>
                    ))}
                  </select>
                  {item.correctAnswer !== '' ? <KeyBadge /> : null}
                  <button
                    type="button"
                    onClick={() => deleteItem(qi)}
                    disabled={items.length <= 1}
                    aria-label={t('exercises.editor.matching.removeItem', { number: qi + 1 })}
                    className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    data-testid={`matching-remove-item-${qi}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <button
          ref={addItemRef}
          type="button"
          onClick={addItem}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
          data-testid="matching-add-item"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('exercises.editor.matching.addItem')}
        </button>
      </div>
    </div>
  )
}
