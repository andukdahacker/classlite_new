/**
 * ClassDetailLayout — Story 3.2 (AC1/AC4/AC5/AC6/AC7). The tabbed detail shell
 * (screen s08/s09) and the deep-import target Rolldown emits as its own
 * `ClassDetailLayout-*.js` chunk (routes.tsx), keeping the s07 index chunk lean.
 *
 * Owns everything SHARED across tabs: the single `useClass(id)` metadata read,
 * the detail-head chrome, and the tab strip. Each child tab route owns its own
 * data boundary — Overview reuses this exact `classesKeys.detail(id)` cache
 * (no second fetch); the five dormant tabs own no query.
 *
 * The Loading / Not-found / Error trilogy (UX-1) wraps the WHOLE nested tree —
 * it resolves BEFORE `<Outlet />` mounts any tab, so a deep-link straight into a
 * nested tab (`/classes/{foreignId}/sessions`) hits the SAME guard (AC6).
 *
 * NON-LEAK INVARIANT (AC6): the shipped GET /api/classes/{id} returns 404 both
 * for an absent class AND for a teacher targeting a class not assigned to them
 * (3.1 AC6). The shell renders the IDENTICAL not-found surface for both and
 * MUST NOT paint the class name / metadata anywhere before the 404 resolves —
 * there is no optimistic render from router state.
 *
 * Tab-bar badge contract (AC4, convention for later epics): a future tab may
 * surface a count/badge into the strip via an optional `badge` field on a
 * `TABS` entry — Epic 7's Students-count drops into the same slot without
 * reshaping this layout.
 *
 * Trilogy markup is ISOLATED here (Amelia GAP-E) — no extraction from the s07
 * `ClassesPage` ErrorAlert/Skeleton (avoids disturbing 3.1's green suite). The
 * shared-trilogy extraction is tracked as tech-debt (FU-3-2-x). The shadcn
 * `Skeleton` primitive IS reused (already shared).
 */
import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api-fetch'
import { useClass } from './api/useClass'
import { ClassStatusPill } from './components/ClassStatusPill'
import { formatClassDateRange } from './lib/formatClassDate'
import type { ClassWire } from './api/useClasses'

const NOT_FOUND_STATUS = 404
const TAB_PANEL_ID = 'class-detail-tabpanel'

interface TabDef {
  /** URL segment (relative to `/classes/:id`) + the active-derivation key. */
  key: string
  labelKey: string
  /** Accessible-name key for a dormant tab ("<Tab>, coming soon") — AC8. */
  comingSoonKey?: string
}

// Exactly six tabs, in order (AC1). Overview is live; the rest are dormant this
// story but stay in tab order and lead to a real panel (never `disabled`).
const TABS: readonly TabDef[] = [
  { key: 'overview', labelKey: 'classes.detail.tabs.overview' },
  {
    key: 'students',
    labelKey: 'classes.detail.tabs.students',
    comingSoonKey: 'classes.detail.tabs.studentsComingSoon',
  },
  {
    key: 'assignments',
    labelKey: 'classes.detail.tabs.assignments',
    comingSoonKey: 'classes.detail.tabs.assignmentsComingSoon',
  },
  {
    key: 'sessions',
    labelKey: 'classes.detail.tabs.sessions',
    comingSoonKey: 'classes.detail.tabs.sessionsComingSoon',
  },
  {
    key: 'materials',
    labelKey: 'classes.detail.tabs.materials',
    comingSoonKey: 'classes.detail.tabs.materialsComingSoon',
  },
  {
    key: 'analytics',
    labelKey: 'classes.detail.tabs.analytics',
    comingSoonKey: 'classes.detail.tabs.analyticsComingSoon',
  },
] as const

// Active tab derived from the URL (FW-4) — never component state / useEffect.
// pathname is `/classes/{id}/{tab}`; segment index 2 is the tab.
function deriveActiveTab(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  return segments[2] ?? 'overview'
}

