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
import { useTranslation } from 'react-i18next'

/**
 * Root-level error fallback for router-layer failures (lazy chunk-load
 * 404 after a stale deploy, loader throws, navigation errors). The React
 * `ErrorBoundary` in `App.tsx` only catches render-time errors INSIDE the
 * router tree; loader / lazy failures bubble up to React Router's
 * built-in error UI unless `errorElement` is set. Localized via the
 * existing `app.errorBoundary.*` keys so the user always sees a clean
 * recovery affordance — even on a chunk that no longer exists.
 */
// eslint-disable-next-line react-refresh/only-export-components -- co-export with `routes` is intentional; this file is the router entry, not a HMR-refreshable component module.
function RouterErrorFallback() {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.errorBoundary.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t('app.errorBoundary.body')}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-[var(--cl-radius-sm)] bg-[var(--cl-ink)] px-4 py-2 text-sm text-[var(--cl-surface)]"
        >
          {t('app.errorBoundary.retryCta')}
        </button>
        <a
          href="/dashboard"
          className="font-[var(--cl-font-body)] text-sm text-[var(--cl-accent)] underline"
        >
          {t('app.errorBoundary.homeLinkCta')}
        </a>
      </div>
    </div>
  )
}

const baseRoutes: RouteObject[] = [
  {
    index: true,
    loader: () => redirect('/login'),
  },
  // Auth boundary — pre-auth UI under a single layout. Rolldown emits
  // AuthLayout + LoginPage + RegisterPage as a tightly-coupled chunk
  // group that pre-auth visits load and authenticated visits never see.
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
          const { default: LoginPage } = await import(
            '@/features/auth/LoginPage'
          )
          return { Component: LoginPage }
        },
      },
      {
        path: 'register',
        lazy: async () => {
          const { default: RegisterPage } = await import(
            '@/features/auth/RegisterPage'
          )
          return { Component: RegisterPage }
        },
      },
    ],
  },
  // Story 1-7c AC2 — AppLayout pathless route wrapping the authenticated
  // surfaces. Student / Teacher dashboard placeholders mount inside the
  // sidebar + topbar shell with the skip-to-content link. Auth routes
  // stay under AuthLayout above; PermissionDenied / NotFound are
  // full-screen error states (no shell). When real auth lands in Story
  // 1-8, role-aware redirect from `/` will choose between
  // OwnerDashboard / TeacherDashboard / StudentDashboard inside this
  // same shell.
  {
    lazy: async () => {
      const { default: AppLayout } = await import(
        '@/components/shared/AppLayout'
      )
      return { Component: AppLayout }
    },
    children: [
      // Student boundary — only mounted for student users. Route-level
      // role gating (block teachers, etc.) lands with Story 2-6.
      {
        path: '/student',
        lazy: async () => {
          const { default: StudentDashboard } = await import(
            '@/features/dashboard/StudentDashboard'
          )
          return { Component: StudentDashboard }
        },
      },
      // Teacher boundary — default landing for authenticated owner /
      // teacher / admin sessions.
      {
        path: '/dashboard',
        lazy: async () => {
          const { default: TeacherDashboard } = await import(
            '@/features/dashboard/TeacherDashboard'
          )
          return { Component: TeacherDashboard }
        },
      },
    ],
  },
  // Story 1-7c AC4 — UX-DR16 orientation screen. Story 2-6 wires
  // per-route `errorElement={<PermissionDenied requiredRoles={[...]} />}`
  // for role-gated routes; this standalone URL renders the
  // Owner+Admin variant for direct visits.
  {
    path: '/permission-denied',
    lazy: async () => {
      const { default: PermissionDenied } = await import(
        '@/components/shared/PermissionDenied'
      )
      return {
        Component: () => (
          <PermissionDenied requiredRoles={['owner', 'admin']} />
        ),
      }
    },
  },
  // Story 1-7c AC5 — `path: '*'` catch-all. React Router v7 matches by
  // SPECIFICITY (not declaration order), so the catch-all is naturally
  // the terminal match — every literal path (`/login`, `/dashboard`,
  // `/permission-denied`, dev routes) outranks it. We still place it
  // last as a readability convention so the route table reads top-to-bottom
  // as a fallback chain.
  {
    path: '*',
    lazy: async () => {
      const { default: NotFound } = await import(
        '@/components/shared/NotFound'
      )
      return { Component: NotFound }
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

// Single root pathless layout route owns `errorElement` so router-layer
// failures (lazy chunk-load 404, loader throws) ALWAYS surface a localized
// fallback instead of React Router's raw error UI. Render-time errors are
// caught by `<ErrorBoundary>` in `App.tsx`; this is the loader/lazy seam.
export const router = createBrowserRouter([
  {
    errorElement: <RouterErrorFallback />,
    children: [...baseRoutes, ...devRoutes],
  },
])
