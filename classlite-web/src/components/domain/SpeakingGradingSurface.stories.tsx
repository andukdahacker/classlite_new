/**
 * SpeakingGradingSurface — Story 1d-4 AC3 visual identity stories.
 *
 * Fixture waveform is a deterministic sine-modulated polygon path so the
 * shape is identical across CI runs and locale toggles. No audio decode,
 * no Web Audio API. Pin chrome is positioned via fixture timestamps.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { SpeakingGradingSurface, type TimestampedComment } from './SpeakingGradingSurface'
import type { BandScoreBreakdown } from './WritingGradingSurface'

const WAVEFORM_WIDTH = 600
const WAVEFORM_HEIGHT = 80

function buildWaveformPath(samples: number, seedPhase: number): string {
  const top: string[] = []
  const bottom: string[] = []
  const midY = WAVEFORM_HEIGHT / 2
  for (let index = 0; index <= samples; index += 1) {
    const x = (index / samples) * WAVEFORM_WIDTH
    const phase = (index / samples) * Math.PI * 6 + seedPhase
    const envelope = Math.sin((index / samples) * Math.PI) * 0.6 + 0.25
    const amplitude =
      midY * envelope * (0.55 + 0.45 * Math.sin(phase + Math.sin(phase * 0.5)))
    top.push(`${x.toFixed(2)},${(midY - amplitude).toFixed(2)}`)
    bottom.push(`${x.toFixed(2)},${(midY + amplitude).toFixed(2)}`)
  }
  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`
}

const WAVEFORM_SHORT = buildWaveformPath(220, 0.4)
const WAVEFORM_LONG = buildWaveformPath(360, 1.1)
const WAVEFORM_SPARSE = buildWaveformPath(180, 2.2)

const SPEAKING_CRITERIA: BandScoreBreakdown = {
  primary: 7.0,
  criteria: [
    { criterionKey: 'criterion.fluency', score: 7 },
    { criterionKey: 'criterion.lexical', score: 7 },
    { criterionKey: 'criterion.grammar', score: 6.5 },
    { criterionKey: 'criterion.pronunciation', score: 7.5 },
  ],
}

const BASELINE_COMMENTS: ReadonlyArray<TimestampedComment> = [
  {
    id: 'sp-1',
    type: 'praise',
    timestamp: 18,
    criterionKey: 'criterion.fluency',
    body: 'Confident opening — natural pace and steady intonation.',
  },
  {
    id: 'sp-2',
    type: 'suggest',
    timestamp: 47,
    criterionKey: 'criterion.lexical',
    body: 'Could broaden vocabulary here — consider a synonym for "important".',
  },
  {
    id: 'sp-3',
    type: 'error',
    timestamp: 82,
    criterionKey: 'criterion.grammar',
    body: 'Past simple required: "I went" rather than "I goed".',
  },
  {
    id: 'sp-4',
    type: 'praise',
    timestamp: 110,
    criterionKey: 'criterion.pronunciation',
    body: 'Clear vowel articulation on long stressed syllables.',
  },
  {
    id: 'sp-5',
    type: 'suggest',
    timestamp: 135,
    criterionKey: 'criterion.fluency',
    body: 'Pause briefly before each contrast marker for clarity.',
  },
  {
    id: 'sp-6',
    type: 'error',
    timestamp: 158,
    criterionKey: 'criterion.grammar',
    body: 'Subject-verb disagreement when listing two items.',
  },
]

const meta = {
  title: 'domain/SpeakingGradingSurface',
  component: SpeakingGradingSurface,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SpeakingGradingSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    durationSec: 165,
    waveformPath: WAVEFORM_SHORT,
    comments: BASELINE_COMMENTS,
    score: SPEAKING_CRITERIA,
  },
}

export const LongRecording: Story = {
  args: {
    durationSec: 480,
    waveformPath: WAVEFORM_LONG,
    comments: BASELINE_COMMENTS.map((comment, index) => ({
      ...comment,
      timestamp: 30 + index * 75,
    })),
    score: SPEAKING_CRITERIA,
  },
}

export const MinimalComments: Story = {
  args: {
    durationSec: 110,
    waveformPath: WAVEFORM_SPARSE,
    comments: [BASELINE_COMMENTS[0], BASELINE_COMMENTS[3]],
    score: { ...SPEAKING_CRITERIA, primary: 8.0 },
  },
}

export const Loading: Story = {
  args: {
    durationSec: 60,
    waveformPath: WAVEFORM_SHORT,
    comments: [],
    score: SPEAKING_CRITERIA,
  },
  render: () => (
    <div
      role="status"
      aria-label="Loading speaking grading surface"
      className="grid grid-cols-1 gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-6 md:grid-cols-[3fr_2fr]"
    >
      <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
      <div className="space-y-3">
        <div className="h-20 w-full animate-pulse rounded-lg bg-muted/80" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-muted/60" />
      </div>
    </div>
  ),
}

export const Empty: Story = {
  args: {
    durationSec: 0,
    waveformPath: 'M0,40 L600,40 Z',
    comments: [],
    score: { primary: 0, criteria: SPEAKING_CRITERIA.criteria.map((c) => ({ ...c, score: 0 })) },
  },
  render: () => (
    <EmptyStatePlaceholder
      headline="No recording yet"
      body="This student has not submitted a speaking response."
    />
  ),
}

export const Error: Story = {
  args: {
    durationSec: 0,
    waveformPath: 'M0,40 L600,40 Z',
    comments: [],
    score: SPEAKING_CRITERIA,
  },
  render: () => (
    <ErrorStatePlaceholder
      message="The recording failed to load. Try again."
      retryLabel="Reload recording"
      onRetry={() => {}}
    />
  ),
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    durationSec: 165,
    waveformPath: WAVEFORM_SHORT,
    score: SPEAKING_CRITERIA,
    comments: BASELINE_COMMENTS.map((comment) => ({
      ...comment,
      body:
        comment.type === 'error'
          ? 'Sai động từ ở thì quá khứ — dùng "đã đi" thay vì "đi đã".'
          : comment.type === 'praise'
            ? 'Mở đầu tự tin — nhịp nói tự nhiên và ngữ điệu ổn định.'
            : 'Có thể mở rộng vốn từ — cân nhắc một từ đồng nghĩa cho "quan trọng".',
    })),
  },
}
