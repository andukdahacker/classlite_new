// Story 6.2b T8 (AC1-15,18) — the AI suggestion panel. MSW at the HTTP boundary
// (TEST-FE-1); real QueryClient. The panel is exported and prop-driven, so it is
// exercised directly (the draft merge is asserted via the onAccept* callbacks; the
// wire-strip + student-negative are covered by the full-page + student suites).
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
import { AiGradePanel, type AiGradePanelProps } from '../AiGradePanel'

type AIWritingGradeResult = components['schemas']['AIWritingGradeResult']
type Job = components['schemas']['Job']

const SUBMISSION_ID = 'sub-1'
const JOB_ID = 'job-w-1'
const AI_GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/ai-grade`

function gradeResult(): AIWritingGradeResult {
  const criterion = (band: number, confidence: 'high' | 'medium' = 'high') => ({
    band,
    rationale: `rationale ${band}`,
    confidence,
  })
  return {
    criteria: {
      taskResponse: criterion(6.5),
      coherenceCohesion: criterion(6, 'medium'),
      lexicalResource: criterion(7),
      grammaticalRange: criterion(6.5, 'medium'),
    },
    comments: [
      { type: 'error', criterion: 'grammaticalRange', anchorStart: 0, anchorEnd: 3, text: 'Agreement.', confidence: 'high' },
      { type: 'praise', criterion: 'taskResponse', anchorStart: 4, anchorEnd: 9, text: 'Strong thesis.', confidence: 'high' },
      { type: 'suggestion', criterion: 'lexicalResource', anchorStart: null, anchorEnd: null, text: 'Vary linkers.', confidence: 'medium' },
    ],
    overallFeedback: 'Solid.',
    analyzedWordCount: 287,
    latencyMs: 1400,
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    type: 'ai_grade_writing',
    status: 'pending',
    result: null,
    errorDetails: null,
    createdAt: '2026-08-20T00:00:00.000000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Installs enqueue + a scripted poll sequence; returns live call counters. */
function installFlow(statuses: Job[], opts: { enqueueStatus?: number; enqueueError?: number } = {}) {
  let enqueues = 0
  let polls = 0
  let pollIndex = 0
  server.use(
    http.post(AI_GRADE_PATH, () => {
      enqueues += 1
      if (opts.enqueueError) {
        return HttpResponse.json(
          { error: { code: 'AI_GRADE_ENQUEUE_CONFLICT', message: 'conflict', requestId: 'r' } },
          { status: opts.enqueueError },
        )
      }
      return HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: opts.enqueueStatus ?? 202 })
    }),
    http.get('/api/jobs/:jobId', () => {
      polls += 1
      const current = statuses[Math.min(pollIndex, statuses.length - 1)]
      pollIndex += 1
      return HttpResponse.json({ data: current, meta: { serverTime: 't' } })
    }),
  )
  return { enqueues: () => enqueues, polls: () => polls }
}

function renderPanel(props: Partial<AiGradePanelProps> = {}) {
  const onAcceptBand = vi.fn()
  const onAcceptComment = vi.fn()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AiGradePanel
          submissionId={SUBMISSION_ID}
          rehydratedSuggestion={null}
          draftDirty={false}
          appliedBandCriteria={new Set()}
          onAcceptBand={onAcceptBand}
          onAcceptComment={onAcceptComment}
          {...props}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onAcceptBand, onAcceptComment }
}

async function runAndConfirm() {
  fireEvent.click(screen.getByTestId('ai-run-grading'))
  fireEvent.click(await screen.findByTestId('ai-grade-confirm-run'))
}

beforeEach(() => {
  vi.restoreAllMocks()
  // The hook now persists the in-flight jobId per submission (code-review 2026-08-21);
  // clear it so an enqueue in one test doesn't seed/auto-poll the next (SUBMISSION_ID is
  // constant across tests).
  localStorage.clear()
})
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
})

describe('AiGradePanel — enqueue + confirm gate (AC1, AC3, FD4)', () => {
  test('does NOT auto-enqueue on mount — idle until the teacher confirms', async () => {
    const flow = installFlow([job({ status: 'processing' })])
    renderPanel()
    // Give any stray effect a chance to fire.
    await Promise.resolve()
    expect(flow.enqueues()).toBe(0)
    expect(screen.getByTestId('ai-run-grading')).toHaveTextContent(i18n.t('grading.ai.run'))
  })

  test('Run → confirm dialog shows the −1 credit cost → confirm enqueues', async () => {
    const flow = installFlow([job({ status: 'complete', result: gradeResult() })])
    renderPanel()
    fireEvent.click(screen.getByTestId('ai-run-grading'))
    const dialog = await screen.findByTestId('ai-grade-confirm-dialog')
    expect(within(dialog).getByTestId('ai-grade-confirm-cost')).toHaveTextContent(
      i18n.t('grading.ai.confirm.cost'),
    )
    // A first run shows NO re-run warning.
    expect(screen.queryByTestId('ai-grade-confirm-rerun-warning')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-grade-confirm-run'))
    await waitFor(() => expect(flow.enqueues()).toBe(1))
  })

  test('a rehydrated suggestion shows the re-run warning and NEVER auto-enqueues (AC3, AC10)', async () => {
    const flow = installFlow([job({ status: 'processing' })])
    renderPanel({ rehydratedSuggestion: gradeResult() })
    // Rehydrated (non-triggering / reopen) → the suggestion renders for review…
    expect(await screen.findByTestId('ai-grade-suggestion')).toBeInTheDocument()
    // …with NO enqueue and NO poll (the creator-private job is never touched).
    expect(flow.enqueues()).toBe(0)
    expect(flow.polls()).toBe(0)
    // The control offers a RE-RUN, and the confirm carries the re-charge warning.
    expect(screen.getByTestId('ai-run-grading')).toHaveTextContent(i18n.t('grading.ai.rerun'))
    fireEvent.click(screen.getByTestId('ai-run-grading'))
    expect(await screen.findByTestId('ai-grade-confirm-rerun-warning')).toBeInTheDocument()
  })
})

describe('AiGradePanel — three-state (AC15)', () => {
  test('loading: a generating skeleton (not a spinner) while the job processes', async () => {
    installFlow([job({ status: 'processing' })])
    renderPanel()
    await runAndConfirm()
    expect(await screen.findByTestId('ai-grade-generating')).toBeInTheDocument()
  })

  test('success: the AIGradeSuggestion review surface renders on complete', async () => {
    installFlow([job({ status: 'complete', result: gradeResult() })])
    renderPanel()
    await runAndConfirm()
    expect(await screen.findByTestId('ai-grade-suggestion')).toBeInTheDocument()
    expect(screen.getByTestId('ai-band-proposal-taskResponse')).toBeInTheDocument()
  })

  test('error: a terminal failure surfaces an inline retry, not a full-page error', async () => {
    vi.spyOn(toast, 'error') // swallow the refund toast (asserted elsewhere)
    installFlow([job({ status: 'failed', errorDetails: 'generation_failed' })])
    renderPanel()
    await runAndConfirm()
    const failed = await screen.findByTestId('ai-grade-failed')
    expect(failed).toBeInTheDocument()
    expect(within(failed).getByTestId('ai-grade-retry')).toBeInTheDocument()
  })
})

describe('AiGradePanel — merge into draft (AC4-7)', () => {
  async function renderReady(props: Partial<AiGradePanelProps> = {}) {
    installFlow([job({ status: 'complete', result: gradeResult() })])
    const handlers = renderPanel(props)
    await runAndConfirm()
    await screen.findByTestId('ai-grade-suggestion')
    return handlers
  }

  test('Accept band writes the band via onAcceptBand', async () => {
    const { onAcceptBand } = await renderReady()
    fireEvent.click(screen.getByTestId('ai-band-taskResponse-accept'))
    expect(onAcceptBand).toHaveBeenCalledWith('taskResponse', 6.5)
  })

  test('Accept comment forwards the wire subset (with anchor) via onAcceptComment', async () => {
    const { onAcceptComment } = await renderReady()
    fireEvent.click(screen.getByTestId('ai-comment-ai-c-0-accept'))
    expect(onAcceptComment).toHaveBeenCalledWith({
      type: 'error',
      criterion: 'grammaticalRange',
      text: 'Agreement.',
      anchorStart: 0,
      anchorEnd: 3,
    })
  })

  test('an orphan (null-anchor) suggestion renders as general feedback, never dropped (AC6)', async () => {
    await renderReady()
    const orphan = screen.getByTestId('ai-comment-ai-c-2')
    expect(orphan).toHaveAttribute('data-anchored', 'false')
    expect(screen.getByTestId('ai-comment-ai-c-2-general')).toBeInTheDocument()
  })

  test('"Accept all praise" accepts only praise comments (AC7)', async () => {
    const { onAcceptComment } = await renderReady()
    fireEvent.click(screen.getByTestId('ai-accept-all-praise'))
    expect(onAcceptComment).toHaveBeenCalledTimes(1)
    expect(onAcceptComment).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'praise', text: 'Strong thesis.' }),
    )
  })

  test('Dismiss removes the proposal from the panel without merging (FD5)', async () => {
    const { onAcceptComment } = await renderReady()
    fireEvent.click(screen.getByTestId('ai-comment-ai-c-0-dismiss'))
    expect(screen.queryByTestId('ai-comment-ai-c-0')).not.toBeInTheDocument()
    expect(onAcceptComment).not.toHaveBeenCalled()
  })

  // --- code-review 2026-08-21 regressions ---

  test('a band already applied in the draft renders as Applied — never re-offered (reopen clobber guard, D1)', async () => {
    await renderReady({ appliedBandCriteria: new Set(['taskResponse']) })
    // taskResponse is already in the draft → "Applied", no Accept button to clobber it.
    expect(screen.getByTestId('ai-band-taskResponse-applied')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-band-taskResponse-accept')).not.toBeInTheDocument()
    // Un-applied criteria still offer Accept.
    expect(screen.getByTestId('ai-band-coherenceCohesion-accept')).toBeInTheDocument()
  })

  test('"Accept all praise" SKIPS a praise card mid-edit — no stale AI-original merge (D2)', async () => {
    const { onAcceptComment } = await renderReady()
    // Open Edit on the praise card (index 1) — its buffer is private to the card.
    fireEvent.click(screen.getByTestId('ai-comment-ai-c-1-edit'))
    fireEvent.click(screen.getByTestId('ai-accept-all-praise'))
    // The only praise is in edit → bulk-accept touches nothing (no stale merge).
    expect(onAcceptComment).not.toHaveBeenCalled()
    // Leaving edit re-includes it for a subsequent bulk-accept.
    fireEvent.click(screen.getByTestId('ai-comment-ai-c-1-edit'))
    fireEvent.click(screen.getByTestId('ai-accept-all-praise'))
    expect(onAcceptComment).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'praise', text: 'Strong thesis.' }),
    )
  })

  test('accepting a half-anchored comment (one offset null) normalizes to general — no stray offset reaches the draft (P7)', async () => {
    const halfAnchored: AIWritingGradeResult = {
      ...gradeResult(),
      comments: [
        { type: 'error', criterion: 'taskResponse', anchorStart: 5, anchorEnd: null, text: 'Half.', confidence: 'high' },
      ],
    }
    installFlow([job({ status: 'complete', result: halfAnchored })])
    const { onAcceptComment } = renderPanel()
    await runAndConfirm()
    await screen.findByTestId('ai-grade-suggestion')
    fireEvent.click(screen.getByTestId('ai-comment-ai-c-0-accept'))
    expect(onAcceptComment).toHaveBeenCalledWith(
      expect.objectContaining({ anchorStart: null, anchorEnd: null }),
    )
  })
})

describe('AiGradePanel — slow + failure paths (AC11, AC13, AC14)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  async function runFakeTimers() {
    fireEvent.click(screen.getByTestId('ai-run-grading'))
    // Flush the dialog mount, then confirm; advance to resolve enqueue + first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByTestId('ai-grade-confirm-run'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
  }

  test('slow messaging steps at 30s then 60s (AC11)', async () => {
    installFlow([job({ status: 'processing' })])
    renderPanel()
    await runFakeTimers()
    expect(screen.getByTestId('ai-grade-generating')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.getByTestId('ai-grade-slow-message')).toHaveTextContent(
      i18n.t('grading.ai.slow.slower'),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.getByTestId('ai-grade-slow-message')).toHaveTextContent(
      i18n.t('grading.ai.slow.verySlow'),
    )
  })

  test('invalid_band_scores → inline "grade manually" message, NO refund toast (AC13)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    installFlow([job({ status: 'failed', errorDetails: 'invalid_band_scores' })])
    renderPanel()
    await runFakeTimers()
    expect(screen.getByTestId('ai-grade-failed')).toHaveTextContent(i18n.t('grading.ai.invalidScores'))
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('invalid_ai_response → the "invalid output, credit returned" refund toast (AC14)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    installFlow([job({ status: 'failed', errorDetails: 'invalid_ai_response' })])
    renderPanel()
    await runFakeTimers()
    expect(errorSpy).toHaveBeenCalledWith(i18n.t('grading.ai.toast.invalidOutput'))
  })

  test('terminal failed → the "grading failed, credit returned" refund toast (AC14)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    installFlow([job({ status: 'failed', errorDetails: 'max_retries_exhausted' })])
    renderPanel()
    await runFakeTimers()
    expect(errorSpy).toHaveBeenCalledWith(i18n.t('grading.ai.toast.failed'))
  })

  test('a persistent poll-endpoint failure → inline "couldn\'t check progress", NO "credit returned" toast (poll_error, code-review 2026-08-21)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    // Enqueue succeeds, but every poll 500s — an infra failure, NOT a job failure.
    server.use(
      http.post(AI_GRADE_PATH, () =>
        HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 }),
      ),
      http.get('/api/jobs/:jobId', () => new HttpResponse(null, { status: 500 })),
    )
    renderPanel()
    await runFakeTimers()
    // Drive the 3 consecutive poll failures across the 2s/4s/8s backoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000)
    })
    expect(screen.getByTestId('ai-grade-failed')).toHaveTextContent(i18n.t('grading.ai.pollError'))
    // The false "credit returned" toast must NOT fire for a poll/infra failure.
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('AiGradePanel — non-blocking ready overlay (AC12)', () => {
  test('a dirty draft at completion shows a non-blocking "ready — Review?" overlay', async () => {
    installFlow([job({ status: 'complete', result: gradeResult() })])
    renderPanel({ draftDirty: true })
    await runAndConfirm()
    const overlay = await screen.findByTestId('ai-grade-ready-overlay')
    expect(overlay).toHaveAttribute('aria-live', 'polite')
    // Collapsed until the teacher opts in — the panel is NOT auto-opened.
    expect(screen.queryByTestId('ai-grade-suggestion')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-grade-review'))
    expect(await screen.findByTestId('ai-grade-suggestion')).toBeInTheDocument()
  })
})

describe('AiGradePanel — a11y (TEST-FE-5, AC18)', () => {
  test('the panel + confirm dialog have no axe violations', async () => {
    installFlow([job({ status: 'complete', result: gradeResult() })])
    const { container } = (() => {
      const client = createTestQueryClient()
      return render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <AiGradePanel
              submissionId={SUBMISSION_ID}
              rehydratedSuggestion={gradeResult()}
              draftDirty={false}
              appliedBandCriteria={new Set()}
              onAcceptBand={vi.fn()}
              onAcceptComment={vi.fn()}
            />
          </QueryClientProvider>
        </I18nextProvider>,
      )
    })()
    expect(await screen.findByTestId('ai-grade-suggestion')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    // Open the confirm dialog and re-audit.
    fireEvent.click(screen.getByTestId('ai-run-grading'))
    const dialog = await screen.findByTestId('ai-grade-confirm-dialog')
    expect(await axe(dialog)).toHaveNoViolations()
  })
})
