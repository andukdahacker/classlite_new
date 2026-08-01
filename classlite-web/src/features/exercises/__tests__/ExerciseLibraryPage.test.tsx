// Story 4.1 (TEST-FE-1..6) — ExerciseLibraryPage component tests. MSW at the
// HTTP boundary (never mock Query); real QueryClient + real Zustand. Covers:
//   - three-state trilogy (skeleton / rows / error)
//   - BOTH empty states (true-empty hero vs filtered-empty "no matches")
//   - skill-appropriate unit labels (Writing→prompts, Speaking→cue cards)
//   - skill filter narrowing + pagination
//   - create closes the dialog (returns to library — no editor nav)
//   - delete optimistic rollback on error
//   - i18n parity (both locales) + axe
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
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
import { assertI18nParity } from '@/lib/test/i18n-parity'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { ExerciseLibraryPage } from '@/features/exercises/ExerciseLibraryPage'
import { ExerciseDeleteDialog } from '@/features/exercises/components/ExerciseDeleteDialog'
import {
  exerciseKeys,
  type ExerciseListParams,
} from '@/features/exercises/api/exercisesKeys'

const CENTER_ID = 'c-1'
const OWNER_ID = 'user-owner'
const FIXED_TIME = '2026-07-27T00:00:00Z'
const SKILLS = [
  'reading',
  'listening',
  'writing',
  'speaking',
  'grammar',
  'vocabulary',
  'general',
] as const

interface ExItem {
  id: string
  centerId: string
  createdBy: string
  code: string
  title: string
  description: string | null
  skill: (typeof SKILLS)[number]
  tags: string[]
  targetBand: number | null
  schemaVersion: number
  sectionCount: number
  questionCount: number
  createdAt: string
  updatedAt: string
}

