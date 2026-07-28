/**
 * EditorMetadataSidebar — Story 4.2 (AC1/AC6/AC8). The left 300px metadata pane:
 * title / description / skill / tags / target band. Controlled inputs feeding
 * the document autosave — NO RHF (the editor is FW-8 document-exempt). Title is
 * required: a blank value shows an inline message here AND holds the autosave in
 * the `unsaved` state (the validity gate lives in useExerciseAutosave). There is
 * NO assigned-classes control (Epic 5).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  EXERCISE_SKILLS,
  EXERCISE_TITLE_MAX_RUNES,
  TARGET_BAND_MAX,
  TARGET_BAND_MIN,
  parseTagsInput,
} from '../../lib/exerciseSchema'
import type { ExerciseSkill } from '../../lib/editorTypes'

export interface EditorMetadataValues {
  title: string
  description: string | null
  skill: ExerciseSkill
  tags: string[]
  targetBand: number | null
}

export interface EditorMetadataSidebarProps extends EditorMetadataValues {
  onChange: (patch: Partial<EditorMetadataValues>) => void
}

const BAND_STEP = 0.5

export function EditorMetadataSidebar({
  title,
  description,
  skill,
  tags,
  targetBand,
  onChange,
}: EditorMetadataSidebarProps) {
  const { t } = useTranslation()
  // Tags are edited as free text so typing a separator does not fight a live
  // re-parse; the parsed array flows to the document on each edit. `emittedRef`
  // holds the array WE last produced — when the incoming `tags` prop differs by
  // reference, an EXTERNAL source (a 409 reload) replaced it, so the free-text
  // field is reseeded. Our own edits pass the same array back through, so typing
  // never triggers a reseed (no cursor jump).
  const [tagsText, setTagsText] = useState(() => tags.join(', '))
  const emittedRef = useRef<string[]>(tags)
  useEffect(() => {
    if (tags !== emittedRef.current) {
      emittedRef.current = tags
      setTagsText(tags.join(', '))
    }
  }, [tags])
  const titleBlank = title.trim() === ''

  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-4 border-r border-border p-4 md:w-[var(--cl-side-panel,300px)]"
      aria-label={t('exercises.editor.metadata.paneLabel')}
      data-testid="editor-metadata-sidebar"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-title">{t('exercises.editor.metadata.titleLabel')}</Label>
        <Input
          id="editor-title"
          value={title}
          maxLength={EXERCISE_TITLE_MAX_RUNES}
          aria-invalid={titleBlank}
          aria-describedby={titleBlank ? 'editor-title-error' : undefined}
          onChange={(e) => onChange({ title: e.target.value })}
          data-testid="editor-title"
        />
        {titleBlank ? (
          <p id="editor-title-error" role="alert" className="text-xs text-destructive">
            {t('exercises.editor.metadata.titleRequired')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-description">
          {t('exercises.editor.metadata.descriptionLabel')}
        </Label>
        <Textarea
          id="editor-description"
          value={description ?? ''}
          rows={3}
          onChange={(e) =>
            onChange({ description: e.target.value === '' ? null : e.target.value })
          }
          data-testid="editor-description"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-skill">{t('exercises.editor.metadata.skillLabel')}</Label>
        <select
          id="editor-skill"
          value={skill}
          onChange={(e) => onChange({ skill: e.target.value as ExerciseSkill })}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          data-testid="editor-skill"
        >
          {EXERCISE_SKILLS.map((s) => (
            <option key={s} value={s}>
              {t(`exercises.skill.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-tags">{t('exercises.editor.metadata.tagsLabel')}</Label>
        <Input
          id="editor-tags"
          value={tagsText}
          placeholder={t('exercises.editor.metadata.tagsPlaceholder')}
          onChange={(e) => {
            setTagsText(e.target.value)
            const parsed = parseTagsInput(e.target.value)
            emittedRef.current = parsed
            onChange({ tags: parsed })
          }}
          data-testid="editor-tags"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-target-band">
          {t('exercises.editor.metadata.targetBandLabel')}
        </Label>
        <Input
          id="editor-target-band"
          type="number"
          inputMode="decimal"
          step={BAND_STEP}
          min={TARGET_BAND_MIN}
          max={TARGET_BAND_MAX}
          value={targetBand ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange({ targetBand: null })
              return
            }
            // Guard `NaN` (a bare `Number(raw)` would render `value={NaN}` and
            // desync the doc) and clamp to the server's band range so an
            // out-of-range value never 422s the autosave. (Review P2)
            const parsed = Number(raw)
            if (!Number.isFinite(parsed)) return
            const band = Math.min(TARGET_BAND_MAX, Math.max(TARGET_BAND_MIN, parsed))
            onChange({ targetBand: band })
          }}
          data-testid="editor-target-band"
        />
      </div>
    </aside>
  )
}
