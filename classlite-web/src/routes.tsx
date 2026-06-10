/**
 * Dashboard route table — React Router v7 library mode.
 *
 * Three explicit lazy bundle groups close the Vietnam-4G bundle hygiene
 * constraint (architecture line 253). Mobile/4G students must never pay
 * the cost of downloading teacher or admin code; pre-auth UI must never
 * pull in dashboard chunks. Without explicit route-level lazy
 * boundaries (and not just per-component React.lazy) Rolldown's chunk
 * planner will silently merge anything that shares an import, so the
 * Playwright spec at `e2e/route-bundle-boundaries.spec.ts` is the only
 * mechanism that prevents quiet regressions.
 *
 * DEV-only routes (`/__theme-resolution`, `/__multi-tab-test-bait`) are
 * registered behind `import.meta.env.DEV`. Rolldown statically folds the
 * ternary so the production bundle does not include the dev chunks — the
 * Task 11.7 grep gate guards the property.
 */
import {
  createBrowserRouter,
  redirect,
  type RouteObject,
} from 'react-router'

const baseRoutes: RouteObject[] = [
  {
    index: true,
    loader: () => redirect('/login'),
  },
  // Auth boundary — pre-auth UI under a single layout. Rolldown emits
  // AuthLayout + LoginPagePlaceholder as a tightly-coupled chunk pair
  // that pre-auth visits load and authenticated visits never see.
  {
    lazy: async () => {
      const { default: AuthLayout } = await import(
        '@/features/auth/AuthLayout'
      )
      return { Component: AuthLayout }
    },
    children: [
      {
        path: 'login',
        lazy: async () => {
          const { default: LoginPagePlaceholder } = await import(
            '@/features/auth/LoginPagePlaceholder'
          )
          return { Component: LoginPagePlaceholder }
        },
      },
    ],
  },
  // Student boundary — only mounted for student users. Route-level role
  // gating (block teachers, etc.) lands with Story 2-6.
  {
    path: '/student',
    lazy: async () => {
      const { default: StudentDashboard } = await import(
        '@/features/dashboard/StudentDashboard'
      )
      return { Component: StudentDashboard }
    },
  },
  // Teacher boundary — default landing for authenticated owner / teacher
  // / admin sessions. Real role-aware redirect from `/` lands with
  // Story 1-8 / Epic 2.
  {
    path: '/dashboard',
    lazy: async () => {
      const { default: TeacherDashboard } = await import(
        '@/features/dashboard/TeacherDashboard'
      )
      return { Component: TeacherDashboard }
    },
  },
]

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/__theme-resolution',
        lazy: async () => {
          const { ThemeResolutionPage } = await import(
            '@/features/theme-resolution/ThemeResolutionPage'
          )
          return { Component: ThemeResolutionPage }
        },
      },
      {
        path: '/__multi-tab-test-bait',
        lazy: async () => {
          const { default: MultiTabTestPage } = await import(
            '@/features/multi-tab-test/MultiTabTestPage'
          )
          return { Component: MultiTabTestPage }
        },
      },
    ]
  : []

export const router = createBrowserRouter([...baseRoutes, ...devRoutes])
