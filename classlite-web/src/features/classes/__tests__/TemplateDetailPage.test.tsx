// Story 3.3 (AC3) — TemplateDetailPage (s20): three-state trilogy, 404
// not-found, scope-gated actions, and the "Use this template" nav.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import type { ReactElement } from 'react'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import TemplateDetailPage from '@/features/classes/TemplateDetailPage'
import {
  templateDetail,
  getTemplateHandlers,
  getTemplateNotFoundHandlers,
} from '@/features/classes/api/__tests__/handlers'

function LocationProbe(): ReactElement {
  const location = useLocation()
  return (
    <div data-testid="probe">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  )
}

function renderDetail(id: string): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/classes/templates/${id}`]}>
          <Routes>
            <Route
              path="/classes/templates/:id"
              element={<TemplateDetailPage />}
            />
            <Route path="/classes" element={<LocationProbe />} />
            <Route path="/classes/templates" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('TemplateDetailPage (s20)', () => {
  test('renders skeleton then the detail + session blueprint', async () => {
    const detail = templateDetail({ id: 'tpl-x', name: 'Blueprint Template' })
    server.use(...getTemplateHandlers(detail))
    renderDetail('tpl-x')

    expect(screen.getByTestId('template-detail-skeleton')).toBeInTheDocument()

    expect(await screen.findByText('Blueprint Template')).toBeInTheDocument()
    expect(screen.getByTestId('template-blueprint')).toBeInTheDocument()
    expect(screen.getByText('Session One')).toBeInTheDocument()
    expect(screen.getByText('Session Two')).toBeInTheDocument()
  })

  test('renders 404 not-found for a missing / soft-deleted template', async () => {
    server.use(...getTemplateNotFoundHandlers('tpl-gone'))
    renderDetail('tpl-gone')

    expect(
      await screen.findByTestId('template-detail-not-found'),
    ).toBeInTheDocument()
  })

  test('center-scope template shows Edit + Delete actions', async () => {
    server.use(...getTemplateHandlers(templateDetail({ id: 'tpl-c', scope: 'center' })))
    renderDetail('tpl-c')

    await screen.findByTestId('template-detail-page')
    expect(screen.getByTestId('template-detail-edit')).toBeInTheDocument()
    expect(screen.getByTestId('template-detail-delete')).toBeInTheDocument()
  })

  test('system-scope seed HIDES Edit + Delete actions (view-only)', async () => {
    server.use(...getTemplateHandlers(templateDetail({ id: 'tpl-s', scope: 'system' })))
    renderDetail('tpl-s')

    await screen.findByTestId('template-detail-page')
    expect(screen.queryByTestId('template-detail-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('template-detail-delete')).not.toBeInTheDocument()
    // "Use this template" is available for everyone.
    expect(screen.getByTestId('template-use-cta')).toBeInTheDocument()
  })

  test('"Use this template" navigates to /classes with the template id in state', async () => {
    const user = userEvent.setup()
    server.use(...getTemplateHandlers(templateDetail({ id: 'tpl-u', scope: 'center' })))
    renderDetail('tpl-u')

    await user.click(await screen.findByTestId('template-use-cta'))
    await waitFor(() => {
      const probe = screen.getByTestId('probe')
      expect(probe.textContent).toContain('/classes')
      expect(probe.textContent).toContain('createWithTemplateId')
      expect(probe.textContent).toContain('tpl-u')
    })
  })
})
