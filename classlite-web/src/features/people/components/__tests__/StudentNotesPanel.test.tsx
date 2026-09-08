// ATDD RED-PHASE — Story 7-2b, Task 6 (teacher notes composer + log). AC15-18.
//
// RED signal: `@/features/people/components/StudentNotesPanel` does not exist yet.
// No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
//
// ⭐ TEST-FE-6 (security-adjacent, MANDATORY DoD): the delete affordance is shown
// ONLY to the note's author OR an owner/admin. A non-author teacher must NOT see
// a delete control in the DOM — not merely disabled (D11). The backend enforces
// (403 FORBIDDEN); this is the UI companion.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • data-testid="student-notes-panel" root; data-testid="note-skeleton" while loading
//   • data-testid="student-note-{noteId}" per item, with data-flagged="true|false"
//     (flagged → amber variant; NO red "warn" tier — unbacked, D11)
//   • data-testid="notes-empty" empty state; role="alert" on error
//   • composer: a textbox (people.student.notes.placeholder) + a flag toggle
//     (people.student.notes.flagToggle) + a Save button (people.student.notes.save)
//     — Save disabled while content is empty/whitespace
//   • data-testid="note-delete-{noteId}" present IFF author-or-owner
//   • Attach + @mention affordances are ABSENT (deferred, FU-7-2-A/B, D11/D14)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
// RED: this module does not exist yet.
import { StudentNotesPanel } from '@/features/people/components/StudentNotesPanel'
import {
  DEFAULT_CENTER_ID,
  STUDENT_NORMAL_ID,
  NOTE_PLAIN_ID,
  NOTE_FLAGGED_ID,
  NOTE_BY_OTHER_AUTHOR_ID,
  notePlain,
  noteFlagged,
  notesListHandlers,
  notesEmptyHandlers,
  notes500Handlers,
  createNoteHandlers,
  setNoteFlagHandlers,
  deleteNoteHandlers,
} from '@/features/people/api/__tests__/studentHandlers'