export default function ClassDetailLayout(): ReactElement {
  const { t } = useTranslation()
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const query = useClass(id)
  const activeTab = deriveActiveTab(location.pathname)

  // Roving-tabindex refs (one per tab, in TABS order) so the arrow-key handler
  // can move DOM focus to the newly-activated tab (WAI-ARIA tabs pattern, AC1).
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([])

  // Auto-activation model: ArrowLeft/Right + Home/End move focus AND navigate
  // (these tabs ARE routes). Keeps the tablist a single tab-stop; the panel is
  // separately focusable via its own `tabIndex={0}` (CR-review P5).
  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const currentIndex = TABS.findIndex((tab) => tab.key === activeTab)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % TABS.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = TABS.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    navigate(TABS[nextIndex].key)
    tabRefs.current[nextIndex]?.focus()
  }

  if (query.isPending) {
    return <DetailSkeleton />
  }

  if (query.isError) {
    const err = query.error
    if (err instanceof ApiError && err.status === NOT_FOUND_STATUS) {
      // AC6 non-leak: identical surface for absent + teacher-invisible; the
      // name/metadata are NEVER painted here.
      return <NotFoundCard />
    }
    return <ErrorState onRetry={() => query.refetch()} />
  }

  const cls = query.data

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="class-detail-layout">
      <DetailHead cls={cls} />

      <nav
        role="tablist"
        aria-label={t('classes.detail.head.tablistAria')}
        aria-orientation="horizontal"
        onKeyDown={handleTabsKeyDown}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200"
        data-testid="class-detail-tab-strip"
      >
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab.key
          return (
            // Plain `Link` (not `NavLink`) so it does NOT auto-inject
            // `aria-current="page"`, which would collide with the `aria-selected`
            // tab semantics we own here (CR-review P5).
            <Link
              key={tab.key}
              id={`class-tab-${tab.key}`}
              to={tab.key}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              role="tab"
              aria-selected={isActive}
              aria-controls={TAB_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              aria-label={tab.comingSoonKey ? t(tab.comingSoonKey) : undefined}
              data-testid={`class-detail-tab-${tab.key}`}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                isActive
                  ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t(tab.labelKey)}
            </Link>
          )
        })}
      </nav>

      <div
        id={TAB_PANEL_ID}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`class-tab-${activeTab}`}
      >
        <Outlet />
      </div>
    </div>
  )
}

function DetailHead({ cls }: { cls: ClassWire }): ReactElement {
  const { t } = useTranslation()
  const tileColor = cls.color ?? 'var(--cl-accent)'
  const initial = cls.name.trim().charAt(0).toUpperCase() || '?'
  const schedule = formatClassDateRange(cls.startDate, cls.endDate, i18n.language)

  const metaParts: string[] = []
  if (cls.primarySkill) metaParts.push(t(`classes.skill.${cls.primarySkill}`))
  metaParts.push(schedule ?? t('classes.detail.head.meta.noSchedule'))
  if (cls.targetBand != null) {
    metaParts.push(
      t('classes.detail.head.meta.targetBand', {
        band: cls.targetBand.toFixed(1),
      }),
    )
  }

  return (
    <header className="mb-6 flex items-start gap-4" data-testid="class-detail-head">
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white"
        style={{ backgroundColor: tileColor }}
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-fraunces text-2xl text-slate-900">{cls.name}</h1>
          {/* Read-only badge in the head — no `onTransition` (AC5). */}
          <ClassStatusPill status={cls.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{metaParts.join(' · ')}</p>
      </div>
    </header>
  )
}

function DetailSkeleton(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      data-testid="class-detail-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('classes.detail.loading.aria')}
    >
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="mb-6 h-9 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

function NotFoundCard(): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
        data-testid="class-detail-not-found"
      >
        <h1 className="font-fraunces text-xl text-slate-900">
          {t('classes.detail.notFound.headline')}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {t('classes.detail.notFound.body')}
        </p>
        <Link to="/classes" className={buttonVariants()}>
          {t('classes.detail.notFound.backCta')}
        </Link>
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
      >
        <span>{t('classes.error.body')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('classes.error.retry')}
        </Button>
      </div>
    </div>
  )
}
