/**
 * Story 6.3c (T5, T7) — SpeakingGradingPage AI integration. The COMBINED harness (SD5):
 * the 6-3a waveform jsdom stubs (AudioContext / canvas getContext / media) PLUS the
 * ai-grade MSW seam (POST /ai-grade + GET /jobs + POST /grade) — no shipped file combined
 * both, so it is built here once. MSW at the HTTP boundary (TEST-FE-1); real QueryClient.
 *
 * Covers: NO auto-enqueue on mount (AC1); Run → confirm → single POST (AC1); rehydrate the
 * class-shared `aiSpeakingSuggestion` with interleaved moments (AC6/AC12); a non-triggering
 * reader NEVER polls the creator-private job (AC13); merged waveform markers with distinct
 * `data-source` (AC7); Accept band → draft.scores → "Applied" (AC5); Accept moment → draft
 * comment (AC6); and the MANDATORY AC9 wire-strip — an accepted AI moment reaches the grade
 * write with NO source/confidence/rationale (teacher-only dropped at the boundary).
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'
import { SpeakingGradingPage } from '@/features/grading'

type TeacherGradingView = components['schemas']['TeacherGradingView']
type AISpeakingGradeResult = components['schemas']['AISpeakingGradeResult']

const CLASS_ID = 'cl-1'
const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-spk-1'
const JOB_ID = 'job-spk-1'
const GRADING_PATH = `/api/submissions/${SUBMISSION_ID}/grading`
const AI_GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/ai-grade`
const GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/grade`
const QUEUE_PATH = `/api/classes/${CLASS_ID}/grading-queue`

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

function speakingSuggestion(overrides: Partial<AISpeakingGradeResult> = {}): AISpeakingGradeResult {
  const criterion = (band: number, confidence: 'high' | 'medium' = 'high') => ({
    band,
    rationale: `rationale ${band}`,
    confidence,
  })
  return {
    criteria: {
      fluencyCoherence: criterion(6.5),
      lexicalResource: criterion(6, 'medium'),
      grammaticalRange: criterion(7),
      pronunciation: criterion(6.5, 'medium'),
    },
    moments: [
      { type: 'praise', criterion: 'pronunciation', timestampMs: 4200, text: 'Clear /θ/ sound.', confidence: 'high' },
      { type: 'error', criterion: 'grammaticalRange', timestampMs: null, text: 'Tense slip.', confidence: 'medium' },
    ],
    transcript: 'Well, I think the most important thing…',
    transcriptionStatus: 'available',
    overallFeedback: 'Confident delivery.',
    analyzedDurationMs: 92_000,
    latencyMs: 1800,
    ...overrides,
  }
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
    aiSpeakingSuggestion: null,
    audioUrl: 'https://r2.example/c-1/speaking/x.webm?sig=1',
    audioStatus: 'hasAudio',
    ...overrides,
  } as TeacherGradingView
}

/** Installs the ai-grade seam. Counts POST /ai-grade + GET /jobs; captures the grade body. */
function installSeam(view: TeacherGradingView) {
  let enqueues = 0
  let jobPolls = 0
  let gradeBody: unknown = null
  server.use(
    http.get(GRADING_PATH, () => HttpResponse.json({ data: view })),
    http.get(QUEUE_PATH, () => HttpResponse.json({ data: [] })),
    http.post(AI_GRADE_PATH, () => {
      enqueues += 1
      return HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 })
    }),
    http.get('/api/jobs/:jobId', () => {
      jobPolls += 1
      return HttpResponse.json({
        data: {
          id: JOB_ID,
          type: 'ai_grade_speaking',
          status: 'pending',
          result: null,
          errorDetails: null,
          createdAt: '2026-08-20T00:00:00.000000Z',
          startedAt: null,
          completedAt: null,
        },
        meta: { serverTime: 't' },
      })
    }),
    http.post(GRADE_PATH, async ({ request }) => {
      gradeBody = await request.json()
      return HttpResponse.json({ data: { ...view, grade: { version: 1 } } })
    }),
  )
  return { enqueues: () => enqueues, jobPolls: () => jobPolls, gradeBody: () => gradeBody }
}

/** Live seam: POST /ai-grade → 202, then GET /jobs returns a COMPLETE job whose result is
 * chosen by the current run number (1-based) — so a re-run can return a DIFFERENT moment set.
 * The first poll fires immediately on enable, so `phase` reaches `ready` without a backoff wait. */
