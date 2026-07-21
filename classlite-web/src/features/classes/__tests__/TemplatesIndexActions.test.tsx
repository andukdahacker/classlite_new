// Story 3.3 (AC1/AC4) — s19 row actions: scope-gated Edit/Delete + the
// delete-confirm flow (usedCount warning → optimistic removal).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { TemplatesIndexPage } from '@/features/classes/TemplatesIndexPage'
import { TemplateDeleteDialog } from '@/features/classes/components/TemplateDeleteDialog'
import {
  DEFAULT_CENTER_ID,
  templateSeed,
  templateCustom,
  templatesHandlers,
} from '@/features/classes/api/__tests__/handlers'

function seedSession(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u1', email: 'o@e.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
      name: 'C',
      shortCode: 'c',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'owner',
  })
}

function renderIndex(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/classes/templates']}>
          <Routes>
            <Route path="/classes/templates" element={<TemplatesIndexPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  seedSession()
  server.use(...templatesHandlers)
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

describe('s19 row actions', () => {
  test('system seed row exposes NO Edit/Delete; center row does', async () => {
    const user = userEvent.setup()
    renderIndex()
    await screen.findByText(templateSeed.name)

    // System seed: only View in the menu.
    await user.click(screen.getByTestId(`template-actions-${templateSeed.id}`))
    expect(screen.queryByTestId(`template-edit-${templateSeed.id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`template-delete-${templateSeed.id}`)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    // Center-owned: Edit + Delete present.
    await user.click(screen.getByTestId(`template-actions-${templateCustom.id}`))
    expect(screen.getByTestId(`template-edit-${templateCustom.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`template-delete-${templateCustom.id}`)).toBeInTheDocument()
  })

  test('delete-confirm dialog shows the usedCount warning and DELETEs on confirm', async () => {
    const user = userEvent.setup()
    let deleted = false
    server.use(
      http.delete('/api/templates/tpl-del', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const client = createTestQueryClient()
    let closed = false
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <TemplateDeleteDialog
              templateId="tpl-del"
              templateName="Doomed"
              usedCount={2}
              onClose={() => {
                closed = true
              }}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      i18n.t('classes.templates.delete.usedWarning', { count: 2 }),
    )

    await user.click(
      screen.getByRole('button', {
        name: i18n.t('classes.templates.delete.confirm'),
      }),
    )

    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(closed).toBe(true))
  })
})
