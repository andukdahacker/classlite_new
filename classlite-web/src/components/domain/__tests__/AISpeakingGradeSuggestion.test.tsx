/**
 * Story 6.3c (T3, T7) — AISpeakingGradeSuggestion domain surface. The band strip +
 * AiMomentCard are fully controlled (parent owns the draft merge), so they are exercised
 * directly via their callbacks. No MSW / no hook here (that is the page + hook suites);
 * this asserts the pure presentational contract: teacher-only confidence + rationale, the
 * exact disclaimer, per-item Accept/Edit/Dismiss, the null-timestamp general tag, and axe.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import {
  AiMomentCard,
  AiSpeakingBandStrip,
  type AiSpeakingBandProposal,
  type AiSpeakingMomentProposal,
} from '../AISpeakingGradeSuggestion'

function withI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

function bands(overrides: Partial<AiSpeakingBandProposal>[] = []): AiSpeakingBandProposal[] {
  const base: AiSpeakingBandProposal[] = [
    { criterion: 'fluencyCoherence', band: 6.5, rationale: 'Smooth delivery.', confidence: 'high' },
    { criterion: 'lexicalResource', band: 6, rationale: 'Range is adequate.', confidence: 'medium' },
    { criterion: 'grammaticalRange', band: 7, rationale: 'Varied structures.', confidence: 'high' },
    { criterion: 'pronunciation', band: 6.5, rationale: 'Clear sounds.', confidence: 'medium' },
  ]
  return base.map((b, i) => ({ ...b, ...(overrides[i] ?? {}) }))
}

function moment(overrides: Partial<AiSpeakingMomentProposal> = {}): AiSpeakingMomentProposal {
  return {
    id: 'm-1',
    type: 'praise',
    criterion: 'pronunciation',
    timestampMs: 4200,
    text: 'Clear /θ/ sound.',
    confidence: 'high',
    ...overrides,
  }
}

describe('AiSpeakingBandStrip (AC5)', () => {
  test('renders the four speaking criteria with teacher-only confidence + rationale + disclaimer + overall preview', () => {
    withI18n(
      <AiSpeakingBandStrip
        bands={bands()}
        overallBand={6.5}
        analyzedDurationMs={92_000}
        latencyMs={1800}
        onAcceptBand={vi.fn()}
        onDismissBand={vi.fn()}
      />,
    )
    // Four speaking criteria present; NO writing criterion (taskResponse) leaks in.
    expect(screen.getByText(i18n.t('criterion.fluencyCoherence'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('criterion.pronunciation'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('criterion.taskResponse'))).not.toBeInTheDocument()
    // Rationale (teacher-only) is shown for each criterion.
    expect(screen.getByTestId('ai-speaking-band-fluencyCoherence-rationale')).toHaveTextContent(
      'Smooth delivery.',
    )
    // Confidence badges (teacher-only) render (4 criteria).
    expect(screen.getAllByTestId('ai-confidence')).toHaveLength(4)
    // Overall preview + the exact acceptance-contract disclaimer.
    expect(screen.getByTestId('ai-speaking-overall-band')).toHaveTextContent('6.5')
    expect(screen.getByTestId('ai-speaking-disclaimer')).toHaveTextContent(
      'Suggestion — teacher always decides the final band.',
    )
  })

  test('Accept writes the criterion band; Dismiss drops the proposal', async () => {
    const user = userEvent.setup()
    const onAcceptBand = vi.fn()
    const onDismissBand = vi.fn()
    withI18n(
      <AiSpeakingBandStrip
        bands={bands()}
        overallBand={6.5}
        analyzedDurationMs={92_000}
        latencyMs={1800}
        onAcceptBand={onAcceptBand}
        onDismissBand={onDismissBand}
      />,
    )
    await user.click(screen.getByTestId('ai-speaking-band-fluencyCoherence-accept'))
    expect(onAcceptBand).toHaveBeenCalledWith('fluencyCoherence', 6.5)
    await user.click(screen.getByTestId('ai-speaking-band-lexicalResource-dismiss'))
    expect(onDismissBand).toHaveBeenCalledWith('lexicalResource')
  })

  test('an accepted band renders as "Applied" with no further actions', () => {
    withI18n(
      <AiSpeakingBandStrip
        bands={bands([{ accepted: true }])}
        overallBand={6.5}
        analyzedDurationMs={92_000}
        latencyMs={1800}
        onAcceptBand={vi.fn()}
        onDismissBand={vi.fn()}
      />,
    )
    expect(screen.getByTestId('ai-speaking-band-fluencyCoherence-applied')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-speaking-band-fluencyCoherence-accept')).not.toBeInTheDocument()
  })
})

describe('AiMomentCard (AC6/AC9)', () => {
  test('renders the AI avatar, teacher-only confidence, criterion + a timestamp seek', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    withI18n(<AiMomentCard moment={moment()} onSeek={onSeek} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ai-avatar')).toBeInTheDocument()
    expect(screen.getByTestId('ai-confidence')).toBeInTheDocument()
    const seek = screen.getByTestId('ai-moment-m-1-seek')
    expect(seek).toHaveTextContent('0:04')
    await user.click(seek)
    expect(onSeek).toHaveBeenCalledWith('m-1', 4200)
  })

  test('a null-timestamp moment renders in the general zone with NO seek button (AC6)', () => {
    withI18n(<AiMomentCard moment={moment({ timestampMs: null })} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ai-moment-m-1-general')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-moment-m-1-seek')).not.toBeInTheDocument()
  })

  test('Accept forwards the {type,criterion,text} core (confidence NOT included — AC9)', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    withI18n(<AiMomentCard moment={moment()} onSeek={vi.fn()} onAccept={onAccept} onDismiss={vi.fn()} />)
    await user.click(screen.getByTestId('ai-moment-m-1-accept'))
    expect(onAccept).toHaveBeenCalledWith('m-1', {
      type: 'praise',
      criterion: 'pronunciation',
      text: 'Clear /θ/ sound.',
    })
    // The accept payload carries no confidence/rationale — teacher-only, dropped here.
    expect(onAccept.mock.calls[0][1]).not.toHaveProperty('confidence')
  })

  test('Edit reports the editing transition up (so bulk accept-all-praise can skip it)', async () => {
    const user = userEvent.setup()
    const onEditingChange = vi.fn()
    withI18n(
      <AiMomentCard moment={moment()} onAccept={vi.fn()} onDismiss={vi.fn()} onEditingChange={onEditingChange} />,
    )
    await user.click(screen.getByTestId('ai-moment-m-1-edit'))
    expect(onEditingChange).toHaveBeenCalledWith('m-1', true)
    expect(screen.getByTestId('ai-moment-m-1-text')).toBeInTheDocument()
  })

  test('an accepted moment renders "Applied" with no further actions', () => {
    withI18n(<AiMomentCard moment={moment({ accepted: true })} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ai-moment-m-1-applied')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-moment-m-1-accept')).not.toBeInTheDocument()
  })
})

describe('AISpeakingGradeSuggestion a11y (AC20)', () => {
  test('the band strip has no axe violations', async () => {
    const { container } = withI18n(
      <AiSpeakingBandStrip
        bands={bands()}
        overallBand={6.5}
        analyzedDurationMs={92_000}
        latencyMs={1800}
        onAcceptBand={vi.fn()}
        onDismissBand={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('a moment card (in a list) has no axe violations', async () => {
    const { container } = withI18n(
      <ul>
        <li>
          <AiMomentCard moment={moment()} onSeek={vi.fn()} onAccept={vi.fn()} onDismiss={vi.fn()} />
        </li>
      </ul>,
    )
    const card = within(container).getByTestId('ai-moment-m-1')
    expect(card).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
