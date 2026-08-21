// Story 6.2b T3 (AC4-8) — AIGradeSuggestion domain component. Pure presentational
// leaf (MSW-free): band-strip proposals + rail AI cards with per-item Accept/Edit/
// Dismiss, "Accept all praise", teacher-only confidence/rationale, general (orphan)
// rendering. Real i18n so key regressions surface (TEST-FE-4).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import {
  AIGradeSuggestion,
  type AIGradeBandProposal,
  type AIGradeCommentProposal,
  type AIGradeSuggestionProps,
} from '../AIGradeSuggestion'

function bands(overrides: Partial<AIGradeBandProposal>[] = []): AIGradeBandProposal[] {
  const base: AIGradeBandProposal[] = [
    { criterion: 'taskResponse', band: 6.5, rationale: 'Addresses the task.', confidence: 'high' },
    { criterion: 'coherenceCohesion', band: 6, rationale: 'Mostly cohesive.', confidence: 'medium' },
    { criterion: 'lexicalResource', band: 7, rationale: 'Good range.', confidence: 'high' },
    { criterion: 'grammaticalRange', band: 6.5, rationale: 'Some slips.', confidence: 'medium' },
  ]
  return base.map((b, i) => ({ ...b, ...overrides[i] }))
}

function comments(): AIGradeCommentProposal[] {
  return [
    { id: 'a0', type: 'error', criterion: 'grammaticalRange', text: 'Subject-verb agreement.', confidence: 'high', anchored: true },
    { id: 'a1', type: 'praise', criterion: 'taskResponse', text: 'Strong thesis.', confidence: 'high', anchored: true },
    { id: 'a2', type: 'suggestion', criterion: 'lexicalResource', text: 'Vary your linkers.', confidence: 'medium', anchored: false },
  ]
}

function renderPanel(overrides: Partial<AIGradeSuggestionProps> = {}) {
  const handlers = {
    onAcceptBand: vi.fn(),
    onDismissBand: vi.fn(),
    onAcceptComment: vi.fn(),
    onDismissComment: vi.fn(),
    onAcceptAllPraise: vi.fn(),
  }
  render(
    <I18nextProvider i18n={i18n}>
      <AIGradeSuggestion
        bands={bands()}
        comments={comments()}
        overallBand={6.5}
        analyzedWordCount={287}
        latencyMs={1400}
        {...handlers}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return handlers
}

describe('AIGradeSuggestion — band strip (AC4)', () => {
  test('renders the four criterion proposals with band, rationale, and teacher-only confidence', () => {
    renderPanel()
    for (const key of ['taskResponse', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange']) {
      expect(screen.getByTestId(`ai-band-proposal-${key}`)).toBeInTheDocument()
      expect(screen.getByTestId(`ai-band-${key}-rationale`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('ai-band-taskResponse-value')).toHaveTextContent('6.5')
    // Confidence badges are teacher-only chrome — present here (teacher panel).
    expect(screen.getAllByTestId('ai-confidence').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ai-overall-band')).toHaveTextContent('6.5')
    expect(screen.getByTestId('ai-analyzed-meta')).toHaveTextContent('287')
    expect(screen.getByTestId('ai-analyzed-meta')).toHaveTextContent('1.4')
    expect(screen.getByTestId('ai-disclaimer')).toHaveTextContent(
      i18n.t('grading.ai.disclaimer'),
    )
  })

  test('Accept writes the proposed band; Edit lets the teacher change it before applying', () => {
    const h = renderPanel()
    fireEvent.click(screen.getByTestId('ai-band-taskResponse-accept'))
    expect(h.onAcceptBand).toHaveBeenCalledWith('taskResponse', 6.5)

    // Edit → change to 7.0 → Accept applies the edited value.
    fireEvent.click(screen.getByTestId('ai-band-coherenceCohesion-edit'))
    fireEvent.change(screen.getByTestId('ai-band-coherenceCohesion-input'), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByTestId('ai-band-coherenceCohesion-accept'))
    expect(h.onAcceptBand).toHaveBeenLastCalledWith('coherenceCohesion', 7)
  })

  test('Dismiss drops the band proposal via the callback', () => {
    const h = renderPanel()
    fireEvent.click(screen.getByTestId('ai-band-lexicalResource-dismiss'))
    expect(h.onDismissBand).toHaveBeenCalledWith('lexicalResource')
  })

  test('an accepted band shows Applied and no more actions (additive, no clobber)', () => {
    renderPanel({ bands: bands([{ accepted: true }]) })
    expect(screen.getByTestId('ai-band-taskResponse-applied')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-band-taskResponse-accept')).not.toBeInTheDocument()
  })
})

describe('AIGradeSuggestion — comment rail (AC5-7)', () => {
  test('AI comments render as cards with a gradient AI avatar + confidence + actions', () => {
    renderPanel()
    const card = screen.getByTestId('ai-comment-a0')
    expect(within(card).getByTestId('ai-avatar')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-confidence')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-comment-a0-accept')).toBeInTheDocument()
  })

  test('Accept appends the comment; Edit changes text/criterion before applying', () => {
    const h = renderPanel()
    fireEvent.click(screen.getByTestId('ai-comment-a0-accept'))
    expect(h.onAcceptComment).toHaveBeenCalledWith('a0', {
      type: 'error',
      criterion: 'grammaticalRange',
      text: 'Subject-verb agreement.',
    })

    fireEvent.click(screen.getByTestId('ai-comment-a1-edit'))
    fireEvent.change(screen.getByTestId('ai-comment-a1-text'), {
      target: { value: 'Excellent thesis statement.' },
    })
    fireEvent.click(screen.getByTestId('ai-comment-a1-accept'))
    expect(h.onAcceptComment).toHaveBeenLastCalledWith('a1', {
      type: 'praise',
      criterion: 'taskResponse',
      text: 'Excellent thesis statement.',
    })
  })

  test('an unanchored (orphan) suggestion renders as general feedback, never dropped (AC6)', () => {
    renderPanel()
    const orphan = screen.getByTestId('ai-comment-a2')
    expect(orphan).toHaveAttribute('data-anchored', 'false')
    expect(screen.getByTestId('ai-comment-a2-general')).toBeInTheDocument()
  })

  test('"Accept all praise" is offered while praise remains, and calls back (AC7)', () => {
    const h = renderPanel()
    fireEvent.click(screen.getByTestId('ai-accept-all-praise'))
    expect(h.onAcceptAllPraise).toHaveBeenCalledTimes(1)
  })

  test('"Accept all praise" disappears once every praise comment is accepted', () => {
    renderPanel({
      comments: comments().map((c) => (c.type === 'praise' ? { ...c, accepted: true } : c)),
    })
    expect(screen.queryByTestId('ai-accept-all-praise')).not.toBeInTheDocument()
  })
})

describe('AIGradeSuggestion — a11y (TEST-FE-5)', () => {
  test('no accessibility violations', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <AIGradeSuggestion
          bands={bands()}
          comments={comments()}
          overallBand={6.5}
          analyzedWordCount={287}
          latencyMs={1400}
          onAcceptBand={vi.fn()}
          onDismissBand={vi.fn()}
          onAcceptComment={vi.fn()}
          onDismissComment={vi.fn()}
          onAcceptAllPraise={vi.fn()}
        />
      </I18nextProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