function installLiveSeam(view: TeacherGradingView, resultForRun: (run: number) => AISpeakingGradeResult) {
  let run = 0
  server.use(
    http.get(GRADING_PATH, () => HttpResponse.json({ data: view })),
    http.get(QUEUE_PATH, () => HttpResponse.json({ data: [] })),
    http.post(AI_GRADE_PATH, () => {
      run += 1
      return HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 })
    }),
    http.get('/api/jobs/:jobId', () =>
      HttpResponse.json({
        data: {
          id: JOB_ID,
          type: 'ai_grade_speaking',
          status: 'complete',
          result: resultForRun(run),
          errorDetails: null,
          createdAt: '2026-08-20T00:00:00.000000Z',
          startedAt: '2026-08-20T00:00:01.000000Z',
          completedAt: '2026-08-20T00:00:03.000000Z',
        },
        meta: { serverTime: 't' },
      }),
    ),
    http.post(GRADE_PATH, async ({ request }) => {
      await request.json()
      return HttpResponse.json({ data: { ...view, grade: { version: 1 } } })
    }),
  )
  return { run: () => run }
}

function renderPage() {
  const qc = createTestQueryClient()
  qc.setQueryData(authKeys.session(), {
    user: { id: 'owner-1', fullName: 'Teacher', email: 't@example.com' },
    role: 'owner',
    centerId: 'c-1',
    emailVerified: true,
  } as unknown as Session)
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
          <Routes>
            <Route path="/classes/:id/grading/:aid/:sid" element={<SpeakingGradingPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The durable-draft + persisted-jobId both live in localStorage per submission — clear it
  // so an enqueue in one test can't leak a phantom in-flight job (or draft) into the next.
  localStorage.clear()
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
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
})

describe('SpeakingGradingPage AI — enqueue gate (AC1)', () => {
  test('does NOT auto-enqueue on mount — the panel is idle until the teacher confirms', async () => {
    const seam = installSeam(speakingGradingView())
    renderPage()
    await screen.findByTestId('ai-speaking-run')
    // Give any errant effect a tick to fire.
    await new Promise((r) => setTimeout(r, 20))
    expect(seam.enqueues()).toBe(0)
    expect(seam.jobPolls()).toBe(0)
  })

  test('Run → confirm → exactly one POST /ai-grade', async () => {
    const user = userEvent.setup()
    const seam = installSeam(speakingGradingView())
    renderPage()
    await user.click(await screen.findByTestId('ai-speaking-run'))
    await user.click(await screen.findByTestId('ai-grade-confirm-run'))
    await waitFor(() => expect(seam.enqueues()).toBe(1))
  })
})

