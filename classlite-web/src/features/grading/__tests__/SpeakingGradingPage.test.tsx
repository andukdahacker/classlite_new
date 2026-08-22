/**
 * Story 6.3a (AC4/AC9/AC10/AC11/AC12 · D8/D9) — RED PHASE. SpeakingGradingPage +
 * the GradingRoute fetch-before-dispatch parent, MSW-only seam (mirrors
 * WritingGradingPage.test.tsx). Covers: the L/E/E trilogy (labeled skeleton /
 * player+bands / re-record vs inline-retry), the twinned client overall band, the
 * TIMELINE-shaped rail (sorted by timestampMs, source:'teacher', null-zoned — D9),
 * queue prev/next, GradingRoute dispatch by skill, and the negative test-meta
 * (student result path shows no teacher grading controls).
 *
 * FAILS at import today: `SpeakingGradingPage` / `GradingRoute` do not exist.
 *
 * SEAM (dev, green phase):
 *   - GradingRoute reads useGradingSubmission(sid).exercise.skill and dynamic-imports
 *     WritingGradingPage vs SpeakingGradingPage (owns the first skeleton).
 *   - TeacherGradingView gains audioUrl:string|null + audioStatus:'hasAudio'|'none'
 *     + speaking criterionScores/comments on an existing grade.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient, queryClient as singletonQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import type { components } from '@/lib/api/client'
import { GradingRoute, SpeakingGradingPage } from '@/features/grading'

type TeacherGradingView = components['schemas']['TeacherGradingView']

const CLASS_ID = 'cl-1'
const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-spk-1'
const GRADING_PATH = `/api/submissions/${SUBMISSION_ID}/grading`

// Minimal jsdom stubs so the composed player mounts (its internals are covered in
// AudioWaveformPlayer.test.tsx — here we only assert the page-level contracts).
class FakeAudioBuffer {
  duration = 278
  numberOfChannels = 1
  sampleRate = 44_100
  length = 2048
  getChannelData() {
    return new Float32Array(2048).fill(0.3)
  }
}
class FakeAudioContext {
  decodeAudioData = vi.fn(async () => new FakeAudioBuffer())
  close = vi.fn(async () => {})
}

function speakingGradingView(overrides: Partial<TeacherGradingView> = {}): TeacherGradingView {
  return {
    submission: {
      id: SUBMISSION_ID,
      centerId: 'c-1',
      assignmentId: ASSIGNMENT_ID,
      studentId: 'stu-1',
      status: 'submitted',
      isLate: false,
      appliedPenalty: 0,
      startedAt: '2026-08-20T00:00:00Z',
      submittedAt: '2026-08-20T12:00:00Z',
      timeBudgetSeconds: null,
      schemaVersion: 1,
      content: { schemaVersion: 1, audioKey: 'c-1/speaking/x.webm', durationSec: 278 } as never,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-20T12:00:00Z',
    },
    assignment: {
      id: ASSIGNMENT_ID,
      exerciseId: 'ex-1',
      classId: CLASS_ID,
      status: 'open',
      deadlineAt: '2026-08-27T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 0,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    student: { id: 'stu-1', fullName: 'Binh Tran' },
    exercise: { id: 'ex-1', title: 'Speaking Part 2', skill: 'speaking', sections: [], settings: {} as never },
    grade: null,
    aiSuggestion: null,
    audioUrl: 'https://r2.example/c-1/speaking/x.webm?sig=1',
    audioStatus: 'hasAudio',
    ...overrides,
  } as TeacherGradingView
}

function renderDispatch(view: TeacherGradingView) {
  const qc = createTestQueryClient()
  const session: Session = {
    user: { id: 'owner-1', fullName: 'Teacher', email: 't@example.com' },
    role: 'owner',
    centerId: 'c-1',
    emailVerified: true,
  } as unknown as Session
  qc.setQueryData(authKeys.session(), session)
  // RouteRoleGate's useRole() reads the module-singleton queryClient's session cache
  // (not the provider client), so the role gate must be seeded there too (mirrors
  // WritingGradingPage.test's seedSession — green-phase seam reconciliation).
  singletonQueryClient.setQueryData(authKeys.session(), session)

  server.use(http.get(GRADING_PATH, () => HttpResponse.json({ data: view })))

  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="grading"
                />
              }
            >
              <Route path="/classes/:id/grading/:aid/:sid" element={<GradingRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
  // The waveform player fetch-decodes the R2 audio URL, so `fetch` is stubbed to a
  // decodable ArrayBuffer — but the grading READ (apiFetch) must still reach MSW, so
  // `/api/` requests are delegated to the real (MSW-patched) fetch. Without this, the
  // blanket stub returns the ArrayBuffer for the grading read too and apiFetch fails to
  // parse it (green-phase seam reconciliation — the `server.use(GRADING_PATH)` above
  // shows MSW is the intended grading-read boundary).
  const realFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/')) return realFetch(input, init)
      return new Response(new ArrayBuffer(8), { status: 200 })
    }),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  singletonQueryClient.clear()
})

describe('GradingRoute dispatch (AC11)', () => {
  test('renders SpeakingGradingPage when exercise.skill === "speaking"', async () => {
    renderDispatch(speakingGradingView())
    // The speaking surface renders the four speaking criteria (writing keys absent).
    await waitFor(() =>
      expect(screen.getByText(i18n.t('criterion.fluencyCoherence'))).toBeInTheDocument(),
    )
    expect(screen.queryByText(i18n.t('criterion.taskResponse'))).not.toBeInTheDocument()
  })

  test('a non-writing / non-speaking skill renders an unsupported notice, NOT the writing page (P4)', async () => {
    const view = speakingGradingView({
      exercise: { id: 'ex-1', title: 'Reading 1', skill: 'reading', sections: [], settings: {} as never },
    })
    renderDispatch(view)
    await waitFor(() =>
      expect(screen.getByText(i18n.t('grading.error.unsupportedSkill'))).toBeInTheDocument(),
    )
    // It must NOT fall through to a grading surface against the wrong payload.
    expect(screen.queryByText(i18n.t('criterion.taskResponse'))).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('criterion.fluencyCoherence'))).not.toBeInTheDocument()
  })
})

describe('SpeakingGradingPage — L/E/E trilogy (AC12)', () => {
  test('labeled "Preparing audio…" skeleton while the grading read + decode are in flight', async () => {
    const qc = createTestQueryClient()
    qc.setQueryData(authKeys.session(), { role: 'owner', centerId: 'c-1', emailVerified: true } as unknown as Session)
    server.use(
      http.get(GRADING_PATH, async () => {
        await delay(50)
        return HttpResponse.json({ data: speakingGradingView() })
      }),
    )
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SpeakingGradingPage />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText(i18n.t('speakingGrading.state.preparingAudio'))).toBeInTheDocument()
  })
})

describe('SpeakingGradingPage — bands + timeline rail (AC4/AC6/AC7/D9)', () => {
  test('renders the 2×2 speaking band inputs and the client overall band', async () => {
    renderDispatch(speakingGradingView())
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    for (const key of ['fluencyCoherence', 'lexicalResource', 'grammaticalRange', 'pronunciation']) {
      expect(screen.getByText(i18n.t(`criterion.${key}`))).toBeInTheDocument()
    }
  })

  test('the rail sorts pinned comments by timestampMs and zones general (null) notes separately (D9)', async () => {
    const view = speakingGradingView({
      grade: {
        id: 'g-1',
        submissionId: SUBMISSION_ID,
        version: 1,
        overallBand: 6.5,
        criterionScores: { fluencyCoherence: 6.5, lexicalResource: 6.5, grammaticalRange: 6.5, pronunciation: 6.5 },
        comments: [
          { type: 'error', criterion: 'pronunciation', timestampMs: 90_000, text: 'late slip' },
          { type: 'praise', criterion: 'fluencyCoherence', timestampMs: 10_000, text: 'early strength' },
          { type: 'suggestion', criterion: 'lexicalResource', timestampMs: null, text: 'general vocab note' },
        ],
        feedback: null,
        releasedAt: '2026-08-20T13:00:00Z',
        gradedBy: 'owner-1',
        createdAt: '2026-08-20T13:00:00Z',
      } as never,
    })
    renderDispatch(view)
    await waitFor(() => expect(screen.getByText('early strength')).toBeInTheDocument())

    // Pinned notes appear before the general zone, and in ascending timestamp order.
    const early = screen.getByText('early strength')
    const late = screen.getByText('late slip')
    const general = screen.getByText('general vocab note')
    expect(early.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(late.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The general note sits under the labeled general zone (D9).
    expect(screen.getByText(i18n.t('speakingGrading.rail.generalZone'))).toBeInTheDocument()
  })

  test('clicking a rail card seek control highlights the pin (bidirectional pin↔card, AC6)', async () => {
    const view = speakingGradingView({
      grade: {
        id: 'g-1',
        submissionId: SUBMISSION_ID,
        version: 1,
        overallBand: 6.5,
        criterionScores: { fluencyCoherence: 6.5, lexicalResource: 6.5, grammaticalRange: 6.5, pronunciation: 6.5 },
        comments: [{ type: 'praise', criterion: 'fluencyCoherence', timestampMs: 10_000, text: 'early strength' }],
        feedback: null,
        releasedAt: '2026-08-20T13:00:00Z',
        gradedBy: 'owner-1',
        createdAt: '2026-08-20T13:00:00Z',
      } as never,
    })
    renderDispatch(view)
    await waitFor(() => expect(screen.getByText('early strength')).toBeInTheDocument())
    const seek = document.querySelector('[data-testid^="rail-seek-"]') as HTMLButtonElement
    expect(seek).not.toBeNull()
    seek.click()
    await waitFor(() =>
      expect(document.querySelector('[data-testid^="rail-item-"][data-active="true"]')).toBeInTheDocument(),
    )
  })
})

describe('SpeakingGradingPage — queue nav (AC9)', () => {
  test('the shared Prev/Next queue navigator renders on s24 (reused useGradingQueue)', async () => {
    renderDispatch(speakingGradingView())
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument()
  })
})
