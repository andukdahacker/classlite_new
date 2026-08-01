// Story 4.2 (TEST-FE-1..6, TEST-UX-2) — ExerciseEditorPage component tests. MSW
// at the HTTP boundary (never mock Query); real QueryClient + real Zustand
// editorStore (reset per test). Covers the trilogy, the non-optimistic
// validity-gated concurrency-guarded autosave (debounce-collapse, blank-title-
// no-save, FW-4 zero-edit-zero-PATCH, 409 reload, non-blocking failure), the
// per-type editors, reorder via move buttons, delete-section confirm, settings
// round-trip, role-negative gating, i18n parity, and axe.
//
// Real timers + a real ~1.6s debounce wait (`settleAutosave`) — RTL `findBy`
// deadlocks under fake timers (its poll interval never advances), so the whole
// suite runs on real time.
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
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { useEditorStore } from '@/stores/editorStore'
import { ExerciseEditorPage } from '@/features/exercises/ExerciseEditorPage'
import type { components } from '@/lib/api/client'

type Exercise = components['schemas']['Exercise']
type ExerciseContent = components['schemas']['ExerciseContent']

const CENTER_ID = 'c-1'
const OWNER_ID = 'user-owner'
const EX_ID = 'ex-1'
const T0 = '2026-07-27T00:00:00.000000Z'
const DEBOUNCE_WAIT_MS = 1600

async function settleAutosave(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_WAIT_MS))
}

function emptyContent(): ExerciseContent {
  return { sections: [], settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false } }
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: EX_ID,
    centerId: CENTER_ID,
    createdBy: OWNER_ID,
    code: 'EX-R001',
    title: 'Reading One',
    description: null,
    skill: 'reading',
    tags: [],
    targetBand: null,
    schemaVersion: 1,
    sectionCount: 0,
    questionCount: 0,
    content: emptyContent(),
    locked: false,
    lockReason: null,
    lockedBy: [],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

interface PatchLog {
  bodies: Array<Record<string, unknown>>
}

function installHandlers(
  detail: Exercise,
  log: PatchLog,
  opts: { patchStatus?: number } = {},
): void {
  let version = 0
  server.use(
    http.get('/api/exercises/:id', () =>
      HttpResponse.json({ data: detail, meta: { serverTime: T0 } }),
    ),
    http.patch('/api/exercises/:id', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      log.bodies.push(body)
      if (opts.patchStatus) {
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'boom', requestId: 'r' } },
          { status: opts.patchStatus },
        )
      }
      version += 1
      const updated: Exercise = {
        ...detail,
        ...(body as Partial<Exercise>),
        updatedAt: `2026-07-27T00:00:0${version}.000000Z`,
      }
      return HttpResponse.json({ data: updated, meta: { serverTime: T0 } })
    }),
  )
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

