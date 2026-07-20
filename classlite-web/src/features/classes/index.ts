/**
 * Classes feature barrel (Story 3.1). Public surface for cross-feature imports
 * (TS-7 — consumers import from '@/features/classes', never deep paths).
 */
export { ClassesPage } from './ClassesPage'
export { ClassStatusPill } from './components/ClassStatusPill'
export { CLIENT_TRANSITIONS } from './lib/classTransitions'
export { ClassFormDialog } from './components/ClassFormDialog'
export { useClasses, type ClassWire, type ClassStatus } from './api/useClasses'
export { useCreateClass } from './api/useCreateClass'
export { useUpdateClass } from './api/useUpdateClass'
export { useTransitionClassStatus } from './api/useTransitionClassStatus'
export { classesKeys, type ClassListScope } from './api/classesKeys'
