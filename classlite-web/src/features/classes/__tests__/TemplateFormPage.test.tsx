// Story 3.3 (AC6/AC8) — TemplateFormPage (s21): create/edit, derived
// sessionCount, full-replace session ordering in the save payload, add/remove,
// drag-handle a11y (keyboard-operable), and inline validation.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import TemplateFormPage from '@/features/classes/TemplateFormPage'
import {
  templateDetail,
  getTemplateHandlers,
} from '@/features/classes/api/__tests__/handlers'

function renderForm(initialPath: string): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/classes/templates/new" element={<TemplateFormPage />} />
            <Route
              path="/classes/templates/:id/edit"
              element={<TemplateFormPage />}
            />
            <Route
              path="/classes/templates/:id"
              element={<div data-testid="detail-landing" />}
            />
            <Route path="/classes/templates" element={<div data-testid="index-landing" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('TemplateFormPage (s21) — create', () => {
  test('POSTs with derived sessionCount and ordered sessions', async () => {
    const user = userEvent.setup()
    let captured: unknown
    server.use(
      http.post('/api/templates', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json(
          { data: { id: 'new-tpl' }, meta: { serverTime: 'x' } },
          { status: 201 },
        )
      }),
    )
    renderForm('/classes/templates/new')

    await user.type(screen.getByTestId('template-field-name'), 'My Template')
    await user.type(screen.getByTestId('template-session-title-0'), 'First')
    await user.type(screen.getByTestId('template-session-duration-0'), '60')

    await user.click(screen.getByTestId('template-add-session'))
    await user.type(screen.getByTestId('template-session-title-1'), 'Second')

    await user.click(screen.getByTestId('template-form-save'))

    await screen.findByTestId('detail-landing')
    const body = captured as {
      name: string
      sessionCount: number
      sessions: Array<{ title: string; duration: number | null }>
    }
    expect(body.name).toBe('My Template')
    expect(body.sessionCount).toBe(2)
    expect(body.sessions.map((s) => s.title)).toEqual(['First', 'Second'])
    expect(body.sessions[0].duration).toBe(60)
    expect(body.sessions[1].duration).toBeNull()
  })

  test('blocks submit with an empty name (inline validation, no POST)', async () => {
    const user = userEvent.setup()
    let posted = false
    server.use(
      http.post('/api/templates', () => {
        posted = true
        return HttpResponse.json({ data: { id: 'x' }, meta: { serverTime: 'x' } }, { status: 201 })
      }),
    )
    renderForm('/classes/templates/new')

    await user.type(screen.getByTestId('template-session-title-0'), 'Only session')
    await user.click(screen.getByTestId('template-form-save'))

    expect(await screen.findByText(i18n.t('classes.templates.form.errors.nameRequired'))).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  test('add then remove a session returns to one row', async () => {
    const user = userEvent.setup()
    renderForm('/classes/templates/new')

    await user.click(screen.getByTestId('template-add-session'))
    expect(screen.getByTestId('template-session-row-1')).toBeInTheDocument()

    await user.click(screen.getByTestId('template-session-remove-1'))
    expect(screen.queryByTestId('template-session-row-1')).not.toBeInTheDocument()
  })

  test('each session row exposes a keyboard-operable drag handle (a11y)', async () => {
    renderForm('/classes/templates/new')
    const handle = screen.getByTestId('template-session-drag-0')
    // useSortable wires a <button> with an accessible name; keyboard-reachable.
    expect(handle.tagName).toBe('BUTTON')
    expect(handle).toHaveAttribute('aria-label')
    expect(handle).toHaveAttribute('aria-roledescription')
  })
})

describe('TemplateFormPage (s21) — edit', () => {
  test('loads the detail then PUTs the full-replace session set in order', async () => {
    const user = userEvent.setup()
    const detail = templateDetail({ id: 'tpl-e', name: 'Editable', scope: 'center' })
    let captured: unknown
    server.use(
      ...getTemplateHandlers(detail),
      http.put('/api/templates/tpl-e', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json(
          { data: { ...detail, name: 'Renamed' }, meta: { serverTime: 'x' } },
          { status: 200 },
        )
      }),
    )
    renderForm('/classes/templates/tpl-e/edit')

    // Prefilled from the detail (2 sessions, in order).
    expect(await screen.findByDisplayValue('Editable')).toBeInTheDocument()
    expect(screen.getByTestId('template-session-title-0')).toHaveValue('Session One')
    expect(screen.getByTestId('template-session-title-1')).toHaveValue('Session Two')

    await user.click(screen.getByTestId('template-form-save'))

    await screen.findByTestId('detail-landing')
    const body = captured as {
      sessions: Array<{ title: string }>
    }
    expect(body.sessions.map((s) => s.title)).toEqual(['Session One', 'Session Two'])
  })
})
