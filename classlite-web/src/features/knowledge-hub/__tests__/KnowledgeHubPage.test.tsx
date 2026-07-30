// Story 4.4b (TEST-FE-1..6) — KnowledgeHubPage: trilogy (skeleton / loaded /
// error), the TWO empty states (true-empty hero vs empty-folder), folder+file
// tiles, the owner/admin/teacher route gate (student denied), i18n parity, axe.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http, delay } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { KnowledgeHubPage } from '@/features/knowledge-hub/KnowledgeHubPage'
import type { Role } from '@/features/auth/api/authKeys'
import {
  clearSession,
  file,
  folder,
  renderAt,
  Route,
  Routes,
  seedSession,
} from './harness'

const USAGE = { usedBytes: 10, limitBytes: 500 * 1024 * 1024 }

function handlers(
  opts: {
    folders?: ReturnType<typeof folder>[]
    files?: ReturnType<typeof file>[]
    foldersError?: boolean
    delayFolders?: boolean
  } = {},
) {
  return [
    http.get('/api/knowledge-hub/folders', async () => {
      if (opts.delayFolders) await delay(40)
      if (opts.foldersError) return HttpResponse.error()
      return HttpResponse.json({ data: opts.folders ?? [] })
    }),
    http.get('/api/knowledge-hub/files', () => HttpResponse.json({ data: opts.files ?? [] })),
    http.get('/api/storage/usage', () => HttpResponse.json({ data: USAGE })),
  ]
}

function routes() {
  return (
    <Routes>
      <Route path="/knowledge-hub" element={<KnowledgeHubPage />} />
      <Route path="/knowledge-hub/files/:slug" element={<div>detail</div>} />
    </Routes>
  )
}

function renderGated(role: Role): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/knowledge-hub']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="knowledgeHub"
                />
              }
            >
              <Route path="/knowledge-hub" element={<KnowledgeHubPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('KnowledgeHubPage', () => {
  test('renders the skeleton while loading', () => {
    server.use(...handlers({ delayFolders: true }))
    renderAt('owner', '/knowledge-hub', routes())
    expect(screen.getByTestId('kh-skeleton')).toBeInTheDocument()
  })

  test('renders the true-empty hero when the whole hub is empty', async () => {
    server.use(...handlers({ folders: [], files: [] }))
    renderAt('owner', '/knowledge-hub', routes())
    expect(await screen.findByTestId('kh-empty-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('kh-empty-folder')).not.toBeInTheDocument()
  })

  test('renders folder + file tiles on success', async () => {
    server.use(
      ...handlers({
        folders: [folder({ id: 'fold-1', name: 'Listening' })],
        files: [file({ id: 'file-1', name: 'unit-1.pdf' })],
      }),
    )
    renderAt('owner', '/knowledge-hub', routes())
    expect(await screen.findByTestId('kh-folder-tile-fold-1')).toBeInTheDocument()
    expect(screen.getByTestId('kh-file-tile-file-1')).toBeInTheDocument()
    expect(screen.getByText('unit-1.pdf')).toBeInTheDocument()
  })

  test('renders the inline error + retry on load failure', async () => {
    server.use(...handlers({ foldersError: true }))
    renderAt('owner', '/knowledge-hub', routes())
    expect(await screen.findByTestId('kh-error')).toBeInTheDocument()
  })

  test('a student is denied by the route gate; the page never mounts (TEST-FE-6)', async () => {
    server.use(...handlers({ folders: [], files: [] }))
    renderGated('student')
    await waitFor(() =>
      expect(screen.getByTestId('permission-denied-section-header')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('knowledge-hub-page')).not.toBeInTheDocument()
  })

  test('has no accessibility violations (loaded)', async () => {
    server.use(...handlers({ folders: [folder({ name: 'A' })], files: [file({ name: 'a.pdf' })] }))
    const { container } = renderAt('owner', '/knowledge-hub', routes())
    await screen.findByTestId('kh-tile-grid')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('all knowledgeHub keys used here exist in both locales (TEST-FE-4)', () => {
    const keys = [
      'knowledgeHub.heading',
      'knowledgeHub.actions.upload',
      'knowledgeHub.actions.newFolder',
      'knowledgeHub.empty.true.headline',
      'knowledgeHub.empty.folder.headline',
      'knowledgeHub.error.body',
    ]
    for (const key of keys) {
      expect(i18n.getFixedT('en')(key)).not.toBe(key)
      expect(i18n.getFixedT('vi')(key)).not.toBe(key)
    }
  })
})
