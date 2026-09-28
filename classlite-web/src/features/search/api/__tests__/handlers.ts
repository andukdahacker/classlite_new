// Story 8-4b — MSW fixtures + handlers for the global-search palette over the
// DONE 8-4a `GET /api/search` contract. VALID TypeScript on its own; the
// fixtures are typed against the ALREADY-SHIPPED generated wire types
// (`components['schemas']['SearchResults' | 'SearchCategory' | 'SearchResultItem']`).
// Typing against the generated shapes is the D8 co-finalization guard: if the
// 8-4a contract drifts under the Task 8 codegen re-run, these fixtures stop
// compiling and surface the drift BEFORE the palette silently mis-renders.
//
// The RED signal for the *.test.tsx consumers is the missing modules
// (useSearch / SearchPalette / SearchResultsList / resultHref), NOT this file
// ([[reference_atdd_red_convention]]).
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

export type SearchResults = components['schemas']['SearchResults']
export type SearchCategory = components['schemas']['SearchCategory']
export type SearchResultItem = components['schemas']['SearchResultItem']
type EnvelopeMeta = components['schemas']['EnvelopeMeta']

const FIXED_SERVER_TIME = '2026-09-28T10:00:00.000Z'

// The 5 categories in the fixed server render order (D5/AC7).
export const CATEGORY_KEYS = [
  'classes',
  'students',
  'exercises',
  'assignments',
  'files',
] as const

// Deterministic ids so deep-link + passthrough assertions can name a row.
export const CLASS_ID = '00000000-0000-0000-0000-0000000000c1'
export const STUDENT_ID = '00000000-0000-0000-0000-0000000000d1'
export const EXERCISE_ID = '00000000-0000-0000-0000-0000000000e1'
export const ASSIGNMENT_ID = '00000000-0000-0000-0000-0000000000a1'
export const ASSIGNMENT_CLASS_ID = '00000000-0000-0000-0000-0000000000c9'
export const FILE_ID = '00000000-0000-0000-0000-0000000000f1'
export const FILE_SLUG = 'ielts-writing-task-2-guide'

function envelope<T>(data: T): { data: T; meta: EnvelopeMeta } {
  return { data, meta: { serverTime: FIXED_SERVER_TIME } }
}

/** An empty category — the shape every category takes when it has no matches. */
export const emptyCategory: SearchCategory = { items: [], hasMore: false }

export function searchResultItem(
  overrides: Partial<SearchResultItem> = {},
): SearchResultItem {
  return {
    id: CLASS_ID,
    type: 'class',
    title: 'IELTS Foundation A',
    subtitle: 'Writing · active',
    slug: null,
    classId: null,
    ...overrides,
  }
}

// One representative item per type, each with its type-specific route key set.
export const classItem = searchResultItem({ id: CLASS_ID, type: 'class', title: 'IELTS Foundation A' })
export const studentItem = searchResultItem({
  id: STUDENT_ID,
  type: 'student',
  title: 'Nguyễn An',
  subtitle: 'IELTS Foundation A',
})
export const exerciseItem = searchResultItem({
  id: EXERCISE_ID,
  type: 'exercise',
  title: 'Task 2 — Opinion Essay',
  subtitle: 'Writing',
})
export const assignmentItem = searchResultItem({
  id: ASSIGNMENT_ID,
  type: 'assignment',
  title: 'Week 3 Writing',
  subtitle: 'Writing · IELTS Foundation A',
  classId: ASSIGNMENT_CLASS_ID,
})
export const fileItem = searchResultItem({
  id: FILE_ID,
  type: 'file',
  title: 'Writing Task 2 Guide.pdf',
  subtitle: 'Knowledge Hub · application/pdf',
  slug: FILE_SLUG,
})

/** All five categories empty — the AC12 "no matches" state. */
export const emptyResults: SearchResults = {
  classes: emptyCategory,
  students: emptyCategory,
  exercises: emptyCategory,
  assignments: emptyCategory,
  files: emptyCategory,
}

/** A populated payload spanning all 5 types (one item each). */
export const populatedResults: SearchResults = {
  classes: { items: [classItem], hasMore: false },
  students: { items: [studentItem], hasMore: false },
  exercises: { items: [exerciseItem], hasMore: false },
  assignments: { items: [assignmentItem], hasMore: false },
  files: { items: [fileItem], hasMore: false },
}

/** Classes overflow (hasMore true) → the D12 "See all" doorway renders. */
export const hasMoreResults: SearchResults = {
  ...emptyResults,
  classes: {
    items: [
      classItem,
      searchResultItem({ id: '00000000-0000-0000-0000-0000000000c2', title: 'IELTS Foundation B' }),
    ],
    hasMore: true,
  },
}

/** A subtitle:null item — must render with NO subtitle line (never "null"). */
export const nullSubtitleResults: SearchResults = {
  ...emptyResults,
  exercises: {
    items: [searchResultItem({ id: EXERCISE_ID, type: 'exercise', title: 'Untitled drill', subtitle: null })],
    hasMore: false,
  },
}

export function searchHandlers(data: SearchResults) {
  return [http.get('/api/search', () => HttpResponse.json(envelope(data)))]
}

export const emptyResultsHandlers = searchHandlers(emptyResults)
export const populatedResultsHandlers = searchHandlers(populatedResults)
export const hasMoreResultsHandlers = searchHandlers(hasMoreResults)

/** 500 → the human error + Retry state (AC13). */
export const search500Handlers = [
  http.get('/api/search', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-search-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** 403 — a scope the server refuses; the palette shows the error state. */
export const search403Handlers = [
  http.get('/api/search', () =>
    HttpResponse.json(
      { error: { code: 'INSUFFICIENT_ROLE', message: 'forbidden', requestId: 'req-search-403', details: null } },
      { status: 403 },
    ),
  ),
]

/** 401 — surfaces to the global refresh coordinator (never a component redirect). */
export const search401Handlers = [
  http.get('/api/search', () =>
    HttpResponse.json(
      { error: { code: 'AUTH_REQUIRED', message: 'unauthorized', requestId: 'req-search-401', details: null } },
      { status: 401 },
    ),
  ),
]
