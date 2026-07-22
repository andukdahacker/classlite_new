// Story 3.4 Task 12 — SchedulePage / ScheduleWorkspace behaviour + trilogy.
// MSW at the HTTP boundary (never mock useQuery); retry:false; one QueryClient
// per test; role seeded on the module-singleton queryClient.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { SchedulePage } from '@/features/schedule/SchedulePage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'
const CLASS_ID = '11111111-1111-1111-1111-111111111111'
const STUB_USER: UserSummary = {
  id: 'user-under-test',
  email: 'user@example.com',
  fullName: 'Test User',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Center', shortCode: 'c', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role,
  })
}

function todayAt(hour: number): string {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function sessionFixture() {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    centerId: CENTER_ID,
    classId: CLASS_ID,
    className: 'IELTS Speaking',
    classColor: 'var(--cl-accent)',
    topic: 'Part 2 cue cards',
    startsAt: todayAt(9),
    endsAt: todayAt(11),
    status: 'scheduled',
    cancelledAt: null,
    recurrenceGroupId: null,
    recurrencePattern: null,
    recurrenceTz: 'Asia/Ho_Chi_Minh',
    createdAt: todayAt(1),
    updatedAt: todayAt(1),
  }
}

function renderSchedule(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/schedule']}>
          <SchedulePage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.use(
    http.get('*/api/classes', () =>
      HttpResponse.json({ data: [{ id: CLASS_ID, centerId: CENTER_ID, name: 'IELTS Speaking', status: 'active' }], meta: { serverTime: todayAt(0) } }),
    ),
  )
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('SchedulePage — workspace + trilogy (Story 3.4)', () => {
  test('renders sessions on success (SR list carries the class name)', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [sessionFixture()], meta: { serverTime: todayAt(0) } })))
    renderSchedule('teacher')
    await screen.findByTestId('schedule-workspace')
    const srList = await screen.findByTestId('schedule-sr-list')
    expect(within(srList).getByText(/IELTS Speaking/)).toBeInTheDocument()
    expect(screen.queryByTestId('schedule-empty-overlay')).not.toBeInTheDocument()
  })

  test('empty week shows the in-canvas overlay (not a blanked pane)', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [], meta: { serverTime: todayAt(0) } })))
    renderSchedule('teacher')
    await screen.findByTestId('schedule-workspace')
    expect(await screen.findByTestId('schedule-empty-overlay')).toBeInTheDocument()
    // The real grid still renders behind the overlay.
    expect(screen.getByTestId('schedule-grid')).toBeInTheDocument()
  })

  test('network failure shows a distinct error state with one retry', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.error()))
    renderSchedule('teacher')
    expect(await screen.findByTestId('schedule-error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('schedule.error.retry') })).toBeInTheDocument()
    // Error must look different from empty.
    expect(screen.queryByTestId('schedule-empty-overlay')).not.toBeInTheDocument()
  })

  test('keyboard-first "New session" opens the modal', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [], meta: { serverTime: todayAt(0) } })))
    renderSchedule('owner')
    await screen.findByTestId('schedule-workspace')
    await userEvent.click(screen.getByTestId('schedule-new-session'))
    expect(await screen.findByTestId('session-modal')).toBeInTheDocument()
  })

  test('view toggle switches the grid to month', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [], meta: { serverTime: todayAt(0) } })))
    renderSchedule('owner')
    await screen.findByTestId('schedule-workspace')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('schedule.view.month') }))
    await waitFor(() => expect(screen.getByTestId('schedule-grid')).toHaveAttribute('data-view', 'month'))
  })
})
