// Story 4.3b T4 — AIGenerateDialog behaviour. MSW at the HTTP boundary
// (TEST-FE-1); real QueryClient + real hook (never mock Query). Fake timers
// drive the poll cadence + the 5-min stuck threshold; assertions read directly
// after `advanceTimersByTimeAsync` (no RTL `findBy` — it deadlocks under fake
// timers). i18n parity (TEST-FE-4) + axe (TEST-FE-5) included.
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { assertI18nInterpolationParity, assertI18nParity } from '@/lib/test/i18n-parity'
import type { components } from '@/lib/api/client'
import {
  AIGenerateDialog,
  type AIGenerateDialogProps,
  type AiGenerateOpenRequest,
} from '../AIGenerateDialog'

type Job = components['schemas']['Job']
type ExerciseContent = components['schemas']['ExerciseContent']

const EX_ID = 'ex-1'
const JOB_ID = 'job-1'

function sectionFragment(): ExerciseContent {
  return {
    sections: [
      {
        type: 'reading',
        title: 'Generated passage',
        content: 'The quick brown fox jumps over the lazy dog again and again.',
        questionGroups: [
          {
            type: 'multiple_choice',
            instructions: 'Choose the best answer.',
            questions: [
              { text: 'Q1', type: 'multiple_choice', options: ['a', 'b'], correctAnswer: 'a', acceptedVariants: [] },
            ],
          },
        ],
      },
    ],
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    type: 'ai_generate_section',
    status: 'pending',
    result: null,
    errorDetails: null,
    createdAt: '2026-07-29T00:00:00.000000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function installFlow(statuses: Job[], opts: { enqueueStatus?: number } = {}) {
  const pollTimes: number[] = []
  const enqueues: Array<{ mode: string; params: Record<string, unknown> }> = []
  let pollIndex = 0
  server.use(
    http.post('/api/exercises/:id/ai-generate', async ({ request }) => {
      enqueues.push((await request.json()) as { mode: string; params: Record<string, unknown> })
      if (opts.enqueueStatus) {
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } },
          { status: opts.enqueueStatus },
        )
      }
      return HttpResponse.json({ data: { jobId: JOB_ID }, meta: { serverTime: 't' } }, { status: 202 })
    }),
    http.get('/api/jobs/:jobId', () => {
      pollTimes.push(Date.now())
      const current = statuses[Math.min(pollIndex, statuses.length - 1)]
      pollIndex += 1
      return HttpResponse.json({ data: current, meta: { serverTime: 't' } })
    }),
  )
  return { pollTimes, enqueues }
}

function renderDialog(
  request: AiGenerateOpenRequest,
  handlers: {
    onInsert?: ReturnType<typeof vi.fn>
    onClose?: ReturnType<typeof vi.fn>
  } = {},
) {
  const onInsert = handlers.onInsert ?? vi.fn()
  const onClose = handlers.onClose ?? vi.fn()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AIGenerateDialog
            exerciseId={EX_ID}
            request={request}
            onInsert={onInsert as unknown as AIGenerateDialogProps['onInsert']}
            onClose={onClose as unknown as AIGenerateDialogProps['onClose']}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onInsert, onClose }
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Fill the section topic + submit, flushing the enqueue mutation. */
async function generateSection() {
  fireEvent.change(screen.getByTestId('ai-topic-input'), {
    target: { value: 'urban green spaces' },
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('ai-generate-submit'))
    await vi.advanceTimersByTimeAsync(10)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  // The axe test opts into real timers; guard so cleanup works in both modes.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  vi.useRealTimers()
  server.resetHandlers()
})

