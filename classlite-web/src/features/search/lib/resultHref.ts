/**
 * resultHref / seeAllHref — the FE route composition for search results (Story
 * 8-4b, D5). The backend returns entity keys only (NO href); the FE composes the
 * route. `role` enters ONLY here (a ROUTE choice for the role-split student
 * detail page), NEVER the result-list renderer — a scope filter is unexpressible
 * in the renderer's props (R-1 structural guard).
 *
 * Route map is AUDIENCE-AWARE (verified against routes.tsx gates — a route the
 * caller's role cannot reach is a `PermissionDenied`, not a deep-link). Code
 * review 2026-09-28 (Ducdo: "pragmatic audience-aware resolver"):
 *   class      → staff /classes/:id · student → null (NO student class route
 *                exists yet — the class category is non-navigable for a student;
 *                FU-8-4-STUDENT-ROUTES). `/classes/:id` is staff-gated.
 *   student    → teacher /students/:id · owner|admin /people/students/:id
 *   exercise   → /exercises/:id/edit  (no read-only route; staff-only category)
 *   assignment → student /assignments (their own list; the staff
 *                /classes/:classId/assignments is staff-gated) · staff
 *                /classes/:classId/assignments (NO /assignments/:id — classId is
 *                why 8-4a ships it; staff null-classId → /classes)
 *   file       → /knowledge-hub/files/:slug  (slug, not id; staff-only category)
 *
 * A `null` return means "no reachable destination for this role" — the caller
 * no-ops the selection (keeps the palette open) rather than navigating to a
 * would-be-denied route. `role` lives ONLY here (a ROUTE choice), never the
 * result-list renderer (R-1 structural guard).
 */
import type { Role } from '@/hooks/useRole'
import type { SearchResultItem } from '@/features/search/api/useSearch'

/** The 5 grouped result categories, in fixed server render order (D5/AC7). */
export type SearchCategoryKey =
  | 'classes'
  | 'students'
  | 'exercises'
  | 'assignments'
  | 'files'

/**
 * The fixed render order of the 5 categories (AC7). The renderer iterates THIS,
 * never `Object.keys(results)` — object key order is not a contract, and the
 * passthrough-order test (AC11) pins this sequence.
 */
export const CATEGORY_ORDER: readonly SearchCategoryKey[] = [
  'classes',
  'students',
  'exercises',
  'assignments',
  'files',
]

/**
 * The deep-link route for a single result, or `null` when the caller's role has
 * no reachable destination (student `class` — no student class route exists;
 * FU-8-4-STUDENT-ROUTES). `classId`/`slug` are contract-guaranteed non-null for
 * assignment/file respectively; a defensive fallback to a role-reachable list
 * keeps a would-be-null from producing a broken `/classes/null/...` href.
 */
export function resultHref(item: SearchResultItem, role: Role | null): string | null {
  switch (item.type) {
    case 'class':
      // /classes/:id is staff-gated; a student has no class-detail route yet.
      return role === 'student' ? null : `/classes/${item.id}`
    case 'student':
      return role === 'teacher'
        ? `/students/${item.id}`
        : `/people/students/${item.id}`
    case 'exercise':
      return `/exercises/${item.id}/edit`
    case 'assignment':
      // A student's assignment surface is their own /assignments list; the
      // per-class /classes/:classId/assignments tab is staff-gated.
      if (role === 'student') return '/assignments'
      return item.classId
        ? `/classes/${item.classId}/assignments`
        : '/classes'
    case 'file':
      return item.slug ? `/knowledge-hub/files/${item.slug}` : '/knowledge-hub'
  }
}

/**
 * The "See all" doorway target for a category — its existing list view (D12) —
 * or `null` when the caller's role has no reachable list (student `classes`; the
 * caller no-ops the doorway). AUDIENCE-AWARE for the same reason as `resultHref`:
 * `/classes`, `/exercises`, `/knowledge-hub` are staff-gated; `/assignments` is
 * student-gated; `/students` vs `/people/students` is teacher vs owner/admin.
 * Code review 2026-09-28 (Ducdo: "pragmatic audience-aware resolver").
 * The bare list is a browsable doorway; per-list `?q=` prefill is
 * FU-8-4-SEEALL-PREFILL (most list views lack a text-filter param today).
 */
export function seeAllHref(category: SearchCategoryKey, role: Role | null): string | null {
  switch (category) {
    case 'classes':
      // /classes list is staff-gated; a student has no classes surface yet.
      return role === 'student' ? null : '/classes'
    case 'students':
      return role === 'teacher' ? '/students' : '/people/students'
    case 'exercises':
      return '/exercises'
    case 'assignments':
      // Student → their own /assignments list; staff have no assignments-list
      // route → send them to /classes (a doorway to the resource, not a wall).
      return role === 'student' ? '/assignments' : '/classes'
    case 'files':
      return '/knowledge-hub'
  }
}
