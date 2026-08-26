/**
 * Story 6.3c (T4, T7) — AiSpeakingGradePanel. The panel is PRESENTATIONAL (the page owns
 * the `useAiGradeSpeakingJob` hook + review state, SD5), so it is exercised directly with
 * constructed `aiJob` props — this is NOT mocking useQuery (the hook itself is covered
 * exhaustively, MSW-backed, in useAiGradeSpeakingJob.test.tsx); the panel simply renders
 * the hook's derived state. Covers: no-auto-enqueue, re-run gate, generating/slow states,
 * band strip + transcript, partial_success value-first, terminal toasts + latch, and the
 * enqueue-time inline rejection (AC1/3/4/10/11/14/16/17/18).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { toast } from 'sonner'

import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'
import { AiSpeakingGradePanel, type AiSpeakingGradePanelProps } from '../AiSpeakingGradePanel'
import type { UseAiGradeSpeakingJobResult } from '../../hooks/useAiGradeSpeakingJob'

type AISpeakingGradeResult = components['schemas']['AISpeakingGradeResult']

function speakingResult(overrides: Partial<AISpeakingGradeResult> = {}): AISpeakingGradeResult {
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
    moments: [],
    transcript: 'Well, I think the most important thing…',
    transcriptionStatus: 'available',
    overallFeedback: 'Confident.',
    analyzedDurationMs: 92_000,
    latencyMs: 1800,
    ...overrides,
  }
}

function makeAiJob(overrides: Partial<UseAiGradeSpeakingJobResult> = {}): UseAiGradeSpeakingJobResult {
  return {
    phase: 'idle',
    result: null,
    errorKind: null,
    transcriptionStatus: null,
    slowLevel: 0,
    enqueue: vi.fn(),
    reset: vi.fn(),
    isEnqueuing: false,
    enqueueError: null,
    ...overrides,
  }
}

function renderPanel(props: Partial<AiSpeakingGradePanelProps> = {}) {
  const onConfirmRun = props.onConfirmRun ?? vi.fn()
  const merged: AiSpeakingGradePanelProps = {
    aiJob: makeAiJob(),
    suggestion: null,
    hasExistingSuggestion: false,
    reviewPending: false,
    onReview: vi.fn(),
    bands: [],
    overallBand: 0,
    hasUnacceptedPraise: false,
    onConfirmRun,
    onAcceptBand: vi.fn(),
    onDismissBand: vi.fn(),
    onAcceptAllPraise: vi.fn(),
    ...props,
  }
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <AiSpeakingGradePanel {...merged} />
    </I18nextProvider>,
  )
  return { ...utils, onConfirmRun }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AiSpeakingGradePanel — run + confirm gate (AC1/AC3)', () => {
  test('idle: shows the "Run AI grading" control and does NOT auto-enqueue on mount', () => {
    const { onConfirmRun } = renderPanel()
    expect(screen.getByTestId('ai-speaking-run')).toHaveTextContent(i18n.t('speakingGrading.ai.run'))
    expect(onConfirmRun).not.toHaveBeenCalled()
  })

  test('Run → confirm dialog (−1 credit) → onConfirmRun on confirm', async () => {
    const user = userEvent.setup()
    const { onConfirmRun } = renderPanel()
    await user.click(screen.getByTestId('ai-speaking-run'))
    expect(screen.getByTestId('ai-grade-confirm-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('ai-grade-confirm-cost')).toBeInTheDocument()
    await user.click(screen.getByTestId('ai-grade-confirm-run'))
    expect(onConfirmRun).toHaveBeenCalledTimes(1)
  })

  test('re-run gate: an existing suggestion labels the control "Re-run" and the dialog warns', async () => {
    const user = userEvent.setup()
    renderPanel({ hasExistingSuggestion: true, suggestion: speakingResult() })
    expect(screen.getByTestId('ai-speaking-run')).toHaveTextContent(i18n.t('speakingGrading.ai.rerun'))
    await user.click(screen.getByTestId('ai-speaking-run'))
    expect(screen.getByTestId('ai-grade-confirm-rerun-warning')).toBeInTheDocument()
  })
})

describe('AiSpeakingGradePanel — generating + slow (AC14/AC18)', () => {
  test('generating renders a skeleton (no spinner) + the normal body', () => {
    renderPanel({ aiJob: makeAiJob({ phase: 'generating' }) })
    expect(screen.getByTestId('ai-speaking-generating')).toBeInTheDocument()
    expect(screen.getByTestId('ai-speaking-slow-message')).toHaveTextContent(
      i18n.t('speakingGrading.ai.generating.body'),
    )
  })

  test('slowLevel 1 → "taking longer"; slowLevel 2 → "unusually slow"', () => {
    const { rerender } = renderPanel({ aiJob: makeAiJob({ phase: 'generating', slowLevel: 1 }) })
    expect(screen.getByTestId('ai-speaking-slow-message')).toHaveTextContent(
      i18n.t('speakingGrading.ai.slow.slower'),
    )
    rerender(
      <I18nextProvider i18n={i18n}>
        <AiSpeakingGradePanel
          aiJob={makeAiJob({ phase: 'generating', slowLevel: 2 })}
          suggestion={null}
          hasExistingSuggestion={false}
          reviewPending={false}
          onReview={vi.fn()}
          bands={[]}
          overallBand={0}
          hasUnacceptedPraise={false}
          onConfirmRun={vi.fn()}
          onAcceptBand={vi.fn()}
          onDismissBand={vi.fn()}
          onAcceptAllPraise={vi.fn()}
        />
      </I18nextProvider>,
    )
    expect(screen.getByTestId('ai-speaking-slow-message')).toHaveTextContent(
      i18n.t('speakingGrading.ai.slow.verySlow'),
    )
  })
})

describe('AiSpeakingGradePanel — band strip + transcript (AC5/AC10/AC11)', () => {
  test('ready + available transcript → band strip + a "View transcript" toggle revealing the body', async () => {
    const user = userEvent.setup()
    renderPanel({
      aiJob: makeAiJob({ phase: 'ready', result: speakingResult(), transcriptionStatus: 'available' }),
      suggestion: speakingResult(),
      hasExistingSuggestion: true,
      bands: [
        { criterion: 'fluencyCoherence', band: 6.5, rationale: 'r', confidence: 'high' },
        { criterion: 'lexicalResource', band: 6, rationale: 'r', confidence: 'medium' },
        { criterion: 'grammaticalRange', band: 7, rationale: 'r', confidence: 'high' },
        { criterion: 'pronunciation', band: 6.5, rationale: 'r', confidence: 'medium' },
      ],
      overallBand: 6.5,
    })
    expect(screen.getByTestId('ai-speaking-band-strip')).toBeInTheDocument()
    await user.click(screen.getByTestId('ai-speaking-transcript-toggle'))
    expect(screen.getByTestId('ai-speaking-transcript-body')).toHaveTextContent(
      'Well, I think the most important thing…',
    )
  })

  test('partial_success (transcriptionStatus unavailable) → value-first header, NOT an apology; band strip still renders', () => {
    const result = speakingResult({ transcript: null, transcriptionStatus: 'unavailable' })
    renderPanel({
      aiJob: makeAiJob({ phase: 'ready', result, transcriptionStatus: 'unavailable' }),
      suggestion: result,
      hasExistingSuggestion: true,
      bands: [{ criterion: 'fluencyCoherence', band: 6.5, rationale: 'r', confidence: 'high' }],
      overallBand: 6.5,
    })
    expect(screen.getByTestId('ai-speaking-transcript-unavailable')).toHaveTextContent(
      'Transcript unavailable — band proposals below',
    )
    // The value (bands) is still fully rendered — partial_success is a SUCCESS.
    expect(screen.getByTestId('ai-speaking-band-strip')).toBeInTheDocument()
    // No "View transcript" toggle when there is no transcript.
    expect(screen.queryByTestId('ai-speaking-transcript-toggle')).not.toBeInTheDocument()
  })
})

describe('AiSpeakingGradePanel — terminal failures (AC16/AC17)', () => {
  test('audio_unavailable → refund toast (exact copy) + inline "re-record"', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    renderPanel({ aiJob: makeAiJob({ phase: 'failed', errorKind: 'audio_unavailable' }) })
    expect(errorSpy).toHaveBeenCalledWith(
      "We couldn't process this recording — your AI credit has been returned. Try again.",
    )
    expect(screen.getByTestId('ai-speaking-failed')).toHaveTextContent(
      i18n.t('speakingGrading.state.reRecord'),
    )
  })

  test('invalid_band_scores → inline "grade manually" empty-form message, NO toast', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    renderPanel({ aiJob: makeAiJob({ phase: 'failed', errorKind: 'invalid_band_scores' }) })
    expect(screen.getByTestId('ai-speaking-failed')).toHaveTextContent(
      i18n.t('speakingGrading.ai.invalidScores'),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('invalid_ai_response → the "invalid output, credit returned" refund toast', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    renderPanel({ aiJob: makeAiJob({ phase: 'failed', errorKind: 'invalid_ai_response' }) })
    expect(errorSpy).toHaveBeenCalledWith(i18n.t('speakingGrading.ai.toast.invalidOutput'))
  })

  test('poll_error → inline retry message, NO credit-returned toast', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    renderPanel({ aiJob: makeAiJob({ phase: 'failed', errorKind: 'poll_error' }) })
    expect(screen.getByTestId('ai-speaking-failed')).toHaveTextContent(
      i18n.t('speakingGrading.ai.pollError'),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('the refund toast fires ONCE per episode — a re-render (e.g. language switch) does not re-fire it', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const failedJob = makeAiJob({ phase: 'failed', errorKind: 'audio_unavailable' })
    const { rerender } = renderPanel({ aiJob: failedJob })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // Re-render with the SAME failed job (the latch must suppress a second toast).
    rerender(
      <I18nextProvider i18n={i18n}>
        <AiSpeakingGradePanel
          aiJob={failedJob}
          suggestion={null}
          hasExistingSuggestion={false}
          reviewPending={false}
          onReview={vi.fn()}
          bands={[]}
          overallBand={0}
          hasUnacceptedPraise={false}
          onConfirmRun={vi.fn()}
          onAcceptBand={vi.fn()}
          onDismissBand={vi.fn()}
          onAcceptAllPraise={vi.fn()}
        />
      </I18nextProvider>,
    )
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('AiSpeakingGradePanel — enqueue-time rejection (AC4)', () => {
  test('409 SUBMISSION_TOO_LONG → inline explanation, NO refund toast', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const enqueueError = new ApiError(409, 'SUBMISSION_TOO_LONG', 'too long', 'req-1')
    renderPanel({ aiJob: makeAiJob({ enqueueError }) })
    expect(screen.getByTestId('ai-speaking-enqueue-reject')).toHaveTextContent(
      i18n.t('speakingGrading.ai.tooLong'),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('409 SUBMISSION_NOT_GRADABLE → the second inline reject copy, NO refund toast', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const enqueueError = new ApiError(409, 'SUBMISSION_NOT_GRADABLE', 'not gradable', 'req-3')
    renderPanel({ aiJob: makeAiJob({ enqueueError }) })
    expect(screen.getByTestId('ai-speaking-enqueue-reject')).toHaveTextContent(
      i18n.t('speakingGrading.ai.notGradable'),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('a generic enqueue error → the "couldn\'t start" toast (not the inline reject)', () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const enqueueError = new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'rate', 'req-2')
    renderPanel({ aiJob: makeAiJob({ enqueueError }) })
    expect(errorSpy).toHaveBeenCalledWith(i18n.t('speakingGrading.ai.toast.enqueueFailed'))
    expect(screen.queryByTestId('ai-speaking-enqueue-reject')).not.toBeInTheDocument()
  })
})

describe('AiSpeakingGradePanel — accessibility (AC20)', () => {
  const readyBands: AiSpeakingGradePanelProps['bands'] = [
    { criterion: 'fluencyCoherence', band: 6.5, rationale: 'r', confidence: 'high' },
    { criterion: 'lexicalResource', band: 6, rationale: 'r', confidence: 'medium' },
    { criterion: 'grammaticalRange', band: 7, rationale: 'r', confidence: 'high' },
    { criterion: 'pronunciation', band: 6.5, rationale: 'r', confidence: 'medium' },
  ]

  function renderReady() {
    return renderPanel({
      aiJob: makeAiJob({ phase: 'ready', result: speakingResult(), transcriptionStatus: 'available' }),
      suggestion: speakingResult(),
      hasExistingSuggestion: true,
      bands: readyBands,
      overallBand: 6.5,
    })
  }

  test('the ready panel (band strip + collapsed transcript disclosure) has no axe violations', async () => {
    const { container } = renderReady()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('the expanded transcript disclosure has no axe violations', async () => {
    const user = userEvent.setup()
    const { container } = renderReady()
    await user.click(screen.getByTestId('ai-speaking-transcript-toggle'))
    expect(screen.getByTestId('ai-speaking-transcript-body')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('the open confirm dialog has no axe violations', async () => {
    const user = userEvent.setup()
    const { container } = renderReady()
    await user.click(screen.getByTestId('ai-speaking-run'))
    expect(screen.getByTestId('ai-grade-confirm-dialog')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('the confirm dialog returns focus to the Run trigger on close (Escape)', async () => {
    const user = userEvent.setup()
    renderReady()
    const runTrigger = screen.getByTestId('ai-speaking-run')
    await user.click(runTrigger)
    expect(screen.getByTestId('ai-grade-confirm-dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByTestId('ai-grade-confirm-dialog')).not.toBeInTheDocument(),
    )
    // Radix restores focus to the element that opened the dialog (WAI-ARIA dialog pattern).
    expect(runTrigger).toHaveFocus()
  })
})
