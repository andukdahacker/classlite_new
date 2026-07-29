// Story 4.3b T4 — editor integration: the accept path merges the generated
// fragment into the working doc and persists it via 4.2's autosave (no new write
// path). Asserts the two load-bearing behaviours: Accept → exactly ONE PATCH
// carrying the merged content; Dismiss → ZERO PATCH. Fake timers drive BOTH the
// job poll and the 1.5s autosave debounce; direct assertions (no findBy).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { useEditorStore } from '@/stores/editorStore'
import { ExerciseEditorPage } from '@/features/exercises/ExerciseEditorPage'
import type { components } from '@/lib/api/client'

type Exercise = components['schemas']['Exercise']
type ExerciseContent = components['schemas']['ExerciseContent']
type Job = components['schemas']['Job']

const CENTER_ID = 'c-1'
const OWNER_ID = 'user-owner'
const EX_ID = 'ex-1'
const JOB_ID = 'job-1'
const T0 = '2026-07-29T00:00:00.000000Z'

function contentWithOneSection(): ExerciseContent {
  return {
    sections: [{ type: 'reading', title: 'S0', content: 'passage', questionGroups: [] }],
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
  }
}

function exercise(): Exercise {
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
    sectionCount: 1,
    questionCount: 0,
    content: contentWithOneSection(),
    createdAt: T0,
    updatedAt: T0,
  }
}

function questionsFragment(): ExerciseContent {
  return {
    sections: [
      {
        type: 'reading',
        title: 'Generated questions',
        content: '',
        questionGroups: [
          { type: 'multiple_choice', instructions: 'Choose one.', questions: [] },
          { type: 'short_answer', instructions: 'Answer briefly.', questions: [] },
        ],
      },
    ],
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
  }
}

interface PatchLog {
  bodies: Array<Record<string, unknown>>
}

function installHandlers(log: PatchLog) {
  server.use(
    http.get('/api/exercises/:id', () =>
      HttpResponse.json({ data: exercise(), meta: { serverTime: T0 } }),
    ),
    http.patch('/api/exercises/:id', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      log.bodies.push(body)
      return HttpResponse.json({
        data: { ...exercise(), ...(body as Partial<Exercise>), updatedAt: '2026-07-29T00:00:01.000000Z' },
        meta: { serverTime: T0 },
      })
    }),
    http.post('/api/exercises/:id/ai-generate', () =>
      HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: T0 } }, { status: 202 }),
    ),
    http.get('/api/jobs/:jobId', () => {
      const complete: Job = {
        id: JOB_ID,
        type: 'ai_generate_questions',
        status: 'complete',
        result: questionsFragment(),
        errorDetails: null,
        createdAt: T0,
        startedAt: T0,
        completedAt: T0,
      }
      return HttpResponse.json({ data: complete, meta: { serverTime: T0 } })
    }),
  )
}

const STUB_USER: UserSummary = {
  id: OWNER_ID,
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
}

function seedSession(client: QueryClient, role: Role): void {
  client.setQueryData<Session>(authKeys.session(), {
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

function renderEditor() {
  const client = createTestQueryClient()
  seedSession(client, 'owner')
  render(
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

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  useEditorStore.getState().reset()
})
afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  vi.useRealTimers()
  server.resetHandlers()
})

const AUTOSAVE_DEBOUNCE_MS = 1600

describe('AIGenerateDialog editor integration (AC3)', () => {
  test('Accept merges the generated groups + fires exactly one autosave PATCH', async () => {
    const log: PatchLog = { bodies: [] }
    installHandlers(log)
    renderEditor()
    await tick(10) // settle the GET
    expect(screen.getByTestId('exercise-editor')).toBeInTheDocument()

    // Open the questions dialog for section 0, generate, and accept.
    fireEvent.click(screen.getByTestId('generate-questions'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-generate-submit'))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByTestId('ai-generation-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-preview-accept'))

    // Let the autosave debounce elapse.
    await tick(AUTOSAVE_DEBOUNCE_MS)

    expect(log.bodies).toHaveLength(1)
    const content = log.bodies[0].content as ExerciseContent
    expect(content.sections[0].questionGroups).toHaveLength(2)
    expect(content.sections[0].questionGroups[0].type).toBe('multiple_choice')
  })

  test('Dismiss inserts nothing — zero PATCH', async () => {
    const log: PatchLog = { bodies: [] }
    installHandlers(log)
    renderEditor()
    await tick(10)

    fireEvent.click(screen.getByTestId('generate-questions'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-generate-submit'))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByTestId('ai-generation-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-preview-dismiss'))

    await tick(AUTOSAVE_DEBOUNCE_MS)
    expect(log.bodies).toHaveLength(0)
    // Dialog closed.
    expect(screen.queryByTestId('ai-generate-dialog')).not.toBeInTheDocument()
  })
})
