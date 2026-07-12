/**
 * ClassRow — Story 2-3b AC4/AC5/AC7, Task 6.2.
 *
 * RHF-controlled repeating row inside `ClassSpawnPage`'s useFieldArray. Owns
 * the visual layout; RHF's `register` + `getFieldState` do the wiring. The
 * AssignChip lives inline in the teacher slot.
 *
 * Sally-S2 fold: `showDelete === false` HIDES the delete button entirely
 * (CSS-hidden + not-in-DOM) so screen readers do not announce a permanently-
 * disabled action. Instead the parent renders the row-minimum helper text.
 *
 * Sally-I7: aria-label for the delete + row heading interpolates a 1-based
 * `{{index}}` at the callsite (`index + 1`).
 */
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import type { Control, UseFormRegister } from 'react-hook-form'
import { useFormState } from 'react-hook-form'
import { AssignChip, type AssignChipValue } from '@/components/domain/AssignChip'
import type { ClassSpawnFormValues } from '../lib/classSpawnSchema'

export interface ClassRowProps {
  index: number
  showDelete: boolean
  register: UseFormRegister<ClassSpawnFormValues>
  control: Control<ClassSpawnFormValues>
  onRemove: () => void
  chipState: AssignChipValue | null
  chipStarIcon: boolean
  onOpenComposer: () => void
  onClearAssignment: () => void
  chipRef?: Ref<HTMLButtonElement | HTMLDivElement>
}

export function ClassRow({
  index,
  showDelete,
  register,
  control,
  onRemove,
  chipState,
  chipStarIcon,
  onOpenComposer,
  onClearAssignment,
  chipRef,
}: ClassRowProps) {
  const { t } = useTranslation()
  // R1-C2-P8 — scope the useFormState subscription to THIS row's classes[index]
  // slice. Unscoped `useFormState({ control })` re-renders every mounted row
  // when any row's field changes; with useFieldArray up to 20 rows that is
  // O(n²) render blast. The scoped `name` narrows the subscription so a
  // change to row N does not re-render rows M ≠ N.
  const { errors } = useFormState<ClassSpawnFormValues>({
    control,
    name: `classes.${index}`,
  })
  const row = errors.classes?.[index]
  const humanIndex = index + 1
  const cohortId = `class-row-${index}-cohortName`
  const startDateId = `class-row-${index}-startDate`

  return (
    <div
      data-testid={`class-row-${index}`}
      className="rounded-lg border border-slate-200 bg-white p-5"
      aria-label={t('onboarding.spawn.rowHeadingAria', { index: humanIndex })}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">
          {t('onboarding.spawn.rowIndex', { index: humanIndex })}
        </h2>
        {showDelete ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('onboarding.spawn.deleteClassAria', {
              index: humanIndex,
            })}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label htmlFor={cohortId} className="text-sm">
          <span className="mb-1 block text-slate-700">
            {t('onboarding.spawn.cohortName.label')}
          </span>
          <input
            id={cohortId}
            type="text"
            placeholder={t('onboarding.spawn.cohortName.placeholder')}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            {...register(`classes.${index}.cohortName`)}
          />
          {row?.cohortName?.message ? (
            <p className="mt-1 text-xs text-red-700">
              {row.cohortName.message}
            </p>
          ) : null}
        </label>
        <label htmlFor={startDateId} className="text-sm">
          <span className="mb-1 block text-slate-700">
            {t('onboarding.spawn.startDate.label')}
          </span>
          <input
            id={startDateId}
            type="date"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            {...register(`classes.${index}.startDate`)}
          />
          {row?.startDate?.message ? (
            <p className="mt-1 text-xs text-red-700">
              {row.startDate.message}
            </p>
          ) : null}
        </label>
      </div>
      <div className="mt-4">
        <span className="mb-1 block text-sm text-slate-700">
          {t('onboarding.spawn.teacher.label')}
        </span>
        <AssignChip
          ref={chipRef}
          state={
            chipState === null
              ? 'empty'
              : chipState.userId
                ? 'assigned'
                : 'invited'
          }
          value={chipState}
          starIcon={chipStarIcon}
          ariaLabel={
            chipStarIcon
              ? t('onboarding.spawn.teacher.founderAutoAssign')
              : undefined
          }
          onOpenComposer={onOpenComposer}
          onClear={onClearAssignment}
        />
        {chipStarIcon ? (
          <p className="mt-1 text-xs text-slate-500">
            {t('onboarding.spawn.teacher.founderAutoAssign')}
          </p>
        ) : null}
        {row?.teacherEmail?.message ? (
          <p className="mt-1 text-xs text-red-700">
            {row.teacherEmail.message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
