/**
 * ExerciseEditorPage — Story 4.2 (AC1/AC5/AC6/AC8/AC9). The s16 two-panel
 * structured editor at /exercises/:id/edit. Its own lazy Rolldown chunk under
 * the inherited /exercises RouteRoleGate (students never download it).
 *
 * The page owns the GET query + the trilogy (skeleton / error+retry / 404).
 * Once the exercise loads, <ExerciseEditor> holds the working document in local
 * state (seeded once) and drives the non-optimistic, validity-gated,
 * concurrency-guarded autosave. Saves fire from EDIT HANDLERS (never a
 * document-watching effect), so the FW-4 loop class cannot occur and a
 * zero-edit load fires zero PATCHes; `scheduleSave`/`flush` are stable
 * callbacks so any consumer effect stays safe too.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { Skeleton } from '@/components/ui/skeleton'
import { Button, buttonVariants } from '@/components/ui/button'
import { useEditorStore } from '@/stores/editorStore'
import { useExercise, type Exercise } from './api/useExercise'
import { exerciseKeys } from './api/exercisesKeys'
import { useExerciseAutosave } from './hooks/useExerciseAutosave'
import {
  addSection,
  deleteSection,
  moveSection,
  replaceSection,
  updateSettings,
} from './lib/editorDocument'
import { mergeGeneratedFragment, type InsertTarget } from './lib/fragmentMerge'
import type { EditorDocument, ExerciseContent, ExerciseSectionType } from './lib/editorTypes'
import { AIGenerateDialog, type AiGenerateOpenRequest } from './AIGenerateDialog'
import type { AiGenerationMode } from './lib/aiGeneration'
import { EditorMetadataSidebar, type EditorMetadataValues } from './components/editor/EditorMetadataSidebar'
import { EditorAutoSaveIndicator } from './components/editor/EditorAutoSaveIndicator'
import { ExerciseSectionCard } from './components/editor/ExerciseSectionCard'
import { SectionTypePicker } from './components/editor/SectionTypePicker'
import { ExerciseSettingsPanel } from './components/editor/ExerciseSettingsPanel'
import { SortableItem, SortableList } from './components/editor/SortableList'

const NOT_FOUND_STATUS = 404
const EXERCISES_PATH = '/exercises'

function fromExercise(exercise: Exercise): EditorDocument {
  return {
    title: exercise.title,
    description: exercise.description,
    skill: exercise.skill,
    tags: exercise.tags,
    targetBand: exercise.targetBand,
    content: exercise.content,
  }
}

export function ExerciseEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const query = useExercise(id)

  if (query.isLoading) return <EditorSkeleton />

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === NOT_FOUND_STATUS
    return (
      <div className="p-8 text-center" data-testid="editor-error">
        <p className="mb-4 text-muted-foreground">
          {notFound
            ? t('exercises.editor.notFound')
            : t('exercises.editor.loadError')}
        </p>
        {notFound ? (
          <Link to={EXERCISES_PATH} className={buttonVariants({ variant: 'outline' })}>
            {t('exercises.editor.backToLibrary')}
          </Link>
        ) : (
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('exercises.editor.retry')}
          </Button>
        )}
      </div>
    )
  }

  if (!query.data || !id) return <EditorSkeleton />

  // `key` on the id so navigating between exercises re-seeds cleanly.
  return <ExerciseEditor key={id} exerciseId={id} exercise={query.data} />
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:flex-row" data-testid="editor-skeleton">
      <div className="flex w-full shrink-0 flex-col gap-3 border-r border-border p-4 md:w-[300px]">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

interface ExerciseEditorProps {
  exerciseId: string
  exercise: Exercise
}

function ExerciseEditor({ exerciseId, exercise }: ExerciseEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const resetEditorStore = useEditorStore((s) => s.reset)

  const [doc, setDocState] = useState<EditorDocument>(() => fromExercise(exercise))
  const docRef = useRef(doc)
  const { scheduleSave, flush, conflict, resolveConflict } = useExerciseAutosave(
    exerciseId,
    exercise.updatedAt,
  )
  // Mirror `conflict` into a ref so `applyEdit` can read it without re-creating.
  const conflictRef = useRef(conflict)
  useEffect(() => {
    conflictRef.current = conflict
  }, [conflict])

  // Reset the shared save-status store on unmount so a later editor mount starts
  // from `idle`, not a stale `saved`/`error` (TEST-FE-3 reset discipline).
  useEffect(() => resetEditorStore, [resetEditorStore])

  /** Apply a user edit: update local state + schedule a debounced save. Saves
   * originate ONLY here (never a document effect) — the FW-4 loop guard. During
   * a 409 reload the save is suppressed: the precondition is stale (it would
   * 409 again) and the reload is about to overwrite local state with server
   * truth, so scheduling a doomed save is pointless. */
  const applyEdit = useCallback(
    (next: EditorDocument) => {
      docRef.current = next
      setDocState(next)
      if (!conflictRef.current) scheduleSave(next)
    },
    [scheduleSave],
  )

  /** Seed local state WITHOUT scheduling a save (initial load / 409 reload). */
  const seed = useCallback((next: EditorDocument) => {
    docRef.current = next
    setDocState(next)
  }, [])

  // 409 conflict recovery — another writer won; reload fresh server truth and
  // re-arm the precondition. Local unsaved edits are discarded (they were
  // rejected). A non-blocking banner (below) covers the reload window. If the
  // reload GET itself fails, the banner surfaces a retry (bumping `reloadNonce`
  // re-runs this effect) instead of wedging the editor in a stuck error state.
  const [reloadNonce, setReloadNonce] = useState(0)
  const [reloadFailed, setReloadFailed] = useState(false)
  useEffect(() => {
    if (!conflict) return
    let active = true
    void (async () => {
      try {
        const fresh = await apiFetch<Exercise>(`/api/exercises/${exerciseId}`)
        if (!active) return
        queryClient.setQueryData(exerciseKeys.detail(exerciseId), fresh)
        seed(fromExercise(fresh))
        resolveConflict(fresh.updatedAt)
        setReloadFailed(false)
        useEditorStore.getState().setSaveStatus('idle')
      } catch {
        if (!active) return
        setReloadFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [conflict, reloadNonce, exerciseId, queryClient, seed, resolveConflict])

  const pickerRef = useRef<HTMLButtonElement>(null)
  const [focusPickerTick, setFocusPickerTick] = useState(0)
  useEffect(() => {
    if (focusPickerTick === 0) return
    pickerRef.current?.focus()
  }, [focusPickerTick])

  // Story 4.3b — the AI generate dialog. `request` is what the dialog renders;
  // `target` is where an accepted fragment merges (kept together so the dialog
  // never has to decode the index-based id handle).
  const [aiGenerate, setAiGenerate] = useState<{
    request: AiGenerateOpenRequest
    target: InsertTarget
  } | null>(null)

  function openGenerateSection() {
    setAiGenerate({ request: { mode: 'section' }, target: { kind: 'section' } })
  }
  function openGenerateQuestions(sectionIndex: number) {
    setAiGenerate({
      request: { mode: 'questions', targetId: String(sectionIndex) },
      target: { kind: 'questions', sectionIndex },
    })
  }
  function openGenerateDistractors(sectionIndex: number, groupIndex: number, questionIndex: number) {
    setAiGenerate({
      request: {
        mode: 'distractors',
        targetId: `${sectionIndex}:${groupIndex}:${questionIndex}`,
      },
      target: { kind: 'distractors', sectionIndex, groupIndex, questionIndex },
    })
  }
  // Story 4.3b — after an "Insert & edit" (focus:true) the teacher should land on
  // the section the fragment merged into; Accept (focus:false) merges silently.
  // `nonce` re-fires the effect even when the same index is targeted twice.
  const [focusRequest, setFocusRequest] = useState<{ index: number; nonce: number } | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    const el = document.querySelector<HTMLElement>(
      `[data-section-index="${focusRequest.index}"]`,
    )
    el?.scrollIntoView({ block: 'start' })
    el?.focus()
  }, [focusRequest])

  function onInsertGenerated(
    _mode: AiGenerationMode,
    content: ExerciseContent,
    opts: { focus: boolean },
  ) {
    if (!aiGenerate) return
    const target = aiGenerate.target
    // Merge rides 4.2's autosave — `applyEdit` schedules the debounced PATCH.
    const merged = mergeGeneratedFragment(docRef.current, target, content)
    applyEdit(merged)
    if (opts.focus) {
      // section → the newly-appended last section; questions/distractors → the
      // section the fragment merged into.
      const index =
        target.kind === 'section'
          ? merged.content.sections.length - 1
          : target.sectionIndex
      setFocusRequest((prev) => ({ index, nonce: (prev?.nonce ?? 0) + 1 }))
    }
  }

  const sections = doc.content.sections

  function onMetadataChange(patch: Partial<EditorMetadataValues>) {
    applyEdit({ ...docRef.current, ...patch })
  }

  function onAddSection(type: ExerciseSectionType) {
    applyEdit(addSection(docRef.current, type))
  }

  function onDeleteSection(index: number) {
    applyEdit(deleteSection(docRef.current, index))
    // AC9 focus flow — return focus to the add-section prompt.
    setFocusPickerTick((n) => n + 1)
  }

  return (
    <div className="flex flex-col md:flex-row" data-testid="exercise-editor">
      <EditorMetadataSidebar
        title={doc.title}
        description={doc.description}
        skill={doc.skill}
        tags={doc.tags}
        targetBand={doc.targetBand}
        onChange={onMetadataChange}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={EXERCISES_PATH}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            data-testid="editor-back-link"
          >
            ← {t('exercises.editor.backToLibrary')}
          </Link>
          <div className="flex items-center gap-3">
            <EditorAutoSaveIndicator onRetry={() => void flush()} />
            <Button size="sm" onClick={() => void flush()} data-testid="editor-save-button">
              {t('exercises.editor.saveButton')}
            </Button>
          </div>
        </header>

        {conflict ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="editor-conflict-banner"
          >
            <span>
              {reloadFailed
                ? t('exercises.editor.conflictReloadFailed')
                : t('exercises.editor.conflictReloading')}
            </span>
            {reloadFailed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReloadFailed(false)
                  setReloadNonce((n) => n + 1)
                }}
                data-testid="editor-conflict-retry"
              >
                {t('exercises.editor.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {sections.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground" data-testid="editor-empty-sections">
            {t('exercises.editor.emptySections')}
          </p>
        ) : (
          <SortableList
            idPrefix="section"
            count={sections.length}
            onReorder={(from, to) => applyEdit(moveSection(docRef.current, from, to))}
            ariaLabel={t('exercises.editor.sectionsListLabel')}
          >
            {sections.map((section, si) => (
              <SortableItem
                key={si}
                idPrefix="section"
                index={si}
                total={sections.length}
                itemLabel={t('exercises.editor.section.label', { number: si + 1 })}
                onMoveUp={() => applyEdit(moveSection(docRef.current, si, si - 1))}
                onMoveDown={() => applyEdit(moveSection(docRef.current, si, si + 1))}
              >
                <ExerciseSectionCard
                  section={section}
                  idPrefix={`section-${si}`}
                  index={si}
                  onChange={(next) => applyEdit(replaceSection(docRef.current, si, next))}
                  onDelete={() => onDeleteSection(si)}
                  onGenerateQuestions={() => openGenerateQuestions(si)}
                  onGenerateDistractors={(gi, qi) => openGenerateDistractors(si, gi, qi)}
                />
              </SortableItem>
            ))}
          </SortableList>
        )}

        <SectionTypePicker
          ref={pickerRef}
          onAdd={onAddSection}
          onGenerateAI={openGenerateSection}
        />

        <ExerciseSettingsPanel
          settings={doc.content.settings}
          onChange={(patch) => applyEdit(updateSettings(docRef.current, patch))}
        />
      </div>

      {aiGenerate ? (
        <AIGenerateDialog
          exerciseId={exerciseId}
          request={aiGenerate.request}
          onInsert={onInsertGenerated}
          onClose={() => setAiGenerate(null)}
        />
      ) : null}
    </div>
  )
}
