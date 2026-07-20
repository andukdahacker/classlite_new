// Story 3.2 (TEST-FE-5) — axe audit of the resolved detail shell (Overview
// active) + tab-strip role semantics. Dormant tabs are not `disabled` and
// expose their "coming soon" state in the accessible name.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import {
  Navigate,
  RouterProvider,
  createMemoryRouter,
} from 'react-router'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
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
  classDetailHandlers,
} from '@/features/classes/api/__tests__/handlers'

function renderShell() {
  const client = createTestQueryClient()
  const router = createMemoryRouter(
    [
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
      { path: '/classes', element: <div /> },
    ],
    { initialEntries: [`/classes/${CLASS_DETAIL_ID}/overview`] },
  )
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  i18n.changeLanguage('en')
})
afterEach(() => {
  server.resetHandlers()
})

test('resolved detail shell (Overview active) has no axe violations', async () => {
  server.use(...classDetailHandlers())
  const { container } = renderShell()
  await screen.findByTestId('class-tab-overview')
  expect(await axe(container)).toHaveNoViolations()
})

test('tab strip exposes tablist/tab semantics; dormant tabs are reachable, not disabled', async () => {
  server.use(...classDetailHandlers())
  renderShell()
  await screen.findByTestId('class-tab-overview')

  const strip = screen.getByRole('tablist', {
    name: i18n.t('classes.detail.head.tablistAria'),
  })
  const tabs = within(strip).getAllByRole('tab')
  expect(tabs).toHaveLength(6)
  for (const tab of tabs) {
    expect(tab).not.toBeDisabled()
  }
})
