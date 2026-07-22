// Story 3.4 Task 12 (AC12) — axe-clean on /schedule, SessionModal, /my-schedule.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { type ReactElement } from 'react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { SchedulePage } from '@/features/schedule/SchedulePage'
import { MySchedulePage } from '@/features/schedule/MySchedulePage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'
const CLASS_ID = '11111111-1111-1111-1111-111111111111'
const USER: UserSummary = { id: 'u', email: 'u@e.com', fullName: 'U', emailVerified: true }

function seed(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: USER,
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'C', shortCode: 'c', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role,
  })
}

function renderPage(node: ReactElement, path: string) {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.use(
    http.get('*/api/classes', () =>
      HttpResponse.json({ data: [{ id: CLASS_ID, centerId: CENTER_ID, name: 'Class A', status: 'active' }], meta: { serverTime: '2026-08-15T00:00:00Z' } }),
    ),
    http.get('*/api/sessions', () => HttpResponse.json({ data: [], meta: { serverTime: '2026-08-15T00:00:00Z' } })),
  )
})
afterEach(() => queryClient.removeQueries({ queryKey: authKeys.session() }))

test('/schedule workspace (empty) has no axe violations', async () => {
  seed('owner')
  const { container } = renderPage(<SchedulePage />, '/schedule')
  await screen.findByTestId('schedule-workspace')
  expect(await axe(container)).toHaveNoViolations()
})

test('SessionModal has no axe violations', async () => {
  seed('owner')
  const { container } = renderPage(<SchedulePage />, '/schedule')
  await screen.findByTestId('schedule-workspace')
  await userEvent.click(screen.getByTestId('schedule-new-session'))
  await screen.findByTestId('session-modal')
  expect(await axe(container)).toHaveNoViolations()
})

test('/my-schedule student stub has no axe violations', async () => {
  seed('student')
  const { container } = renderPage(<MySchedulePage />, '/my-schedule')
  await screen.findByTestId('my-schedule-placeholder')
  expect(await axe(container)).toHaveNoViolations()
})
