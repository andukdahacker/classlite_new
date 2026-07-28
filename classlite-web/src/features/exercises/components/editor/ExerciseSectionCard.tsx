/**
 * ExerciseSectionCard — Story 4.2 (AC2/AC5/AC9). One section: a skill-colored
 * type badge, an editable title, a TYPE-APPROPRIATE content field, and — for
 * group-hosting types — its question groups (reorderable) + an add-group
 * control. Writing/Speaking are prompt-only (no groups). Delete prompts a
 * confirm naming the group count; focus return after delete is the page's job.
 *
 * Content field by type (AC2):
 *   - Reading / Grammar → a fill-text passage (Textarea)
 *   - Listening → an audio-URL field with inline validity + a preview + an
 *     honest "file upload coming soon" helper (Story 4.4 owns upload)
 *   - Writing / Speaking → a prompt Textarea (prompt-only, no groups)
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SortableItem, SortableList } from './SortableList'
import { QuestionGroupCard } from './QuestionGroupCard'
import {
  isAudioSection,
  isPromptOnlySection,
  sectionContentLabelKey,
  sectionTypeColor,
  sectionTypeLabelKey,
} from '../../lib/sectionTypes'
import {
  QUESTION_GROUP_TYPES,
  newQuestionGroup,
  questionTypeLabelKey,
} from '../../lib/questionTypes'
import { moveItem } from '../../lib/editorDocument'
import type { ExerciseSection, QuestionGroup } from '../../lib/editorTypes'

export interface ExerciseSectionCardProps {
  section: ExerciseSection
  idPrefix: string
  index: number
  onChange: (next: ExerciseSection) => void
  onDelete: () => void
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function ExerciseSectionCard({
  section,
  idPrefix,
  index,
  onChange,
  onDelete,
}: ExerciseSectionCardProps) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const promptOnly = isPromptOnlySection(section.type)
  const groups = section.questionGroups
  // AC9 focus return: a deleted group's trash button unmounts, so return focus to
  // the always-present add-group control rather than dropping it to <body>.
  const addGroupRef = useRef<HTMLButtonElement>(null)

  function setGroup(gi: number, next: QuestionGroup) {
    onChange({ ...section, questionGroups: groups.map((g, i) => (i === gi ? next : g)) })
  }

  function deleteGroup(gi: number) {
    onChange({ ...section, questionGroups: groups.filter((_, i) => i !== gi) })
    addGroupRef.current?.focus()
  }

  const audioInvalid =
    isAudioSection(section.type) && section.content !== '' && !isValidHttpUrl(section.content)

  // AC2: a section that has content prompts a confirm; a pristine empty section
  // deletes straight away (no needless modal).
  const hasContent =
    section.title.trim() !== '' || section.content.trim() !== '' || groups.length > 0

  function requestDelete() {
    if (hasContent) setConfirmOpen(true)
    else onDelete()
  }

  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-testid="section-card"
      data-section-index={index}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{index + 1}</span>
        <Badge
          className="text-white"
          style={{ backgroundColor: sectionTypeColor(section.type) }}
          data-testid="section-type-badge"
        >
          {t(sectionTypeLabelKey(section.type))}
        </Badge>
        <Input
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          placeholder={t('exercises.editor.section.titlePlaceholder')}
          aria-label={t('exercises.editor.section.titlePlaceholder')}
          className="flex-1"
          data-testid="section-title"
        />
        <button
          type="button"
          onClick={requestDelete}
          aria-label={t('exercises.editor.section.delete')}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
          data-testid="section-delete"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Type-appropriate content field */}
      <div className="mb-4 flex flex-col gap-1.5">
        <label
          htmlFor={`${idPrefix}-content`}
          className="text-xs font-medium text-muted-foreground"
        >
          {t(sectionContentLabelKey(section.type))}
        </label>
        {isAudioSection(section.type) ? (
          <>
            <Input
              id={`${idPrefix}-content`}
              value={section.content}
              onChange={(e) => onChange({ ...section, content: e.target.value })}
              placeholder="https://…"
              aria-invalid={audioInvalid}
              aria-describedby={`${idPrefix}-audio-helper`}
              data-testid="section-audio-url"
            />
            {audioInvalid ? (
              <p role="alert" className="text-xs text-destructive">
                {t('exercises.editor.section.audioUrlInvalid')}
              </p>
            ) : null}
            {section.content !== '' && !audioInvalid ? (
              <audio
                controls
                src={section.content}
                className="mt-1 w-full"
                data-testid="section-audio-preview"
              >
                <track kind="captions" />
              </audio>
            ) : null}
            <p id={`${idPrefix}-audio-helper`} className="text-xs text-muted-foreground">
              {t('exercises.editor.section.audioUploadComingSoon')}
            </p>
          </>
        ) : (
          <Textarea
            id={`${idPrefix}-content`}
            value={section.content}
            rows={promptOnly ? 3 : 5}
            onChange={(e) => onChange({ ...section, content: e.target.value })}
            data-testid="section-content"
          />
        )}
      </div>

      {/* Question groups (group-hosting types only) */}
      {promptOnly ? null : (
        <div className="flex flex-col gap-3">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="section-empty-groups">
              {t('exercises.editor.section.emptyGroups')}
            </p>
          ) : (
            <SortableList
              idPrefix={`${idPrefix}-g`}
              count={groups.length}
              onReorder={(from, to) =>
                onChange({ ...section, questionGroups: moveItem(groups, from, to) })
              }
              ariaLabel={t('exercises.editor.section.groupsListLabel')}
            >
              {groups.map((group, gi) => (
                <SortableItem
                  key={gi}
                  idPrefix={`${idPrefix}-g`}
                  index={gi}
                  total={groups.length}
                  itemLabel={t('exercises.editor.group.label', { number: gi + 1 })}
                  onMoveUp={() =>
                    onChange({ ...section, questionGroups: moveItem(groups, gi, gi - 1) })
                  }
                  onMoveDown={() =>
                    onChange({ ...section, questionGroups: moveItem(groups, gi, gi + 1) })
                  }
                >
                  <QuestionGroupCard
                    group={group}
                    idPrefix={`${idPrefix}-g${gi}`}
                    onChange={(next) => setGroup(gi, next)}
                    onDelete={() => deleteGroup(gi)}
                  />
                </SortableItem>
              ))}
            </SortableList>
          )}

          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t('exercises.editor.section.addGroupLabel')}
          >
            <span className="text-xs text-muted-foreground">
              {t('exercises.editor.section.addGroupLabel')}
            </span>
            {QUESTION_GROUP_TYPES.map((type, ti) => (
              <button
                key={type}
                ref={ti === 0 ? addGroupRef : undefined}
                type="button"
                onClick={() =>
                  onChange({ ...section, questionGroups: [...groups, newQuestionGroup(type)] })
                }
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                data-testid={`add-group-${type}`}
              >
                <Plus className="size-3" aria-hidden="true" />
                {t(questionTypeLabelKey(type))}
              </button>
            ))}
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="section-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('exercises.editor.section.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('exercises.editor.section.deleteConfirmBody', { count: groups.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('exercises.editor.section.deleteCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                onDelete()
              }}
              data-testid="section-delete-confirm-action"
            >
              {t('exercises.editor.section.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
