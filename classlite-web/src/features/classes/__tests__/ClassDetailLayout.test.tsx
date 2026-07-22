// Story 3.2 — ClassDetailLayout shell (AC1/AC2/AC3/AC4/AC6).
//
// Frontend only, MSW at the HTTP boundary (never mock useQuery; retry:false;
// one QueryClient per test; createMemoryRouter initialEntries for nested-route
// + deep-link). The RouteRoleGate (role authz) is deliberately NOT in this
// harness — it is exercised in the routes/role tests. Here we test the layout's
// record/ownership authz (the GET 404) + the trilogy + tab behavior.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import {
  Navigate,
  RouterProvider,
  createMemoryRouter,
} from 'react-router'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import ClassDetailLayout from '@/features/classes/ClassDetailLayout'
import OverviewTab from '@/features/classes/tabs/OverviewTab'
import StudentsTab from '@/features/classes/tabs/StudentsTab'
import AssignmentsTab from '@/features/classes/tabs/AssignmentsTab'
import SessionsTab from '@/features/classes/tabs/SessionsTab'
import MaterialsTab from '@/features/classes/tabs/MaterialsTab'
import AnalyticsTab from '@/features/classes/tabs/AnalyticsTab'
import {
  CLASS_DETAIL_ID,
  classDetailFull,
  classDetailHandlers,
  classDetail404Handlers,
  classDetail500Handlers,
  type ClassWire,
} from '@/features/classes/api/__tests__/handlers'

function buildRouter(initialEntries: string[]) {
  return createMemoryRouter(
    [
      { path: '/classes', element: <div data-testid="classes-index-stub" /> },
      {
        path: '/classes/:id',
        Component: ClassDetailLayout,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: 'overview', Component: OverviewTab },
          { path: 'students', Component: StudentsTab },
          { path: 'assignments', Component: AssignmentsTab },
          { path: 'sessions', Component: SessionsTab },
          { path: 'materials', Component: MaterialsTab },
          { path: 'analytics', Component: AnalyticsTab },
        ],
      },
    ],
    { initialEntries },
  )
}

function renderDetail(initialEntries: string[]) {
  const client = createTestQueryClient()
  const router = buildRouter(initialEntries)
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Endpoint-scoped request counter for GET /api/classes/:id (Murat). */
function countingDetailHandler(cls: ClassWire = classDetailFull) {
  const state = { count: 0 }
  const handler = http.get('/api/classes/:id', () => {
    state.count += 1
    return HttpResponse.json({ data: cls, meta: { serverTime: 'x' } })
  })
  return { handler, state }
}

beforeEach(() => {
  i18n.changeLanguage('en')
})

afterEach(() => {
  server.resetHandlers()
})

describe('ClassDetailLayout — trilogy (AC6, TEST-FE-2)', () => {
  test('renders skeleton while loading', () => {
    server.use(...classDetailHandlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])
    expect(screen.getByTestId('class-detail-skeleton')).toBeInTheDocument()
  })

  test('renders not-found card on 404 CLASS_NOT_FOUND', async () => {
    server.use(...classDetail404Handlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])
    expect(
      await screen.findByTestId('class-detail-not-found'),
    ).toBeInTheDocument()
  })

  test('renders role="alert" on non-404 network/server error', async () => {
    server.use(...classDetail500Handlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // Not-found surface must NOT render for a non-404 error.
    expect(
      screen.queryByTestId('class-detail-not-found'),
    ).not.toBeInTheDocument()
  })
})

describe('ClassDetailLayout — non-leak invariant (AC6, TEST-FE-6)', () => {
  test('teacher-invisible 404 renders not-found AND never paints name/metadata', async () => {
    server.use(...classDetail404Handlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])

    await screen.findByTestId('class-detail-not-found')

    // The class name + metadata are ABSENT from the DOM (not merely hidden) —
    // identical surface for absent + teacher-invisible, no optimistic paint.
    expect(screen.queryByText(classDetailFull.name)).not.toBeInTheDocument()
    expect(
      screen.queryByText(classDetailFull.pendingTeacherEmail as string),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('class-detail-head')).not.toBeInTheDocument()
    expect(screen.queryByTestId('class-detail-tab-strip')).not.toBeInTheDocument()
  })

  test('deep-link straight into a nested tab of a 404 class hits the SAME guard (no metadata leak)', async () => {
    server.use(...classDetail404Handlers())
    // Deep-link directly to the Sessions tab of a foreign/absent class.
    renderDetail([`/classes/${CLASS_DETAIL_ID}/sessions`])

    // The layout's not-found guard renders — NOT the Sessions panel.
    await screen.findByTestId('class-detail-not-found')
    expect(
      screen.queryByTestId('class-tab-sessions-coming-soon'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(classDetailFull.name)).not.toBeInTheDocument()
    expect(screen.queryByTestId('class-detail-head')).not.toBeInTheDocument()
  })
})