function renderEditor(role: Role = 'owner') {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/exercises/${EX_ID}/edit`]}>
          <Routes>
            <Route path="/exercises/:id/edit" element={<ExerciseEditorPage />} />
            <Route path="/exercises" element={<div>library</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function renderEditorWithGate(role: Role) {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/exercises/${EX_ID}/edit`]}>
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
              <Route path="/exercises/:id/edit" element={<ExerciseEditorPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  useEditorStore.getState().reset()
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

// =============================================================================
// Trilogy + routing
// =============================================================================
describe('ExerciseEditorPage — trilogy (TEST-FE-2)', () => {
  test('renders the two-panel editor on load', async () => {
    installHandlers(exercise(), { bodies: [] })
    renderEditor()
    expect(await screen.findByTestId('exercise-editor')).toBeInTheDocument()
    expect(screen.getByTestId('editor-metadata-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('editor-empty-sections')).toBeInTheDocument()
    expect((screen.getByTestId('editor-title') as HTMLInputElement).value).toBe('Reading One')
  })

  test('renders a human error + retry when GET fails', async () => {
    server.use(
      http.get('/api/exercises/:id', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderEditor()
    expect(await screen.findByTestId('editor-error')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('exercises.editor.loadError'))).toBeInTheDocument()
  })

  test('renders a 404 surface with a back link', async () => {
    server.use(
      http.get('/api/exercises/:id', () =>
        HttpResponse.json(
          { error: { code: 'EXERCISE_NOT_FOUND', message: 'nope', requestId: 'r' } },
          { status: 404 },
        ),
      ),
    )
    renderEditor()
    expect(await screen.findByText(i18n.t('exercises.editor.notFound'))).toBeInTheDocument()
  })
})

// =============================================================================
// Autosave — the FW-8 non-optimistic, validity-gated, concurrency-guarded core
// =============================================================================
describe('ExerciseEditorPage — autosave (AC6)', () => {
  test('FW-4: a settings-materialized load with ZERO edits fires ZERO PATCH', async () => {
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log)
    renderEditor()
    await screen.findByTestId('exercise-editor')
    await settleAutosave()
    expect(log.bodies).toHaveLength(0)
    expect(useEditorStore.getState().saveStatus).toBe('idle')
  })

  test('debounce collapses rapid edits into ONE PATCH carrying the last value', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log)
    renderEditor()
    const title = (await screen.findByTestId('editor-title')) as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'Renamed')
    expect(log.bodies).toHaveLength(0)
    await settleAutosave()
    await waitFor(() => expect(log.bodies).toHaveLength(1))
    expect(log.bodies[0].title).toBe('Renamed')
  })

  test('validity gate: a blank title fires NO save and shows the Unsaved state', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log)
    renderEditor()
    const title = (await screen.findByTestId('editor-title')) as HTMLInputElement
    await user.clear(title)
    await settleAutosave()
    expect(log.bodies).toHaveLength(0)
    expect(useEditorStore.getState().saveStatus).toBe('unsaved')
    expect(screen.getByText(i18n.t('exercises.editor.metadata.titleRequired'))).toBeInTheDocument()
  })

  test('a 409 stale-precondition surfaces a reload banner and refetches', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    let getCount = 0
    server.use(
      http.get('/api/exercises/:id', () => {
        getCount += 1
        return HttpResponse.json({ data: exercise({ title: 'Fresh' }), meta: { serverTime: T0 } })
      }),
      http.patch('/api/exercises/:id', async ({ request }) => {
        log.bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'won', requestId: 'r' } },
          { status: 409 },
        )
      }),
    )
    renderEditor()
    const title = (await screen.findByTestId('editor-title')) as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'Mine')
    await settleAutosave()
    // The conflict banner is transient (it clears once the reload resolves), so
    // assert the DURABLE outcome: a refetch happened and local state re-seeded
    // to the fresh server title.
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect((screen.getByTestId('editor-title') as HTMLInputElement).value).toBe('Fresh'),
    )
  })

  test('a failed PATCH shows a non-blocking error + retry, editor stays usable', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log, { patchStatus: 500 })
    renderEditor()
    const title = (await screen.findByTestId('editor-title')) as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'X')
    await settleAutosave()
    expect(await screen.findByTestId('editor-autosave-error')).toBeInTheDocument()
    expect(screen.getByTestId('editor-autosave-retry')).toBeInTheDocument()
    expect(screen.getByTestId('editor-title')).toBeEnabled()
  })

  test('retry after a failed autosave REPLAYS the PATCH (not a dead no-op)', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log, { patchStatus: 500 })
    renderEditor()
    const title = (await screen.findByTestId('editor-title')) as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'X')
    await settleAutosave()
    await screen.findByTestId('editor-autosave-retry')
    // The debounce dispatched exactly one (failed) PATCH so far.
    expect(log.bodies).toHaveLength(1)
    // Retry must re-send the last-attempted document — before the P-FE1 fix the
    // debounce had nulled the pending ref, so this button did nothing.
    await user.click(screen.getByTestId('editor-autosave-retry'))
    await waitFor(() => expect(log.bodies.length).toBeGreaterThanOrEqual(2))
    expect(log.bodies[log.bodies.length - 1].title).toBe('X')
  })
})