describe('AIGenerateDialog — config form (AC1, UX-1)', () => {
  test('section mode renders the chips, topic, est-cost and credit counter', () => {
    renderDialog({ mode: 'section' })
    expect(screen.getByTestId('ai-section-form')).toBeInTheDocument()
    expect(screen.getByTestId('ai-section-type-reading')).toBeInTheDocument()
    expect(screen.getByTestId('ai-topic-input')).toBeInTheDocument()
    expect(screen.getByTestId('ai-target-band-6.5')).toBeInTheDocument()
    expect(screen.getByTestId('ai-est-cost')).toHaveTextContent(
      i18n.t('exercises.ai.estCost', { count: 1 }),
    )
    expect(screen.getByTestId('ai-credit-counter')).toHaveTextContent(
      i18n.t('exercises.ai.creditCounter', { used: 0, total: 50 }),
    )
  })

  test('Writing/Speaking are prompt-only — the question count/mix chips hide', () => {
    renderDialog({ mode: 'section' })
    expect(screen.getByTestId('ai-question-count-5')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-section-type-writing'))
    expect(screen.queryByTestId('ai-question-count-5')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-prompt-only-hint')).toBeInTheDocument()
  })

  test('questions mode renders a count-only form', () => {
    renderDialog({ mode: 'questions', targetId: '0' })
    expect(screen.getByTestId('ai-count-form')).toBeInTheDocument()
    expect(screen.getByTestId('ai-count-5')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-topic-input')).not.toBeInTheDocument()
  })
})

describe('AIGenerateDialog — enqueue → poll → preview (AC2, AC3)', () => {
  test('section chips compose into the topic seed sent to the backend', async () => {
    const flow = installFlow([job({ status: 'processing' })])
    renderDialog({ mode: 'section' })
    fireEvent.click(screen.getByTestId('ai-target-band-6.5'))
    await generateSection()
    expect(flow.enqueues).toHaveLength(1)
    expect(flow.enqueues[0].mode).toBe('section')
    const topic = flow.enqueues[0].params.topic as string
    expect(topic).toContain('reading section')
    expect(topic).toContain('target band 6.5')
    expect(topic).toContain('urban green spaces')
  })

  test('generating state then a preview with a summary on complete', async () => {
    installFlow([job({ status: 'pending' }), job({ status: 'complete', result: sectionFragment() })])
    renderDialog({ mode: 'section' })
    await generateSection()
    expect(screen.getByTestId('ai-generating')).toBeInTheDocument()

    await tick(2000 + 4000)
    expect(screen.getByTestId('ai-generation-preview')).toBeInTheDocument()
    // A single-question fragment pluralizes correctly ("1 question", not
    // "1 questions") — the summary composes pluralized sub-keys via i18next
    // nesting rather than raw interpolation.
    const summary = screen.getByTestId('ai-preview-summary')
    expect(summary).toHaveTextContent('12 words')
    expect(summary).toHaveTextContent('1 question')
    expect(summary.textContent).not.toContain('1 questions')
  })

  test('Accept inserts the fragment then closes; Dismiss inserts nothing', async () => {
    installFlow([job({ status: 'complete', result: sectionFragment() })])
    const { onInsert, onClose } = renderDialog({ mode: 'section' })
    await generateSection()
    await tick(2000)
    expect(screen.getByTestId('ai-generation-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ai-preview-accept'))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert).toHaveBeenCalledWith('section', sectionFragment(), { focus: false })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('Insert & edit inserts with the focus intent, then closes', async () => {
    installFlow([job({ status: 'complete', result: sectionFragment() })])
    const { onInsert, onClose } = renderDialog({ mode: 'section' })
    await generateSection()
    await tick(2000)
    expect(screen.getByTestId('ai-generation-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ai-preview-edit'))
    // Edit is distinct from Accept: it carries { focus: true } so the editor
    // scrolls/focuses the inserted content for adjustment (AC3).
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert).toHaveBeenCalledWith('section', sectionFragment(), { focus: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('Dismiss from preview inserts nothing', async () => {
    installFlow([job({ status: 'complete', result: sectionFragment() })])
    const { onInsert, onClose } = renderDialog({ mode: 'section' })
    await generateSection()
    await tick(2000)
    fireEvent.click(screen.getByTestId('ai-preview-dismiss'))
    expect(onInsert).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('AIGenerateDialog — failure + stuck surfaces (AC4, AC5)', () => {
  test('a job stuck past 5 minutes shows the cancel/retry surface', async () => {
    installFlow([job({ status: 'processing' })])
    renderDialog({ mode: 'section' })
    await generateSection()
    expect(screen.getByTestId('ai-generating')).toBeInTheDocument()
    await tick(5 * 60 * 1000)
    expect(screen.getByTestId('ai-stuck')).toBeInTheDocument()
    expect(screen.getByTestId('ai-stuck-retry')).toBeInTheDocument()
  })

  test('generic failure and invalid_ai_response show DISTINCT messages + actions', async () => {
    installFlow([job({ status: 'failed', errorDetails: 'max_retries_exhausted' })])
    renderDialog({ mode: 'section' })
    await generateSection()
    await tick(2001)
    const genericPanel = screen.getByTestId('ai-failed')
    expect(genericPanel).toHaveTextContent(i18n.t('exercises.ai.failed.generic'))
    expect(screen.getByTestId('ai-failed-manual')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-failed-adjust')).not.toBeInTheDocument()
  })

  test('invalid_ai_response steers to adjust-the-prompt, not a bare retry', async () => {
    installFlow([job({ status: 'failed', errorDetails: 'invalid_ai_response' })])
    renderDialog({ mode: 'section' })
    await generateSection()
    await tick(2001)
    const panel = screen.getByTestId('ai-failed')
    expect(panel).toHaveTextContent(i18n.t('exercises.ai.failed.invalidResponse'))
    expect(screen.getByTestId('ai-failed-adjust')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-failed-manual')).not.toBeInTheDocument()
    // The two failure messages are genuinely different copy (AC5).
    expect(i18n.t('exercises.ai.failed.invalidResponse')).not.toBe(
      i18n.t('exercises.ai.failed.generic'),
    )
  })
})

describe('AIGenerateDialog — cross-scope enqueue error (AC7)', () => {
  test('a 403 enqueue surfaces a human error, not a crash', async () => {
    installFlow([job({ status: 'pending' })], { enqueueStatus: 403 })
    renderDialog({ mode: 'section' })
    await generateSection()
    expect(screen.getByTestId('ai-enqueue-error')).toHaveTextContent(
      i18n.t('exercises.ai.error.forbidden'),
    )
  })
})

describe('AIGenerateDialog — i18n parity + a11y (AC6, TEST-FE-4/5)', () => {
  const AI_KEYS = [
    'exercises.ai.title.section',
    'exercises.ai.title.questions',
    'exercises.ai.title.distractors',
    'exercises.ai.subtitle.section',
    'exercises.ai.subtitle.questions',
    'exercises.ai.subtitle.distractors',
    'exercises.ai.field.sectionType',
    'exercises.ai.field.topic',
    'exercises.ai.field.targetBand',
    'exercises.ai.field.questionCount',
    'exercises.ai.field.questionMix',
    'exercises.ai.field.count',
    'exercises.ai.field.promptOnlyHint',
    'exercises.ai.bandValue',
    'exercises.ai.questionCount_one',
    'exercises.ai.questionCount_other',
    'exercises.ai.estCost_one',
    'exercises.ai.estCost_other',
    'exercises.ai.creditCounter',
    'exercises.ai.generate',
    'exercises.ai.cancel',
    'exercises.ai.generateSectionCard',
    'exercises.ai.generateQuestions',
    'exercises.ai.generateDistractorsFor',
    'exercises.ai.generating.message',
    'exercises.ai.preview.sectionSummary',
    'exercises.ai.preview.questionsSummary',
    'exercises.ai.preview.distractorsSummary',
    'exercises.ai.preview.wordCount_one',
    'exercises.ai.preview.wordCount_other',
    'exercises.ai.preview.groupCount_one',
    'exercises.ai.preview.groupCount_other',
    'exercises.ai.preview.optionCount_one',
    'exercises.ai.preview.optionCount_other',
    'exercises.ai.preview.accept',
    'exercises.ai.preview.edit',
    'exercises.ai.preview.dismiss',
    'exercises.ai.preview.regenerate',
    'exercises.ai.stuck.title',
    'exercises.ai.stuck.body',
    'exercises.ai.stuck.retry',
    'exercises.ai.failed.generic',
    'exercises.ai.failed.invalidResponse',
    'exercises.ai.failed.retry',
    'exercises.ai.failed.manual',
    'exercises.ai.failed.adjust',
    'exercises.ai.error.notFound',
    'exercises.ai.error.forbidden',
    'exercises.ai.error.generic',
    'exercises.ai.errors.topicRequired',
  ]

  test('every ai key exists in en AND vi with matching interpolation tokens', () => {
    assertI18nParity(AI_KEYS)
    assertI18nInterpolationParity([
      'exercises.ai.bandValue',
      'exercises.ai.questionCount_one',
      'exercises.ai.questionCount_other',
      'exercises.ai.estCost_one',
      'exercises.ai.estCost_other',
      'exercises.ai.creditCounter',
      'exercises.ai.generateDistractorsFor',
      'exercises.ai.preview.sectionSummary',
      'exercises.ai.preview.questionsSummary',
      'exercises.ai.preview.distractorsSummary',
    ])
  })

  test('the config form has no accessibility violations', async () => {
    // axe uses real setTimeout internally — run this one on real timers so it
    // doesn't deadlock against the suite-wide fake clock.
    vi.useRealTimers()
    renderDialog({ mode: 'section' })
    const results = await axe(screen.getByTestId('ai-generate-dialog'))
    expect(results).toHaveNoViolations()
  })
})