describe('ClassDetailLayout — routing (AC1)', () => {
  test('bare /classes/:id redirects to overview and marks Overview active', async () => {
    server.use(...classDetailHandlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}`])

    // Overview tab content resolves (the redirect landed).
    expect(await screen.findByTestId('class-tab-overview')).toBeInTheDocument()
    const overviewTab = screen.getByTestId('class-detail-tab-overview')
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
    // A non-active tab is not selected.
    expect(screen.getByTestId('class-detail-tab-sessions')).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  test('six tabs render in order; dormant tabs are not disabled and expose "coming soon" in their accessible name (AC1/AC8)', async () => {
    server.use(...classDetailHandlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])
    await screen.findByTestId('class-tab-overview')

    const strip = screen.getByTestId('class-detail-tab-strip')
    const tabs = within(strip).getAllByRole('tab')
    expect(tabs.map((el) => el.getAttribute('data-testid'))).toEqual([
      'class-detail-tab-overview',
      'class-detail-tab-students',
      'class-detail-tab-assignments',
      'class-detail-tab-sessions',
      'class-detail-tab-materials',
      'class-detail-tab-analytics',
    ])
    // Dormant tabs stay in tab order (never `disabled`)... (Sessions is now LIT
    // per Story 3.4 AC10 — Students remains the dormant exemplar.)
    const studentsTab = screen.getByTestId('class-detail-tab-students')
    expect(studentsTab).not.toHaveAttribute('disabled')
    expect(studentsTab).not.toHaveAttribute('aria-disabled', 'true')
    // ...and carry "coming soon" in their accessible name (AC8).
    expect(studentsTab).toHaveAccessibleName(
      i18n.t('classes.detail.tabs.studentsComingSoon'),
    )
  })
})

describe('OverviewTab — real metadata (AC2)', () => {
  test('renders all shipped fields with i18n-formatted dates and no cut widgets', async () => {
    server.use(...classDetailHandlers())
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])

    // Name (in the head) + status pill.
    expect(await screen.findByText(classDetailFull.name)).toBeInTheDocument()
    expect(screen.getByTestId('class-tab-overview')).toBeInTheDocument()

    // Real fields render.
    expect(
      screen.getByText(classDetailFull.pendingTeacherEmail as string, {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(classDetailFull.description as string),
    ).toBeInTheDocument()
    // Target band formatted 7 -> "7.0".
    expect(screen.getByText('7.0')).toBeInTheDocument()

    // Dates are i18n-formatted (rendered string != raw ISO). The raw ISO wire
    // string must NOT appear (TS-6).
    expect(screen.queryByText(/2026-09-01/)).not.toBeInTheDocument()
    const overview = screen.getByTestId('class-tab-overview')
    expect(overview.textContent).toMatch(/Sep 1, 2026/)

    // The cut Overview widgets are ABSENT (AC2 — omitted this story).
    expect(
      screen.queryByTestId('class-overview-next-session'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('class-overview-quick-analytics'),
    ).not.toBeInTheDocument()
  })
})

describe('Dormant tabs (AC3)', () => {
  // Sessions is LIT per Story 3.4 AC10 — dropped from the dormant table.
  const DORMANT = [
    { path: 'students', testid: 'class-tab-students-coming-soon' },
    { path: 'assignments', testid: 'class-tab-assignments-coming-soon' },
    { path: 'materials', testid: 'class-tab-materials-coming-soon' },
    { path: 'analytics', testid: 'class-tab-analytics-coming-soon' },
  ] as const

  test.each(DORMANT)(
    'deep-linking /$path renders only its ComingSoonPanel with no epic/date words on screen',
    async ({ path, testid }) => {
      server.use(...classDetailHandlers())
      renderDetail([`/classes/${CLASS_DETAIL_ID}/${path}`])

      const panel = await screen.findByTestId(testid)
      expect(panel).toBeInTheDocument()
      // No roadmap/epic/date language anywhere on the rendered shell.
      expect(document.body.textContent).not.toMatch(/epic/i)
      expect(panel.textContent).not.toMatch(/\b20\d\d\b/)
      // No data-shaped stub inside the dormant panel (no table/grid/rows).
      expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
    },
  )
})

describe('Tab nav + independent caching (AC4)', () => {
  test('switching tabs never refetches Overview: request counter <= 1 and no skeleton reflash', async () => {
    const { handler, state } = countingDetailHandler()
    server.use(handler)
    const user = userEvent.setup()
    renderDetail([`/classes/${CLASS_DETAIL_ID}/overview`])

    // Overview settles (single layout fetch).
    await screen.findByTestId('class-tab-overview')
    await waitFor(() => expect(state.count).toBe(1))

    // Overview -> Students (dormant; Sessions is now LIT per 3.4) -> Overview.
    await user.click(screen.getByTestId('class-detail-tab-students'))
    expect(
      await screen.findByTestId('class-tab-students-coming-soon'),
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('class-detail-tab-overview'))
    expect(await screen.findByTestId('class-tab-overview')).toBeInTheDocument()

    // Observable: no loading skeleton reappeared (cache used, no reflash)...
    expect(
      screen.queryByTestId('class-detail-skeleton'),
    ).not.toBeInTheDocument()
    // ...AND the endpoint was hit at most once across the whole dance.
    await waitFor(() => expect(state.count).toBeLessThanOrEqual(1))
  })

  test('a dormant tab issues no data fetch of its own (layout metadata read is the only call)', async () => {
    const { handler, state } = countingDetailHandler()
    server.use(handler)
    renderDetail([`/classes/${CLASS_DETAIL_ID}/students`])

    await screen.findByTestId('class-tab-students-coming-soon')
    await waitFor(() => expect(state.count).toBe(1))
    // Give any stray tab-owned request a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 20))
    expect(state.count).toBe(1)
    vi.clearAllTimers()
  })
})
