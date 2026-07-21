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
  Navigate,
  redirect,
  useParams,
  type LoaderFunctionArgs,
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

// Unknown tab segment under /classes/:id (typo, stale bookmark, a tab removed
// in a later epic) → redirect to the canonical overview instead of falling
// through to the global `*` NotFound. Routes the request back through the
// class-scoped guard (ClassDetailLayout → useClass → localized NotFoundCard for
// a foreign/absent class), matching the bare-/classes/:id index redirect.
// Absolute target built from the route param so it stays basename-safe (CR-review P1).
// eslint-disable-next-line react-refresh/only-export-components -- co-export with `routes`; router entry, not an HMR-refreshable module.
function ClassTabFallbackRedirect() {
  const { id } = useParams()
  return <Navigate to={`/classes/${id}/overview`} replace />
}

// Exported so the routes-seam unit test imports the exact loader the router
// runs — guards against drift between the production loader and any harness
// copy (Murat BLOCKER). The function MUST stay pure (no React imports / no
// closure over render-only state) so the test can call it without booting
// the router lazy chunks.
export function indexLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  // Story 1-9c — forward `location.search` AND `location.hash` so Story
  // 1-6's OAuth-success redirect to `APP_POST_LOGIN_URL?invited=true`
  // (= `/?invited=true` per `config.go:68`) survives the bounce to
  // `/login?invited=true` and triggers LoginPage's `bannerKey === 'invited'`
  // branch. Hash is forwarded for the same anti-silent-flatten reason —
  // a future surface that anchors into a section after redirect would
  // otherwise lose its fragment.
  return redirect('/login' + url.search + url.hash)
}