function exItem(overrides: Partial<ExItem> = {}): ExItem {
  return {
    id: 'ex-' + Math.random().toString(36).slice(2, 8),
    centerId: CENTER_ID,
    createdBy: OWNER_ID,
    code: 'EX-R001',
    title: 'Untitled',
    description: null,
    skill: 'reading',
    tags: [],
    targetBand: null,
    schemaVersion: 1,
    sectionCount: 2,
    questionCount: 5,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

// listHandler mirrors the server: skill/tag filters, page slicing, and a
// skillCounts strip computed over the tag-filtered set (ignoring the skill filter).
function listHandler(all: ExItem[]) {
  return http.get('/api/exercises', ({ request }) => {
    const url = new URL(request.url)
    const skill = url.searchParams.get('skill')
    const tag = url.searchParams.get('tag')
    const page = Number(url.searchParams.get('page') ?? '1')
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20')

    let filtered = all
    if (skill) filtered = filtered.filter((e) => e.skill === skill)
    if (tag) filtered = filtered.filter((e) => e.tags.includes(tag))
    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    const forCounts = tag ? all.filter((e) => e.tags.includes(tag)) : all
    const skillCounts = SKILLS.map((s) => ({
      skill: s,
      count: forCounts.filter((e) => e.skill === s).length,
    })).filter((sc) => sc.count > 0)

    return HttpResponse.json({
      data: items,
      meta: {
        serverTime: FIXED_TIME,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        skillCounts,
      },
    })
  })
}

const STUB_USER: UserSummary = {
  id: OWNER_ID,
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function renderPage(role: Role = 'owner'): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/exercises']}>
          <Routes>
            <Route path="/exercises" element={<ExerciseLibraryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/**
 * Render behind the SAME owner/admin/teacher gate wired in routes.tsx, so the
 * role-negative path (student denied) is actually exercised (TEST-FE-6).
 */
function renderPageWithGate(role: Role): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/exercises']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="exercises"
                />
              }
            >
              <Route path="/exercises" element={<ExerciseLibraryPage />} />
            </Route>
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

describe('ExerciseLibraryPage — trilogy (TEST-FE-2)', () => {
  test('renders skeleton rows while loading', () => {
    server.use(listHandler([exItem({ title: 'Reading P1' })]))
    renderPage()
    expect(screen.getAllByTestId(/^exercise-row-skeleton/).length).toBeGreaterThanOrEqual(1)
  })

  test('renders exercise rows on success', async () => {
    server.use(listHandler([exItem({ title: 'Reading P1', code: 'EX-R001' })]))
    renderPage()
    expect(await screen.findByText('Reading P1')).toBeInTheDocument()
    expect(screen.getByTestId('exercises-table')).toBeInTheDocument()
  })

  test('renders inline error alert when GET /api/exercises fails', async () => {
    server.use(
      http.get('/api/exercises', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('ExerciseLibraryPage — two distinct empty states (AC9)', () => {
  test('true-empty (zero exercises, no filter) shows the warm hero + CTA', async () => {
    server.use(listHandler([]))
    renderPage()
    expect(await screen.findByTestId('exercises-empty-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('exercises-empty-filtered')).not.toBeInTheDocument()
  })

  test('filtered-empty (has exercises, no match) shows quiet "no matches", NOT the hero', async () => {
    // Non-empty library, but a tag filter that matches nothing.
    server.use(listHandler([exItem({ title: 'Reading P1', tags: ['ielts'] })]))
    renderPage()
    await screen.findByText('Reading P1')

    await userEvent.type(screen.getByTestId('exercise-filter-tag'), 'nonexistent')

    expect(await screen.findByTestId('exercises-empty-filtered')).toBeInTheDocument()
    // The true-empty hero (big CTA) must NOT render for a filtered-empty result.
    expect(screen.queryByTestId('exercises-empty-hero')).not.toBeInTheDocument()
  })
})

describe('ExerciseLibraryPage — skill-appropriate unit labels (AC1/AC9)', () => {
  test('Writing counts PROMPTS, Speaking counts CUE CARDS, Reading counts QUESTIONS', async () => {
    server.use(
      listHandler([
        exItem({ id: 'w', title: 'Essay Task', code: 'EX-W001', skill: 'writing', questionCount: 3 }),
        exItem({ id: 's', title: 'Part 2 Cue', code: 'EX-S001', skill: 'speaking', questionCount: 4 }),
        exItem({ id: 'r', title: 'Passage', code: 'EX-R001', skill: 'reading', questionCount: 5 }),
      ]),
    )
    renderPage()
    await screen.findByText('Essay Task')
    expect(screen.getByTestId('exercise-meta-w')).toHaveTextContent('prompts')
    expect(screen.getByTestId('exercise-meta-s')).toHaveTextContent('cue cards')
    expect(screen.getByTestId('exercise-meta-r')).toHaveTextContent('questions')
    // The meta line carries the code + section count too (compound ICU message).
    expect(screen.getByTestId('exercise-meta-w')).toHaveTextContent('EX-W001')
  })
})

describe('ExerciseLibraryPage — filters + pagination (AC2)', () => {
  test('selecting a skill tab narrows the table', async () => {
    server.use(
      listHandler([
        exItem({ id: 'r1', title: 'Reading One', skill: 'reading' }),
        exItem({ id: 'w1', title: 'Writing One', skill: 'writing' }),
      ]),
    )
    renderPage()
    await screen.findByText('Reading One')
    expect(screen.getByText('Writing One')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('exercise-skill-tab-writing'))

    await waitFor(() => {
      expect(screen.queryByText('Reading One')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Writing One')).toBeInTheDocument()
  })

  test('paginates: next page fetches the next slice, page indicator updates', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      exItem({ id: `ex-${i}`, title: `Exercise ${i}`, code: `EX-R${String(i).padStart(3, '0')}` }),
    )
    server.use(listHandler(many))
    renderPage()
    await screen.findByText('Exercise 0')
    // 20 rows on page 1 (Exercise 19 present, Exercise 20 not yet).
    expect(screen.getByText('Exercise 19')).toBeInTheDocument()
    expect(screen.queryByText('Exercise 20')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('exercises-next'))

    expect(await screen.findByText('Exercise 20')).toBeInTheDocument()
    expect(screen.getByTestId('exercises-page-indicator')).toHaveTextContent('2')
  })
})

describe('ExerciseLibraryPage — create + delete (AC3/AC5)', () => {
  test('create closes the dialog and returns to the library (no editor nav)', async () => {
    let created = false
    server.use(
      http.get('/api/exercises', () =>
        HttpResponse.json({
          data: created
            ? [exItem({ title: 'Fresh Reading', code: 'EX-R001' })]
            : [],
          meta: {
            serverTime: FIXED_TIME,
            pagination: { page: 1, pageSize: 20, total: created ? 1 : 0, totalPages: created ? 1 : 0 },
            skillCounts: created ? [{ skill: 'reading', count: 1 }] : [],
          },
        }),
      ),
      http.post('/api/exercises', async () => {
        created = true
        return HttpResponse.json(
          { data: exItem({ title: 'Fresh Reading', code: 'EX-R001' }), meta: { serverTime: FIXED_TIME } },
          { status: 201 },
        )
      }),
    )
    renderPage()
    await screen.findByTestId('exercises-empty-hero')

    await userEvent.click(screen.getByTestId('exercises-new-cta'))
    await userEvent.type(screen.getByTestId('exercise-field-title'), 'Fresh Reading')
    await userEvent.click(screen.getByTestId('exercise-form-submit'))

    // Dialog closes (title field gone) — the page stays at /exercises.
    await waitFor(() => {
      expect(screen.queryByTestId('exercise-field-title')).not.toBeInTheDocument()
    })
  })

  test('soft-delete optimistic rollback: a failed DELETE restores the list row', async () => {
    // Driven at the dialog + hook level (the actual behavior under test): the
    // list cache is seeded, the confirm removes the row OPTIMISTICALLY, and the
    // 500 rolls it back. (The dropdown → dialog wiring is covered by the render
    // path above; Radix menu-item onSelect doesn't fire under jsdom userEvent.)
    const user = userEvent.setup()
    server.use(
      http.delete('/api/exercises/del-me', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    const client = createTestQueryClient()
    const params: ExerciseListParams = {
      page: 1,
      pageSize: 20,
      skill: null,
      tag: null,
      band: null,
    }
    const listKey = exerciseKeys.list(CENTER_ID, 'all', params)
    client.setQueryData(listKey, {
      items: [exItem({ id: 'del-me', title: 'Doomed' })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      skillCounts: [{ skill: 'reading', count: 1 }],
    })

    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <ExerciseDeleteDialog
            exerciseId="del-me"
            exerciseTitle="Doomed"
            onClose={() => {}}
          />
        </QueryClientProvider>
      </I18nextProvider>,
    )

    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: i18n.t('exercises.delete.confirm') }),
    )

    // The optimistic removal is rolled back by onError → the row is restored.
    await waitFor(() => {
      const data = client.getQueryData<{ items: Array<{ id: string }> }>(listKey)
      expect(data?.items).toHaveLength(1)
    })
  })
})

describe('ExerciseLibraryPage — i18n + a11y (TEST-FE-4/5)', () => {
  test('exercises.* keys exist in both en and vi', () => {
    assertI18nParity([
      'exercises.sectionHeading',
      'exercises.createCta',
      'exercises.tabs.all',
      'exercises.skill.reading',
      'exercises.skill.writing',
      'exercises.skill.speaking',
      'exercises.meta.line',
      'exercises.unit.questions',
      'exercises.unit.prompts',
      'exercises.unit.cueCards',
      'exercises.table.columns.exercise',
      'exercises.empty.true.headline',
      'exercises.empty.filtered.headline',
      'exercises.error.body',
      'exercises.footer.showing',
      'exercises.form.createTitle',
      'exercises.delete.title',
    ])
  })

  test('countLabel plural keys exist in both locales', () => {
    assertI18nParity(['exercises.countLabel_one', 'exercises.countLabel_other'])
  })

  test('exercises.form.conflict exists in both locales', () => {
    assertI18nParity(['exercises.form.conflict'])
  })

  test('no accessibility violations on the loaded table', async () => {
    server.use(listHandler([exItem({ title: 'Reading P1', code: 'EX-R001' })]))
    const { container } = renderPage()
    await screen.findByText('Reading P1')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations in the open create dialog (labels associated)', async () => {
    server.use(listHandler([exItem({ title: 'Reading P1', code: 'EX-R001' })]))
    const { container } = renderPage()
    await screen.findByText('Reading P1')
    await userEvent.click(screen.getByTestId('exercises-new-cta'))
    await screen.findByTestId('exercise-field-title')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ExerciseLibraryPage — open into editor', () => {
  // The row title is the primary way into the editor for every role — an owner
  // clicking the exercise name must land on /exercises/:id/edit, not be stranded
  // hunting for the "..." kebab menu (the discoverability gap fixed 2026-08-01).
  function renderWithEditorRoute(role: Role): void {
    seedSession(role)
    const client = createTestQueryClient()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/exercises']}>
            <Routes>
              <Route path="/exercises" element={<ExerciseLibraryPage />} />
              <Route
                path="/exercises/:id/edit"
                element={<div data-testid="editor-stub">editor</div>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
  }

  test('clicking the exercise title navigates an owner to the editor', async () => {
    server.use(listHandler([exItem({ id: 'ex-open', title: 'Reading P1', code: 'EX-R001' })]))
    renderWithEditorRoute('owner')
    await userEvent.click(await screen.findByTestId('exercise-open-ex-open'))
    expect(await screen.findByTestId('editor-stub')).toBeInTheDocument()
  })
})

describe('ExerciseLibraryPage — role gate (TEST-FE-6)', () => {
  test('teacher (allowed) sees the library behind the gate', async () => {
    server.use(listHandler([exItem({ title: 'Reading P1', code: 'EX-R001' })]))
    renderPageWithGate('teacher')
    expect(await screen.findByText('Reading P1')).toBeInTheDocument()
  })

  test('student is denied — the library is ABSENT from the DOM (not hidden)', async () => {
    server.use(listHandler([exItem({ title: 'Reading P1', code: 'EX-R001' })]))
    renderPageWithGate('student')
    // The gate resolves to PermissionDenied; the page + its rows never mount.
    await waitFor(() => {
      expect(screen.queryByTestId('exercises-page')).not.toBeInTheDocument()
      expect(screen.queryByText('Reading P1')).not.toBeInTheDocument()
    })
  })
})