// The seeded session fullName MUST equal notePlain.authorName ('Viewer') so the
// author-gated delete affordance shows for the author path.
const STUB_USER: UserSummary = {
  id: 'user-viewer',
  email: 'viewer@example.com',
  fullName: 'Viewer',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

function renderPanel(role: Role): { container: HTMLElement } {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <StudentNotesPanel studentId={STUDENT_NORMAL_ID} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('StudentNotesPanel — AC15 trilogy + chronological log', () => {
  test('P0 skeleton while loading', () => {
    server.use(...notesListHandlers())
    renderPanel('teacher')
    expect(screen.getAllByTestId(/^note-skeleton/).length).toBeGreaterThanOrEqual(1)
  })

  test('P0 renders notes on success with flagged/plain variants', async () => {
    server.use(...notesListHandlers())
    renderPanel('teacher')
    const plain = await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    expect(plain).toHaveAttribute('data-flagged', 'false')
    const flagged = screen.getByTestId(`student-note-${NOTE_FLAGGED_ID}`)
    expect(flagged).toHaveAttribute('data-flagged', 'true')
    expect(within(plain).getByText(notePlain.content)).toBeInTheDocument()
    expect(within(flagged).getByText(noteFlagged.content)).toBeInTheDocument()
  })

  test('P1 empty state when there are no notes', async () => {
    server.use(...notesEmptyHandlers)
    renderPanel('teacher')
    expect(await screen.findByTestId('notes-empty')).toBeInTheDocument()
  })

  test('P1 error alert on 500', async () => {
    server.use(...notes500Handlers)
    renderPanel('teacher')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('StudentNotesPanel — AC16 composer', () => {
  test('P0 Save is disabled while content is empty, enabled after typing', async () => {
    server.use(...notesListHandlers())
    const user = userEvent.setup()
    renderPanel('teacher')
    await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    const save = screen.getByRole('button', { name: i18n.t('people.student.notes.save') })
    expect(save).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: new RegExp(i18n.t('people.student.notes.placeholder'), 'i') }),
      'Follow up on Task 2 next week',
    )
    expect(save).toBeEnabled()
  })

  test('P0 submitting creates a note (POST 201), it appears, and the composer clears', async () => {
    server.use(...notesListHandlers(), ...createNoteHandlers())
    const user = userEvent.setup()
    renderPanel('teacher')
    const textbox = await screen.findByRole('textbox', {
      name: new RegExp(i18n.t('people.student.notes.placeholder'), 'i'),
    })
    await user.type(textbox, 'brand new note')
    await user.click(screen.getByRole('button', { name: i18n.t('people.student.notes.save') }))
    expect(await screen.findByTestId('student-note-note-created')).toBeInTheDocument()
    await waitFor(() => expect(textbox).toHaveValue(''))
  })

  test('P1 the Attach and @mention affordances are ABSENT (deferred, D11/D14)', async () => {
    server.use(...notesListHandlers())
    renderPanel('teacher')
    await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    expect(screen.queryByTestId('note-attach')).not.toBeInTheDocument()
    expect(screen.queryByTestId('note-mention')).not.toBeInTheDocument()
  })
})

describe('StudentNotesPanel — AC17 flag toggle + author/owner-gated delete (TEST-FE-6)', () => {
  test('P1 toggling a note flag issues a PATCH and reflects the new state', async () => {
    server.use(...notesListHandlers(), ...setNoteFlagHandlers())
    const user = userEvent.setup()
    renderPanel('teacher')
    const plain = await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    await user.click(
      within(plain).getByRole('button', { name: new RegExp(i18n.t('people.student.notes.flagToggle'), 'i') }),
    )
    await waitFor(() =>
      expect(screen.getByTestId(`student-note-${NOTE_PLAIN_ID}`)).toHaveAttribute('data-flagged', 'true'),
    )
  })

  test('P0 an OWNER sees a delete control on every note (incl. other-authored)', async () => {
    server.use(...notesListHandlers(), ...deleteNoteHandlers)
    renderPanel('owner')
    await screen.findByTestId(`student-note-${NOTE_BY_OTHER_AUTHOR_ID}`)
    expect(screen.getByTestId(`note-delete-${NOTE_BY_OTHER_AUTHOR_ID}`)).toBeInTheDocument()
  })

  test('P0 a non-author TEACHER has NO delete control on another author\'s note (absent, not disabled)', async () => {
    server.use(...notesListHandlers())
    renderPanel('teacher')
    // The teacher (fullName "Viewer") authored notePlain → CAN delete it…
    await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    expect(screen.getByTestId(`note-delete-${NOTE_PLAIN_ID}`)).toBeInTheDocument()
    // …but noteByOtherAuthor was authored by "Another Teacher" → NO delete control.
    expect(
      screen.queryByTestId(`note-delete-${NOTE_BY_OTHER_AUTHOR_ID}`),
    ).not.toBeInTheDocument()
  })

  test('P1 the author deletes their own note (DELETE 204) and it disappears', async () => {
    server.use(...notesListHandlers(), ...deleteNoteHandlers)
    const user = userEvent.setup()
    renderPanel('teacher')
    const note = await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    await user.click(within(note).getByTestId(`note-delete-${NOTE_PLAIN_ID}`))
    await waitFor(() =>
      expect(screen.queryByTestId(`student-note-${NOTE_PLAIN_ID}`)).not.toBeInTheDocument(),
    )
  })
})

describe('StudentNotesPanel — AC15 accessibility (TEST-FE-5)', () => {
  test('P0 axe: the notes panel has no accessibility violations', async () => {
    server.use(...notesListHandlers())
    const { container } = renderPanel('teacher')
    await screen.findByTestId(`student-note-${NOTE_PLAIN_ID}`)
    expect(await axe(container)).toHaveNoViolations()
  })
})
