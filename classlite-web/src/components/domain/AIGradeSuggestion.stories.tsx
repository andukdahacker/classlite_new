// storybook-rule: no-three-state
/**
 * AIGradeSuggestion — Story 6.2b (T3) visual stories. A pure presentational domain
 * component: the AI band-strip proposals + rail AI comment cards with per-item
 * Accept / Edit / Dismiss, teacher-only confidence/rationale, and "Accept all
 * praise". The Loading / Empty / Error trilogy for the AI panel lives in the FEATURE
 * wiring (skeletons + inline retry in WritingGradingPage), not in this leaf — hence
 * the three-state opt-out above.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import {
  AIGradeSuggestion,
  type AIGradeBandProposal,
  type AIGradeCommentProposal,
} from './AIGradeSuggestion'

const BANDS: AIGradeBandProposal[] = [
  { criterion: 'taskResponse', band: 6.5, rationale: 'Fully addresses the prompt with a clear position.', confidence: 'high' },
  { criterion: 'coherenceCohesion', band: 6, rationale: 'Logical progression; some referencing slips.', confidence: 'medium' },
  { criterion: 'lexicalResource', band: 7, rationale: 'Wide range with occasional imprecision.', confidence: 'high' },
  { criterion: 'grammaticalRange', band: 6.5, rationale: 'A mix of structures; minor errors persist.', confidence: 'medium' },
]

const COMMENTS: AIGradeCommentProposal[] = [
  { id: 'a0', type: 'error', criterion: 'grammaticalRange', text: 'Subject–verb agreement: "the data show".', confidence: 'high', anchored: true },
  { id: 'a1', type: 'praise', criterion: 'taskResponse', text: 'Strong, arguable thesis in the opening.', confidence: 'high', anchored: true },
  { id: 'a2', type: 'suggestion', criterion: 'lexicalResource', text: 'Vary your linking phrases beyond "moreover".', confidence: 'medium', anchored: false },
]

const handlers = {
  onAcceptBand: fn(),
  onDismissBand: fn(),
  onAcceptComment: fn(),
  onDismissComment: fn(),
  onAcceptAllPraise: fn(),
}

const meta: Meta<typeof AIGradeSuggestion> = {
  title: 'Domain/AIGradeSuggestion',
  component: AIGradeSuggestion,
  args: {
    bands: BANDS,
    comments: COMMENTS,
    overallBand: 6.5,
    analyzedWordCount: 287,
    latencyMs: 1400,
    ...handlers,
  },
}
export default meta

type Story = StoryObj<typeof AIGradeSuggestion>

/** The full review state — four band proposals + three anchored/general comments. */
export const Default: Story = {}

/** Some proposals already accepted into the draft (Applied / Added, no more actions). */
export const PartiallyAccepted: Story = {
  args: {
    bands: BANDS.map((b, i) => (i < 2 ? { ...b, accepted: true } : b)),
    comments: COMMENTS.map((c) => (c.type === 'praise' ? { ...c, accepted: true } : c)),
  },
}

/** No comment suggestions — only the band strip is reviewable. */
export const BandsOnly: Story = {
  args: { comments: [] },
}