describe('SpeakingGradingPage AI — rehydrate + interleave + non-triggering reader (AC6/AC12/AC13)', () => {
  test('a class-shared aiSpeakingSuggestion rehydrates: moments interleave in the rail (null-ts → general), and NO job poll fires', async () => {
    const seam = installSeam(speakingGradingView({ aiSpeakingSuggestion: speakingSuggestion() }))
    renderPage()
    // The pinned moment (index 0) renders inline in the rail with a seek button.
    await screen.findByTestId('ai-moment-ai-m-0')
    expect(screen.getByTestId('ai-moment-ai-m-0-seek')).toBeInTheDocument()
    // The null-timestamp moment (index 1) lands in the general zone, never dropped.
    const general = screen.getByTestId('speaking-grading-general-zone')
    expect(within(general).getByTestId('ai-moment-ai-m-1')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-moment-ai-m-1-seek')).not.toBeInTheDocument()
    // Teacher-only confidence + rationale render in the band strip.
    expect(screen.getByTestId('ai-speaking-band-fluencyCoherence-rationale')).toBeInTheDocument()
    // AC13 — a rehydrated (non-triggering) read NEVER polls the creator-private job.
    await new Promise((r) => setTimeout(r, 20))
    expect(seam.jobPolls()).toBe(0)
  })

  test('merged waveform markers: an AI moment marker is present and distinctly sourced (AC7)', async () => {
    installSeam(speakingGradingView({ aiSpeakingSuggestion: speakingSuggestion() }))
    renderPage()
    const marker = await screen.findByTestId('waveform-pin-ai-m-0')
    expect(marker).toHaveAttribute('data-source', 'ai')
  })
})

describe('SpeakingGradingPage AI — accept into the draft (AC5/AC6)', () => {
  test('Accept band → the criterion is written to draft.scores (renders "Applied")', async () => {
    const user = userEvent.setup()
    installSeam(speakingGradingView({ aiSpeakingSuggestion: speakingSuggestion() }))
    renderPage()
    await user.click(await screen.findByTestId('ai-speaking-band-fluencyCoherence-accept'))
    await screen.findByTestId('ai-speaking-band-fluencyCoherence-applied')
  })

  test('Accept moment → it leaves the AI proposals and becomes a draft comment in the rail', async () => {
    const user = userEvent.setup()
    installSeam(speakingGradingView({ aiSpeakingSuggestion: speakingSuggestion() }))
    renderPage()
    await user.click(await screen.findByTestId('ai-moment-ai-m-0-accept'))
    // The un-accepted AI card is gone; the text survives as a teacher-style draft comment.
    await waitFor(() => expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument())
    expect(screen.getByText('Clear /θ/ sound.')).toBeInTheDocument()
  })
})

describe('SpeakingGradingPage AI — review-gate on the ready edge (AC15, review-fix)', () => {
  test('a completion while the draft is dirty gates the band strip AND the interleaved moments + pins behind the Review overlay', async () => {
    const user = userEvent.setup()
    installLiveSeam(speakingGradingView(), () => speakingSuggestion())
    renderPage()

    // Dirty the draft THIS session so the ready overlay is armed (AC15 is "session-edited",
    // not "has content").
    await user.type(await screen.findByTestId('speaking-band-fluencyCoherence'), '7')

    // Run AI → the immediate poll completes → ready-while-dirty raises the overlay.
    await user.click(screen.getByTestId('ai-speaking-run'))
    await user.click(await screen.findByTestId('ai-grade-confirm-run'))

    await screen.findByTestId('ai-speaking-ready-overlay')
    // Gated: neither the band strip, the interleaved moment card, nor its waveform pin appear.
    expect(screen.queryByTestId('ai-speaking-band-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('waveform-pin-ai-m-0')).not.toBeInTheDocument()

    // Opt in → band strip + moments + pins reveal together.
    await user.click(screen.getByTestId('ai-speaking-review'))
    await screen.findByTestId('ai-speaking-band-strip')
    expect(screen.getByTestId('ai-moment-ai-m-0')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-pin-ai-m-0')).toBeInTheDocument()
  })
})

describe('SpeakingGradingPage AI — re-run does not hide new moments (review-fix)', () => {
  test('after accepting a moment then re-running, the new run\'s moment at the same positional id is shown (acceptedMoments reset)', async () => {
    const user = userEvent.setup()
    const run1 = speakingSuggestion({
      moments: [{ type: 'praise', criterion: 'pronunciation', timestampMs: 4200, text: 'Clear /θ/ sound.', confidence: 'high' }],
    })
    const run2 = speakingSuggestion({
      moments: [{ type: 'error', criterion: 'grammaticalRange', timestampMs: 8000, text: 'Second-run point.', confidence: 'medium' }],
    })
    installLiveSeam(speakingGradingView(), (run) => (run >= 2 ? run2 : run1))
    renderPage()

    // Run 1 → complete (draft is clean, so no overlay) → the moment shows; accept it.
    await user.click(await screen.findByTestId('ai-speaking-run'))
    await user.click(await screen.findByTestId('ai-grade-confirm-run'))
    await user.click(await screen.findByTestId('ai-moment-ai-m-0-accept'))
    await waitFor(() => expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument())

    // Re-run → complete. The draft is now dirty (the accept), so Review to reveal.
    await user.click(screen.getByTestId('ai-speaking-run'))
    await user.click(await screen.findByTestId('ai-grade-confirm-run'))
    await user.click(await screen.findByTestId('ai-speaking-review'))

    // The new run's moment reuses id `ai-m-0`; before the fix a stale `acceptedMoments` entry
    // would have filtered it out. It must now render with its NEW text.
    const newMoment = await screen.findByTestId('ai-moment-ai-m-0')
    expect(within(newMoment).getByText('Second-run point.')).toBeInTheDocument()
  })
})

describe('SpeakingGradingPage AI — moment actions at the page level (AC6/AC8, TA)', () => {
  test('Accept all praise: every un-accepted praise moment merges into the draft; non-praise moments stay AI proposals', async () => {
    const user = userEvent.setup()
    installSeam(
      speakingGradingView({
        aiSpeakingSuggestion: speakingSuggestion({
          moments: [
            { type: 'praise', criterion: 'pronunciation', timestampMs: 4200, text: 'Great intonation.', confidence: 'high' },
            { type: 'praise', criterion: 'fluencyCoherence', timestampMs: 6000, text: 'Natural pacing.', confidence: 'medium' },
            { type: 'error', criterion: 'grammaticalRange', timestampMs: 8000, text: 'Tense slip.', confidence: 'medium' },
          ],
        }),
      }),
    )
    renderPage()

    await user.click(await screen.findByTestId('ai-speaking-accept-all-praise'))

    // Both praise moments leave the AI proposals and survive as draft comments…
    await waitFor(() => expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument())
    expect(screen.queryByTestId('ai-moment-ai-m-1')).not.toBeInTheDocument()
    expect(screen.getByText('Great intonation.')).toBeInTheDocument()
    expect(screen.getByText('Natural pacing.')).toBeInTheDocument()
    // …while the error moment is untouched (still an un-accepted AI card).
    expect(screen.getByTestId('ai-moment-ai-m-2')).toBeInTheDocument()
    // The button is gone once no un-accepted praise remains.
    expect(screen.queryByTestId('ai-speaking-accept-all-praise')).not.toBeInTheDocument()
  })

  test('Dismiss moment: it leaves the rail AND its waveform pin, and does NOT become a draft comment', async () => {
    const user = userEvent.setup()
    installSeam(
      speakingGradingView({
        aiSpeakingSuggestion: speakingSuggestion({
          moments: [{ type: 'error', criterion: 'lexicalResource', timestampMs: 4200, text: 'Word choice slip.', confidence: 'high' }],
        }),
      }),
    )
    renderPage()

    expect(await screen.findByTestId('waveform-pin-ai-m-0')).toBeInTheDocument()
    await user.click(screen.getByTestId('ai-moment-ai-m-0-dismiss'))

    await waitFor(() => expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument())
    // Dismiss is not accept — no draft comment is minted, and the marker is gone too.
    expect(screen.queryByTestId('waveform-pin-ai-m-0')).not.toBeInTheDocument()
    expect(screen.queryByText('Word choice slip.')).not.toBeInTheDocument()
  })

  test('Edit-then-Accept a moment: the EDITED text is what merges into the draft', async () => {
    const user = userEvent.setup()
    installSeam(
      speakingGradingView({
        aiSpeakingSuggestion: speakingSuggestion({
          moments: [{ type: 'suggestion', criterion: 'pronunciation', timestampMs: 4200, text: 'Original AI text.', confidence: 'medium' }],
        }),
      }),
    )
    renderPage()

    await user.click(await screen.findByTestId('ai-moment-ai-m-0-edit'))
    const textarea = screen.getByTestId('ai-moment-ai-m-0-text')
    await user.clear(textarea)
    await user.type(textarea, 'Teacher-refined note.')
    await user.click(screen.getByTestId('ai-moment-ai-m-0-accept'))

    // The card leaves the proposals; the EDITED text (not the AI original) is the draft comment.
    await waitFor(() => expect(screen.queryByTestId('ai-moment-ai-m-0')).not.toBeInTheDocument())
    expect(screen.getByText('Teacher-refined note.')).toBeInTheDocument()
    expect(screen.queryByText('Original AI text.')).not.toBeInTheDocument()
  })
})

describe('SpeakingGradingPage AI — wire-strip on release (AC9, MANDATORY DoD)', () => {
  test('an accepted AI moment reaches the grade write with NO source/confidence/rationale', async () => {
    localStorage.clear()
    const user = userEvent.setup()
    const seam = installSeam(speakingGradingView({ aiSpeakingSuggestion: speakingSuggestion() }))
    renderPage()

    // Accept the pinned AI moment, then accept all four bands so the grade is releasable.
    await user.click(await screen.findByTestId('ai-moment-ai-m-0-accept'))
    for (const key of ['fluencyCoherence', 'lexicalResource', 'grammaticalRange', 'pronunciation']) {
      await user.click(await screen.findByTestId(`ai-speaking-band-${key}-accept`))
    }

    // Release.
    await user.click(screen.getByTestId('speaking-grading-submit'))
    await user.click(await screen.findByTestId('speaking-release-confirm'))

    await waitFor(() => expect(seam.gradeBody()).not.toBeNull())
    const body = seam.gradeBody() as { comments: Array<Record<string, unknown>> }
    const merged = body.comments.find((c) => c.text === 'Clear /θ/ sound.')
    expect(merged).toBeDefined()
    // The teacher-only fields are DROPPED at the merge/wire boundary (AC9).
    expect(merged).not.toHaveProperty('source')
    expect(merged).not.toHaveProperty('confidence')
    expect(merged).not.toHaveProperty('rationale')
    // The moment core survives as a plain timestamped comment.
    expect(merged).toMatchObject({ type: 'praise', criterion: 'pronunciation', timestampMs: 4200 })
  })
})
