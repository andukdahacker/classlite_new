// Story 3.5 — NotesSection three-state + optimistic CRUD (TEST-FE-1/2: real
// QueryClient, MSW at the HTTP boundary, never mock Query). NotesSection is the
// representative of the shared sessionContentApi factory (materials/exercises
// run the identical code path with different fields).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { Toaster } from '@/components/ui/sonner'
import { NotesSection } from '@/features/session-detail/components/NotesSection'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'
const CENTER_ID = '00000000-0000-0000-0000-000000000001'

function noteRow(id: string, body: string) {
  const iso = new Date().toISOString()
  return {
    id,
    centerId: CENTER_ID,
    sessionId: SESSION_ID,
    body,
    authorId: null,
    createdAt: iso,
    updatedAt: iso,
  }
}

function renderNotes() {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <NotesSection sessionId={SESSION_ID} />
        <Toaster />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('NotesSection — three-state', () => {
  test('renders the empty state when there are no notes', async () => {
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({ data: [], meta: { serverTime: new Date().toISOString() } }),
      ),
    )
    renderNotes()
    expect(await screen.findByTestId('session-notes-empty')).toBeInTheDocument()
  })

  test('renders the note list on success', async () => {
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({
          data: [noteRow('n1', 'Covered past perfect')],
          meta: { serverTime: new Date().toISOString() },
        }),
      ),
    )
    renderNotes()
    expect(await screen.findByText('Covered past perfect')).toBeInTheDocument()
    expect(screen.getByTestId('session-notes-list')).toBeInTheDocument()
  })

  test('renders an error alert + retry on network failure', async () => {
    server.use(http.get('*/api/sessions/:id/notes', () => HttpResponse.error()))
    renderNotes()
    expect(await screen.findByTestId('session-notes-error')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('NotesSection — CRUD', () => {
  test('adds a note (POST) and it appears in the list', async () => {
    const notes: ReturnType<typeof noteRow>[] = []
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({ data: notes, meta: { serverTime: new Date().toISOString() } }),
      ),
      http.post('*/api/sessions/:id/notes', async ({ request }) => {
        const body = (await request.json()) as { body: string }
        const created = noteRow(`n-${notes.length + 1}`, body.body)
        notes.push(created)
        return HttpResponse.json(
          { data: created, meta: { serverTime: new Date().toISOString() } },
          { status: 201 },
        )
      }),
    )
    renderNotes()
    await screen.findByTestId('session-notes-empty')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(i18n.t('session.notes.field.body')), 'A brand new note')
    await user.click(screen.getByRole('button', { name: i18n.t('session.notes.add') }))

    expect(await screen.findByText('A brand new note')).toBeInTheDocument()
  })

  test('deletes a note (DELETE) and it disappears', async () => {
    const notes = [noteRow('n1', 'Deletable note')]
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({ data: notes, meta: { serverTime: new Date().toISOString() } }),
      ),
      http.delete('*/api/sessions/:id/notes/:noteId', () => {
        notes.splice(0, notes.length)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderNotes()
    expect(await screen.findByText('Deletable note')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: i18n.t('session.detail.content.delete') }))

    await waitFor(() =>
      expect(screen.queryByText('Deletable note')).not.toBeInTheDocument(),
    )
  })

  test('edits a note (PATCH) and shows the updated body', async () => {
    const notes = [noteRow('n1', 'Original body')]
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({ data: notes, meta: { serverTime: new Date().toISOString() } }),
      ),
      http.patch('*/api/sessions/:id/notes/:noteId', async ({ request }) => {
        const body = (await request.json()) as { body: string }
        notes[0] = { ...notes[0], body: body.body }
        return HttpResponse.json({ data: notes[0], meta: { serverTime: new Date().toISOString() } })
      }),
    )
    renderNotes()
    await screen.findByText('Original body')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: i18n.t('session.detail.content.edit') }))
    // Scope to the list so we get the edit-row textarea, not the always-present add form.
    const field = within(screen.getByTestId('session-notes-list')).getByLabelText(
      i18n.t('session.notes.field.body'),
    )
    await user.clear(field)
    await user.type(field, 'Edited body')
    await user.click(screen.getByRole('button', { name: i18n.t('session.detail.content.save') }))

    expect(await screen.findByText('Edited body')).toBeInTheDocument()
  })

  test('surfaces an error toast and rolls back when create fails', async () => {
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({ data: [], meta: { serverTime: new Date().toISOString() } }),
      ),
      http.post('*/api/sessions/:id/notes', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom', requestId: 'r1' } },
          { status: 500 },
        ),
      ),
    )
    renderNotes()
    await screen.findByTestId('session-notes-empty')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(i18n.t('session.notes.field.body')), 'Doomed note')
    await user.click(screen.getByRole('button', { name: i18n.t('session.notes.add') }))

    // Error surfaced to the user...
    expect(await screen.findByText(i18n.t('session.detail.content.saveError'))).toBeInTheDocument()
    // ...and the optimistic row is rolled back, not left dangling.
    await waitFor(() =>
      expect(screen.queryByText('Doomed note')).not.toBeInTheDocument(),
    )
  })
})

describe('NotesSection — a11y', () => {
  test('has no axe violations in the loaded state', async () => {
    server.use(
      http.get('*/api/sessions/:id/notes', () =>
        HttpResponse.json({
          data: [noteRow('n1', 'Accessible note')],
          meta: { serverTime: new Date().toISOString() },
        }),
      ),
    )
    const { container } = renderNotes()
    await screen.findByText('Accessible note')
    expect(await axe(container)).toHaveNoViolations()
  })
})
