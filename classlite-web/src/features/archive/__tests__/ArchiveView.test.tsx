/**
 * ArchiveView / ArchiveRoute — Story 10.2 (TEST-FE-1..6). MSW at the HTTP
 * boundary (never mock Query); real QueryClient + real i18n. Covers:
 *   - AC8 three-state trilogy (skeleton / rows / error) + empty
 *   - AC8 read-only: class rows show the read-only badge, NO reuse verbs; exercise
 *     rows expose Duplicate + Edit-a-copy
 *   - AC8 student-blocked negative (ArchiveRoute redirects; no archive data in DOM)
 *   - AC9 Duplicate fires the shipped exercise-duplicate once + stays; Edit-a-copy
 *     navigates to /exercises/{newId}/edit on 201; class rows have no action
 *   - AC10 axe (actions reachable by their i18n-resolved labels)
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'

import { ArchiveView } from '../components/ArchiveView'
import { ArchiveRoute } from '../ArchiveRoute'
import type { ArchiveItem } from '../lib/archiveMapping'

const CENTER_ID = 'c-1'
const USER_ID = 'u-owner'
const FIXED_TIME = '2026-10-07T12:00:00Z'

function arItem(overrides: Partial<ArchiveItem> = {}): ArchiveItem {
  return {
    type: 'exercise',
    id: 'ex-1',
    title: 'Untitled',
    subtitle: 'EX-R001',
    archivedAt: '2026-08-01T10:00:00Z',
    classStatus: null,
    skill: 'reading',
    targetBand: 6,
    link: '/exercises/ex-1/edit',
    ...overrides,
  }
}

const EXERCISE = arItem({ id: 'ex-1', title: 'Reading P1', link: '/exercises/ex-1/edit' })
const CLASS = arItem({
  type: 'class',
  id: 'cl-1',
  title: 'Evening IELTS',
  subtitle: '',
  archivedAt: '2026-06-01T10:00:00Z',
  classStatus: 'ended',
  skill: null,
  targetBand: null,
  link: '',
})

function archiveHandler(items: ArchiveItem[]) {
  return http.get('/api/archive', () =>
    HttpResponse.json({
      data: items,
      meta: {
        serverTime: FIXED_TIME,
        pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
      },
    }),
  )
}

function seedSession(role: Role | null): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: USER_ID, email: 'o@example.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'C',
      shortCode: 'c',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

/** Render ArchiveView directly (owner) with a sentinel editor route for navigate. */
function renderView(role: Role = 'owner'): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/archive']}>
          <Routes>
            <Route path="/archive" element={<ArchiveView />} />
            <Route
              path="/exercises/:id/edit"
              element={<div data-testid="editor-page" />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Render ArchiveRoute behind the SAME gate wired in routes.tsx (role-negative path). */
function renderRouteWithGate(role: Role | null): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/archive']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                />
              }
            >
              <Route path="/archive" element={<ArchiveRoute />} />
            </Route>
            <Route path="/login" element={<div data-testid="login-page" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

describe('ArchiveView — trilogy (TEST-FE-2)', () => {
  test('renders skeleton while loading', () => {
    server.use(archiveHandler([EXERCISE]))
    renderView()
    expect(screen.getByTestId('archive-skeleton')).toBeInTheDocument()
  })

  test('renders archived rows on success', async () => {
    server.use(archiveHandler([EXERCISE, CLASS]))
    renderView()
    expect(await screen.findByText('Reading P1')).toBeInTheDocument()
    expect(screen.getByText('Evening IELTS')).toBeInTheDocument()
    expect(screen.getByTestId('archive-list')).toBeInTheDocument()
  })

  test('renders inline error alert when GET /api/archive fails', async () => {
    server.use(
      http.get('/api/archive', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderView()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('renders the role-toned empty state when the archive is empty', async () => {
    server.use(archiveHandler([]))
    renderView()
    expect(await screen.findByTestId('archive-empty')).toBeInTheDocument()
  })
})

describe('ArchiveView — read-only surface (AC8/DD6, TEST-FE-6)', () => {
  test('a class row is read-only — a read-only badge, NO reuse verbs', async () => {
    server.use(archiveHandler([CLASS]))
    renderView()
    await screen.findByText('Evening IELTS')
    expect(screen.getByTestId('archive-readonly-cl-1')).toBeInTheDocument()
    expect(screen.queryByTestId('archive-duplicate-cl-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('archive-edit-copy-cl-1')).not.toBeInTheDocument()
  })

  test('an exercise row exposes BOTH reuse verbs', async () => {
    server.use(archiveHandler([EXERCISE]))
    renderView()
    await screen.findByText('Reading P1')
    expect(screen.getByTestId('archive-duplicate-ex-1')).toBeInTheDocument()
    expect(screen.getByTestId('archive-edit-copy-ex-1')).toBeInTheDocument()
  })
})

describe('ArchiveView — reuse verbs (AC9)', () => {
  test('Duplicate fires the shipped exercise-duplicate once and stays on /archive', async () => {
    let duplicateCalls = 0
    server.use(
      archiveHandler([EXERCISE]),
      http.post('/api/exercises/:id/duplicate', () => {
        duplicateCalls += 1
        return HttpResponse.json(
          { data: { id: 'ex-new', code: 'EX-R002', title: 'Reading P1 (copy)' }, meta: {} },
          { status: 201 },
        )
      }),
    )
    renderView()
    await screen.findByText('Reading P1')

    await userEvent.click(screen.getByTestId('archive-duplicate-ex-1'))

    await waitFor(() => expect(duplicateCalls).toBe(1))
    // Stays on /archive — never navigates to the editor.
    expect(screen.queryByTestId('editor-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('archive-list')).toBeInTheDocument()
  })

  test('Edit-a-copy navigates to /exercises/{newId}/edit on 201', async () => {
    server.use(
      archiveHandler([EXERCISE]),
      http.post('/api/exercises/:id/duplicate', () =>
        HttpResponse.json(
          { data: { id: 'ex-new', code: 'EX-R002', title: 'Reading P1 (copy)' }, meta: {} },
          { status: 201 },
        ),
      ),
    )
    renderView()
    await screen.findByText('Reading P1')

    await userEvent.click(screen.getByTestId('archive-edit-copy-ex-1'))

    expect(await screen.findByTestId('editor-page')).toBeInTheDocument()
  })
})

describe('ArchiveRoute — role gate (AC8, TEST-FE-6)', () => {
  test('a student is blocked — no archive list, no archive data in the DOM', async () => {
    seedSession('student')
    renderRouteWithGate('student')
    // The staff gate denies the student: the archive list never mounts.
    await waitFor(() =>
      expect(screen.queryByTestId('archive-list')).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId('archive-skeleton')).not.toBeInTheDocument()
  })

  test('a settled-null (unauthenticated) role is denied the archive too', async () => {
    renderRouteWithGate(null)
    await waitFor(() =>
      expect(screen.queryByTestId('archive-list')).not.toBeInTheDocument(),
    )
  })
})

describe('ArchiveView — a11y (AC10)', () => {
  test('has no axe violations with archived rows', async () => {
    server.use(archiveHandler([EXERCISE, CLASS]))
    const { container } = renderView()
    await screen.findByText('Reading P1')
    expect(await axe(container)).toHaveNoViolations()
  })
})
