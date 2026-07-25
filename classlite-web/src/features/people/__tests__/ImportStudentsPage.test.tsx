/**
 * Story 2.7 — ImportStudentsPage component tests (TEST-FE-1..6, TEST-UX-2).
 *
 * Mock seam = MSW at the HTTP boundary (presign + R2 PUT via XHR + preview +
 * confirm). Covers: dropzone idle/empty, wrong-type reject, upload → preview
 * (badges + aria-live summary), Confirm ENABLED with error rows (partial-import
 * contract), submit-lock while confirming, result self-verify + error-CSV
 * download, i18n key existence (en + vi), and axe cleanliness.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import { http, HttpResponse, delay } from 'msw'
import type { ReactElement } from 'react'
import i18n from '@/lib/i18n'
import enMessages from '@/locales/en.json'
import viMessages from '@/locales/vi.json'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RoleProvider } from '@/hooks/RoleContext'
import ImportStudentsPage from '@/features/people/ImportStudentsPage'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import type { Role } from '@/hooks/useRole'
import type { components } from '@/lib/api/client'

const CENTER_ID = '00000000-0000-0000-0000-0000000000aa'
const PRESIGN_URL = 'https://r2.upload.test/put-target'
const OBJECT_KEY = `${CENTER_ID}/imports/abc.csv`

type ImportPreview = components['schemas']['ImportPreview']
type ImportResult = components['schemas']['ImportResult']

const META = { serverTime: '2026-07-24T00:00:00Z' }

// A mixed preview: one importable new_user + one validation_error (partial).
const MIXED_PREVIEW: ImportPreview = {
  rows: [
    { rowNumber: 1, email: 'alice@example.com', fullName: 'Alice', className: '', status: 'new_user', error: '' },
    { rowNumber: 2, email: 'bad', fullName: 'Bad Row', className: '', status: 'validation_error', error: 'INVALID_EMAIL' },
  ],
  summary: { total: 2, willImport: 1, willSkip: 1, unassigned: 1 },
}

const MIXED_RESULT: ImportResult = {
  rows: [
    { rowNumber: 1, email: 'alice@example.com', status: 'new_user', persisted: true, error: '' },
    { rowNumber: 2, email: 'bad', status: 'validation_error', persisted: false, error: 'INVALID_EMAIL' },
  ],
  created: 1,
  invitesSent: true,
  failed: 1,
}

function importHandlers(opts: { confirmDelayMs?: number } = {}) {
  return [
    http.post('/api/uploads/presign', () =>
      HttpResponse.json({ data: { url: PRESIGN_URL, key: OBJECT_KEY } }),
    ),
    http.put(PRESIGN_URL, () => new HttpResponse(null, { status: 200 })),
    http.post('/api/students/import/preview', () =>
      HttpResponse.json({ data: MIXED_PREVIEW, meta: META }),
    ),
    http.post('/api/students/import', async () => {
      if (opts.confirmDelayMs) await delay(opts.confirmDelayMs)
      return HttpResponse.json({ data: MIXED_RESULT, meta: META })
    }),
  ]
}

function seedSession(client: QueryClient): void {
  client.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u1', email: 'owner@example.com', fullName: 'Owner', emailVerified: true } as unknown as Session['user'],
    accessToken: 'a.b.c',
    center: null,
    role: 'owner',
  })
}

function renderPage(): { client: QueryClient; container: HTMLElement } {
  const client = createTestQueryClient()
  seedSession(client)
  const shell: ReactElement = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RoleProvider value="owner">
          <MemoryRouter initialEntries={['/students/import']}>
            <ImportStudentsPage />
          </MemoryRouter>
        </RoleProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const { container } = render(shell)
  return { client, container }
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input as HTMLInputElement
}

function csvFile(name = 'students.csv'): File {
  return new File(['email,full_name,class_name\nalice@example.com,Alice,\n'], name, {
    type: 'text/csv',
  })
}

beforeEach(() => {
  server.use(...importHandlers())
})

afterEach(() => {
  server.resetHandlers()
})

describe('ImportStudentsPage', () => {
  test('renders the idle dropzone (empty state)', () => {
    const { container } = renderPage()
    expect(screen.getByText(i18n.t('people.import.dropzone.idle'))).toBeInTheDocument()
    expect(fileInput(container)).toBeInTheDocument()
  })

  test('rejects a wrong file type client-side without uploading', async () => {
    const { container } = renderPage()
    // fireEvent.change (not userEvent.upload) so the native `accept` filter is
    // bypassed and the app's OWN client-side gate (importFileSchema) runs.
    fireEvent.change(fileInput(container), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('people.import.errors.wrongType'),
    )
    // Never advanced to the preview.
    expect(screen.queryByTestId('import-summary-banner')).not.toBeInTheDocument()
  })

  test('upload → preview shows per-row badges + an aria-live summary banner', async () => {
    const { container } = renderPage()
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())

    const banner = await screen.findByTestId('import-summary-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveTextContent('1')
    // The validation_error row renders its localized reason.
    expect(screen.getByText(i18n.t('people.import.rowError.INVALID_EMAIL'))).toBeInTheDocument()
    // Both row statuses render as badges.
    expect(screen.getByText(i18n.t('people.import.status.new_user'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('people.import.status.validation_error'))).toBeInTheDocument()
  })

  test('Confirm is ENABLED even with error rows (partial-import contract)', async () => {
    const { container } = renderPage()
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())
    const confirm = await screen.findByTestId('import-confirm-button')
    // 1 importable row + 1 error row → still enabled.
    expect(confirm).toBeEnabled()
  })

  test('confirm → result screen self-verifies the persisted roster', async () => {
    const { container } = renderPage()
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())

    await user.click(await screen.findByTestId('import-confirm-button'))
    // Dialog confirm.
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByText(i18n.t('people.import.confirmDialog.confirm')))

    const summary = await screen.findByTestId('import-result-summary')
    expect(summary).toHaveTextContent('1')
    // Persisted + skipped rows are both shown inline (self-verification).
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    // The error report download affordance appears because there was a failure.
    expect(screen.getByTestId('import-error-report-download')).toBeInTheDocument()
  })

  test('submit-lock: Confirm is disabled while the import is in flight', async () => {
    const { container } = renderPage()
    server.use(...importHandlers({ confirmDelayMs: 80 }))
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())

    const confirm = await screen.findByTestId('import-confirm-button')
    await user.click(confirm)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByText(i18n.t('people.import.confirmDialog.confirm')))

    // While confirming, the button reflects the pending/disabled state.
    await waitFor(() => {
      expect(screen.getByTestId('import-confirm-button')).toBeDisabled()
    })
    // And eventually the result lands.
    await screen.findByTestId('import-result-summary')
  })

  test('all people.import keys used here exist in both en and vi', () => {
    const keys = [
      'people.import.title',
      'people.import.dropzone.idle',
      'people.import.errors.wrongType',
      'people.import.summary.banner',
      'people.import.status.new_user',
      'people.import.status.validation_error',
      'people.import.rowError.INVALID_EMAIL',
      'people.import.confirmDialog.confirm',
      'people.import.result.summary',
      'people.import.result.downloadErrors',
    ]
    const en = enMessages as Record<string, string>
    const vi = viMessages as Record<string, string>
    for (const key of keys) {
      expect(en[key], `en missing ${key}`).toBeTruthy()
      expect(vi[key], `vi missing ${key}`).toBeTruthy()
    }
  })

  test('role-negative: a student cannot reach the import route (absent from DOM)', () => {
    const client = createTestQueryClient()
    client.setQueryData<Session>(authKeys.session(), {
      user: { id: 's1', email: 'student@example.com', fullName: 'Student', emailVerified: true } as unknown as Session['user'],
      accessToken: 'a.b.c',
      center: null,
      role: 'student',
    })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <RoleProvider value={'student' as Role}>
            <MemoryRouter initialEntries={['/students/import']}>
              <Routes>
                <Route
                  element={
                    <RouteRoleGate
                      allowedRoles={['owner', 'admin']}
                      requiredRolesForCopy={['owner', 'admin']}
                      sectionNameKey="students"
                    />
                  }
                >
                  <Route path="/students/import" element={<ImportStudentsPage />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </RoleProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    // The import page's dropzone must be ABSENT (not merely hidden) for a student.
    expect(screen.queryByText(i18n.t('people.import.dropzone.idle'))).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('app.permissionDenied.title'))).toBeInTheDocument()
  })

  test('preview has no axe violations', async () => {
    const { container } = renderPage()
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())
    await screen.findByTestId('import-summary-banner')
    expect(await axe(container)).toHaveNoViolations()
  })

  // FB1 — a preview rejection carries a typed code; the specific message shows
  // (not the generic "upload failed"). AC6 200-row rejection is the driver.
  test('surfaces the 200-row-limit message when preview returns IMPORT_ROW_LIMIT_EXCEEDED', async () => {
    const { container } = renderPage()
    server.use(
      http.post('/api/students/import/preview', () =>
        HttpResponse.json(
          { error: { code: 'IMPORT_ROW_LIMIT_EXCEEDED', message: 'too many rows', requestId: 'r1' } },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('people.import.errors.rowLimit'),
    )
    expect(screen.queryByTestId('import-summary-banner')).not.toBeInTheDocument()
  })

  // FB1 — an oversize confirm (413) shows the file-too-large message, not generic.
  test('surfaces the file-too-large message when confirm returns IMPORT_FILE_TOO_LARGE', async () => {
    const { container } = renderPage()
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())
    server.use(
      http.post('/api/students/import', () =>
        HttpResponse.json(
          { error: { code: 'IMPORT_FILE_TOO_LARGE', message: 'too big', requestId: 'r2' } },
          { status: 413 },
        ),
      ),
    )
    await user.click(await screen.findByTestId('import-confirm-button'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByText(i18n.t('people.import.confirmDialog.confirm')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('people.import.errors.fileTooLarge'),
    )
  })

  // FB6 — an empty (0-row) preview renders an empty-state, not a headers-only
  // table, and Confirm is disabled.
  test('renders an empty-state when the preview has no rows', async () => {
    const { container } = renderPage()
    server.use(
      http.post('/api/students/import/preview', () =>
        HttpResponse.json(
          { data: { rows: [], summary: { total: 0, willImport: 0, willSkip: 0, unassigned: 0 } }, meta: META },
        ),
      ),
    )
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile())
    expect(await screen.findByTestId('import-preview-empty')).toBeInTheDocument()
    expect(screen.getByTestId('import-confirm-button')).toBeDisabled()
    expect(screen.queryByTestId('import-preview-row')).not.toBeInTheDocument()
  })

  // FB2 — the new review error/status keys exist in BOTH locales (UX-2).
  test('new review error + status keys exist in both en and vi', () => {
    const keys = [
      'people.import.errors.rowLimit',
      'people.import.errors.fileTooLarge',
      'people.import.errors.fileNotFound',
      'people.import.errors.malformedFile',
      'people.import.rowError.USER_ALREADY_STAFF',
      'people.import.preview.empty',
    ]
    const en = enMessages as Record<string, string>
    const vi = viMessages as Record<string, string>
    for (const key of keys) {
      expect(en[key], `en missing ${key}`).toBeTruthy()
      expect(vi[key], `vi missing ${key}`).toBeTruthy()
    }
  })
})