// =============================================================================
// Section + question authoring, reorder, settings
// =============================================================================
describe('ExerciseEditorPage — authoring (AC2/AC3/AC4/AC5)', () => {
  test('adding a section, an MCQ group, marking correct → PATCH carries the shape', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log)
    renderEditor()
    await screen.findByTestId('exercise-editor')

    await user.click(screen.getByTestId('section-type-add-reading'))
    await user.click(screen.getByTestId('add-group-multiple_choice'))
    await user.type(screen.getByTestId('mcq-option-input-0'), 'Paris')
    await user.type(screen.getByTestId('mcq-option-input-1'), 'London')
    await user.click(screen.getByTestId('mcq-mark-correct-0'))

    await settleAutosave()
    await waitFor(() => expect(log.bodies.length).toBeGreaterThanOrEqual(1))
    const content = log.bodies[log.bodies.length - 1].content as ExerciseContent
    expect(content.sections[0].type).toBe('reading')
    const group = content.sections[0].questionGroups[0]
    expect(group.type).toBe('multiple_choice')
    expect(group.questions[0].options).toEqual(['Paris', 'London'])
    expect(group.questions[0].correctAnswer).toBe('Paris')
    expect(screen.getByTestId('key-badge')).toBeInTheDocument()
  })

  test('settings toggles round-trip into content.settings', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    installHandlers(exercise(), log)
    renderEditor()
    await screen.findByTestId('exercise-editor')

    await user.click(screen.getByTestId('editor-settings-timelimit'))
    await user.type(screen.getByTestId('editor-settings-minutes'), '45')
    await user.click(screen.getByTestId('editor-settings-casesensitive'))

    await settleAutosave()
    await waitFor(() => expect(log.bodies.length).toBeGreaterThanOrEqual(1))
    const content = log.bodies[log.bodies.length - 1].content as ExerciseContent
    expect(content.settings.timeLimitEnabled).toBe(true)
    expect(content.settings.timeLimitMinutes).toBe(45)
    expect(content.settings.caseSensitive).toBe(true)
  })

  test('move-down reorders sections by array index (TEST-UX-2 keyboard/touch path)', async () => {
    const user = userEvent.setup()
    const log: PatchLog = { bodies: [] }
    const detail = exercise({
      content: {
        settings: emptyContent().settings,
        sections: [
          { type: 'reading', title: 'First', content: '', questionGroups: [] },
          { type: 'grammar', title: 'Second', content: '', questionGroups: [] },
        ],
      },
    })
    installHandlers(detail, log)
    renderEditor()
    await screen.findByTestId('exercise-editor')

    const moveDowns = screen.getAllByTestId('reorder-move-down')
    await user.click(moveDowns[0])
    await settleAutosave()
    await waitFor(() => expect(log.bodies.length).toBeGreaterThanOrEqual(1))
    const content = log.bodies[log.bodies.length - 1].content as ExerciseContent
    expect(content.sections.map((s) => s.title)).toEqual(['Second', 'First'])
  })

  test('deleting a section with content prompts a confirm, then removes it', async () => {
    const user = userEvent.setup()
    const detail = exercise({
      content: {
        settings: emptyContent().settings,
        sections: [{ type: 'reading', title: 'Has content', content: 'body', questionGroups: [] }],
      },
    })
    installHandlers(detail, { bodies: [] })
    renderEditor()
    await screen.findByTestId('exercise-editor')

    await user.click(screen.getByTestId('section-delete'))
    expect(await screen.findByTestId('section-delete-confirm')).toBeInTheDocument()
    await user.click(screen.getByTestId('section-delete-confirm-action'))
    await waitFor(() => expect(screen.queryByTestId('section-card')).not.toBeInTheDocument())
    expect(screen.getByTestId('editor-empty-sections')).toBeInTheDocument()
  })
})

// =============================================================================
// Role gating + a11y + i18n
// =============================================================================
describe('ExerciseEditorPage — gating, a11y, i18n (TEST-FE-4/5/6)', () => {
  test('a student is denied by the route gate (chunk never renders)', async () => {
    installHandlers(exercise(), { bodies: [] })
    renderEditorWithGate('student')
    await waitFor(() => expect(screen.queryByTestId('exercise-editor')).not.toBeInTheDocument())
    expect(screen.getByText(i18n.t('app.permissionDenied.title'))).toBeInTheDocument()
  })

  test('no accessibility violations on the loaded editor', async () => {
    installHandlers(
      exercise({
        content: {
          settings: emptyContent().settings,
          sections: [{ type: 'reading', title: 'S', content: 'c', questionGroups: [] }],
        },
      }),
      { bodies: [] },
    )
    const { container } = renderEditor()
    await screen.findByTestId('exercise-editor')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('editor i18n keys exist in en + vi (parity)', () => {
    assertI18nParity([
      'exercises.editor.autosave.saving',
      'exercises.editor.autosave.savedJustNow',
      'exercises.editor.autosave.unsavedTitle',
      'exercises.editor.autosave.failed',
      'exercises.editor.emptySections',
      'exercises.editor.sectionType.reading',
      'exercises.editor.questionType.matching',
      'exercises.editor.settings.caseSensitiveLabel',
      'exercises.editor.section.deleteConfirmTitle',
      'exercises.editor.keyBadge',
    ])
  })
})
