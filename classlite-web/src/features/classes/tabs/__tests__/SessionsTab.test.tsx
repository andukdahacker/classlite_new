// Story 3.4 Task 12 — the lit class-detail Sessions tab three-state (AC10).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import SessionsTab from '@/features/classes/tabs/SessionsTab'

const CLASS_ID = '22222222-2222-2222-2222-222222222222'

function renderTab(): void {
  const client = createTestQueryClient()
  const router = createMemoryRouter(
    [{ path: '/classes/:id/sessions', Component: SessionsTab }],
    { initialEntries: [`/classes/${CLASS_ID}/sessions`] },
  )
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function sessionRow() {
  const iso = new Date().toISOString()
  return {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    centerId: '00000000-0000-0000-0000-000000000001',
    classId: CLASS_ID,
    className: 'Class',
    classColor: null,
    topic: 'Reading practice',
    startsAt: iso,
    endsAt: iso,
    status: 'scheduled',
    cancelledAt: null,
    recurrenceGroupId: null,
    recurrencePattern: null,
    recurrenceTz: 'Asia/Ho_Chi_Minh',
    createdAt: iso,
    updatedAt: iso,
  }
}

afterEach(() => server.resetHandlers())

describe('SessionsTab (lit) — three-state', () => {
  test('renders the per-class session list on success', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [sessionRow()], meta: { serverTime: new Date().toISOString() } })))
    renderTab()
    expect(await screen.findByTestId('class-tab-sessions-list')).toBeInTheDocument()
    expect(screen.getByText('Reading practice')).toBeInTheDocument()
  })

  test('renders the empty state when no sessions', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.json({ data: [], meta: { serverTime: new Date().toISOString() } })))
    renderTab()
    expect(await screen.findByTestId('class-tab-sessions-empty')).toBeInTheDocument()
  })

  test('renders an error alert on network failure', async () => {
    server.use(http.get('*/api/sessions', () => HttpResponse.error()))
    renderTab()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
