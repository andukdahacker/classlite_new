/**
 * Exercises feature barrel (Story 4.1). Public surface for cross-feature
 * imports (TS-7 — consumers import from '@/features/exercises', never deep
 * paths). NOTE: these hooks are the LIBRARY exercise hooks — distinct from the
 * session-detail in-session exercise hooks of the same base name (T8 naming
 * boundary). Never import the session-detail hooks alongside these.
 */
export { ExerciseLibraryPage } from './ExerciseLibraryPage'
export { ExerciseFormDialog } from './components/ExerciseFormDialog'
export { ExerciseDeleteDialog } from './components/ExerciseDeleteDialog'
export {
  useExercises,
  type ExerciseListItem,
  type ExerciseSkill,
  type ExerciseListResult,
} from './api/useExercises'
export { useExercise, type Exercise } from './api/useExercise'
export { useCreateExercise } from './api/useCreateExercise'
export { useUpdateExercise } from './api/useUpdateExercise'
export { useDeleteExercise } from './api/useDeleteExercise'
export { useDuplicateExercise } from './api/useDuplicateExercise'
export {
  exerciseKeys,
  type ExerciseListScope,
  type ExerciseListParams,
} from './api/exercisesKeys'