const baseRoutes: RouteObject[] = [
  {
    index: true,
    loader: indexLoader,
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
      {
        path: 'verify-email',
        lazy: async () => {
          const { default: VerifyEmailPage } = await import(
            '@/features/auth/VerifyEmailPage'
          )
          return { Component: VerifyEmailPage }
        },
      },
      // Story 1-9b — password reset entry point. Lazy chunk so the auth
      // boundary stays minimal for users who only sign in.
      {
        path: 'forgot-password',
        lazy: async () => {
          const { default: ForgotPasswordPage } = await import(
            '@/features/auth/ForgotPasswordPage'
          )
          return { Component: ForgotPasswordPage }
        },
      },
      // Story 1-9b — landing for the reset-password email link
      // (`{base}?token={raw}` query-param form per auth_reset.go:102).
      {
        path: 'reset-password',
        lazy: async () => {
          const { default: ResetPasswordPage } = await import(
            '@/features/auth/ResetPasswordPage'
          )
          return { Component: ResetPasswordPage }
        },
      },
      // Story 1-9c — invite acceptance entry point. Path-param routing
      // (`/invite/:token`) per Epic 1C AC line 330 + AUTH-05 wireframe.
      {
        path: 'invite/:token',
        lazy: async () => {
          const { default: InviteAcceptancePage } = await import(
            '@/features/auth/InviteAcceptancePage'
          )
          return { Component: InviteAcceptancePage }
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
      // Story 2-5a + 2.6 (AC6) — Owner-only Settings surface. The
      // `RouteRoleGate` `element:` wrapper below replaces the inline
      // `useRole()` + `if (role !== 'owner')` block that shipped in 2-5a
      // at SettingsPage.tsx:23-25,50,132-138 (deleted in Task 7.3). Uses
      // an `element:` wrapper NOT `errorElement:` — errorElement fires
      // on thrown loader/render errors, not policy deny.
      {
        path: '/settings',
        lazy: async () => {
          const { default: RouteRoleGate } = await import(
            '@/components/shared/RouteRoleGate'
          )
          return {
            element: (
              <RouteRoleGate
                allowedRoles={['owner']}
                requiredRolesForCopy={['owner']}
                sectionNameKey="settings"
              />
            ),
          }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const { default: SettingsPage } = await import(
                '@/features/settings/SettingsPage'
              )
              return { Component: SettingsPage }
            },
          },
        ],
      },
      // Story 3.1 — /classes index. Its own lazy chunk under the AppLayout
      // group, gated to staff (owner/admin/teacher). The create/edit form is a
      // Dialog (not a /classes/new child route), so this single boundary
      // covers the feature. Deny copy uses the owner/admin tuple.
      {
        path: '/classes',
        lazy: async () => {
          const { default: RouteRoleGate } = await import(
            '@/components/shared/RouteRoleGate'
          )
          return {
            element: (
              <RouteRoleGate
                allowedRoles={['owner', 'admin', 'teacher']}
                requiredRolesForCopy={['owner', 'admin']}
                sectionNameKey="classes"
              />
            ),
          }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              // Deep import (NOT the barrel) so Rolldown emits a dedicated
              // `ClassesPage-*.js` chunk instead of folding the feature into
              // the entry chunk (matches the SettingsPage precedent).
              const { ClassesPage } = await import(
                '@/features/classes/ClassesPage'
              )
              return { Component: ClassesPage }
            },
          },
        ],
      },
      // Story 3.3 — /classes/templates management group (screens s19/s20/s21). A
      // DISTINCT SIBLING of the /classes/:id detail group: the static
      // `templates` segment outranks the `:id` param (RR v7 specificity), so
      // `/classes/templates` resolves HERE, never to the :id 404 (the
      // route-ordering negative in route-bundle-boundaries.spec.ts). Gated
      // owner+admin (writes surface) — tighter than the staff-wide index. Each
      // child deep-imported for its own Rolldown chunk.
      {
        path: '/classes/templates',
        lazy: async () => {
          const { default: RouteRoleGate } = await import(
            '@/components/shared/RouteRoleGate'
          )
          return {
            element: (
              <RouteRoleGate
                allowedRoles={['owner', 'admin']}
                requiredRolesForCopy={['owner', 'admin']}
                sectionNameKey="classes"
              />
            ),
          }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const { TemplatesIndexPage } = await import(
                '@/features/classes/TemplatesIndexPage'
              )
              return { Component: TemplatesIndexPage }
            },
          },
          {
            path: 'new',
            lazy: async () => {
              const { default: TemplateFormPage } = await import(
                '@/features/classes/TemplateFormPage'
              )
              return { Component: TemplateFormPage }
            },
          },
          {
            path: ':id',
            lazy: async () => {
              const { default: TemplateDetailPage } = await import(
                '@/features/classes/TemplateDetailPage'
              )
              return { Component: TemplateDetailPage }
            },
          },
          {
            path: ':id/edit',
            lazy: async () => {
              const { default: TemplateFormPage } = await import(
                '@/features/classes/TemplateFormPage'
              )
              return { Component: TemplateFormPage }
            },
          },
        ],
      },
      // Story 3.2 — /classes/:id tabbed detail shell (screen s08/s09). A
      // SIBLING of the /classes index group (peers, NOT nested under it) so the
      // s07 index chunk stays lean and the detail layout ships its own
      // `ClassDetailLayout-*.js` chunk. Same RouteRoleGate props as the index
      // (staff-only). The record/ownership authz is the GET 404 inside the
      // layout (AC6) — the gate is ROLE authz only (two-layer model).
      {
        path: '/classes/:id',
        lazy: async () => {
          const { default: RouteRoleGate } = await import(
            '@/components/shared/RouteRoleGate'
          )
          return {
            element: (
              <RouteRoleGate
                allowedRoles={['owner', 'admin', 'teacher']}
                requiredRolesForCopy={['owner', 'admin']}
                sectionNameKey="classes"
              />
            ),
          }
        },
        children: [
          {
            // Pathless layout route: ClassDetailLayout owns the detail-head +
            // tab strip + Loading/Not-found/Error trilogy and renders the
            // active tab through its own <Outlet />. Deep-imported (NOT the
            // barrel) so Rolldown emits the dedicated ClassDetailLayout chunk.
            lazy: async () => {
              const { default: ClassDetailLayout } = await import(
                '@/features/classes/ClassDetailLayout'
              )
              return { Component: ClassDetailLayout }
            },
            children: [
              // Bare /classes/:id → overview. Element redirect (NOT a loader
              // redirect) keeps FW-1 clean and never renders an empty body.
              {
                index: true,
                element: <Navigate to="overview" replace />,
              },
              {
                path: 'overview',
                lazy: async () => {
                  const { default: OverviewTab } = await import(
                    '@/features/classes/tabs/OverviewTab'
                  )
                  return { Component: OverviewTab }
                },
              },
              {
                path: 'students',
                lazy: async () => {
                  const { default: StudentsTab } = await import(
                    '@/features/classes/tabs/StudentsTab'
                  )
                  return { Component: StudentsTab }
                },
              },
              {
                path: 'assignments',
                lazy: async () => {
                  const { default: AssignmentsTab } = await import(
                    '@/features/classes/tabs/AssignmentsTab'
                  )
                  return { Component: AssignmentsTab }
                },
              },
              {
                path: 'sessions',
                lazy: async () => {
                  const { default: SessionsTab } = await import(
                    '@/features/classes/tabs/SessionsTab'
                  )
                  return { Component: SessionsTab }
                },
              },
              {
                path: 'materials',
                lazy: async () => {
                  const { default: MaterialsTab } = await import(
                    '@/features/classes/tabs/MaterialsTab'
                  )
                  return { Component: MaterialsTab }
                },
              },
              {
                path: 'analytics',
                lazy: async () => {
                  const { default: AnalyticsTab } = await import(
                    '@/features/classes/tabs/AnalyticsTab'
                  )
                  return { Component: AnalyticsTab }
                },
              },
              {
                // Unknown tab → overview (via the class-scoped guard). CR-review P1.
                path: '*',
                element: <ClassTabFallbackRedirect />,
              },
            ],
          },
        ],
      },
    ],
  },
  // Story 2-3a — onboarding wizard boundary. Full-bleed shell mounted OUTSIDE
  // `AppLayout` (no sidebar / topbar). Route-level lazy per Winston-W5 so
  // pre-auth visits never pull the wizard chunk. Extended
  // `e2e/route-bundle-boundaries.spec.ts` asserts `/welcome` chunk isolation
  // from `/login` and `/dashboard` bundle groups.
  {
    lazy: async () => {
      const { default: OnboardingLayout } = await import(
        '@/features/onboarding/OnboardingLayout'
      )
      return { Component: OnboardingLayout }
    },
    children: [
      {
        path: '/welcome',
        lazy: async () => {
          const { default: PersonaSelectPage } = await import(
            '@/features/onboarding/PersonaSelectPage'
          )
          return { Component: PersonaSelectPage }
        },
      },
      {
        path: '/setup/center',
        lazy: async () => {
          const { default: CenterSetupPage } = await import(
            '@/features/onboarding/CenterSetupPage'
          )
          return { Component: CenterSetupPage }
        },
      },
      // Story 2-3b Task 8.1 — 3 new lazy sibling routes. Each pulls its own
      // chunk per Winston-W5 chunk-isolation pattern; `route-bundle-boundaries.spec.ts`
      // extended with cross-chunk assertions.
      {
        path: '/setup/template',
        lazy: async () => {
          const { default: TemplateSelectPage } = await import(
            '@/features/onboarding/TemplateSelectPage'
          )
          return { Component: TemplateSelectPage }
        },
      },
      {
        path: '/setup/spawn',
        lazy: async () => {
          const { default: ClassSpawnPage } = await import(
            '@/features/onboarding/ClassSpawnPage'
          )
          return { Component: ClassSpawnPage }
        },
      },
      {
        path: '/setup/first-class',
        lazy: async () => {
          const { default: SoloFirstClassPage } = await import(
            '@/features/onboarding/SoloFirstClassPage'
          )
          return { Component: SoloFirstClassPage }
        },
      },
      // Story 2-3c Task 4.1 — terminal /setup/done celebration screen.
      // Own chunk per Winston-W5 chunk-isolation pattern; `route-bundle-
      // boundaries.spec.ts` extended with cross-chunk assertions
      // (deep-import discipline W-S4 keeps `useOnboardingProgress` on its
      // own path so the barrel doesn't drag the whole feature in).
      {
        path: '/setup/done',
        lazy: async () => {
          const { default: OnboardingDonePage } = await import(
            '@/features/onboarding/OnboardingDonePage'
          )
          return { Component: OnboardingDonePage }
        },
      },
    ],
  },
  // Story 1-7c AC4 — UX-DR16 orientation screen. Story 2.6 wires
  // per-route `<RouteRoleGate>` `element:` wrappers for role-gated
  // routes (AC6). This standalone URL renders the Owner+Admin variant
  // for direct visits (e.g. deep links from support tickets).
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
