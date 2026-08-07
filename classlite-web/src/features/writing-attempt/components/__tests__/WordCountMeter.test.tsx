// Story 5.3 Task 2 (AC6/AC7/AC18) — the live word-count meter: tracks the store,
// shows count/min + above/below delta, and re-renders in isolation on set.
import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import { createLiveTextStore } from '../../lib/liveTextStore'
import { WordCountMeter } from '../WordCountMeter'

function renderMeter(store = createLiveTextStore(''), min = 250) {
  render(
    <I18nextProvider i18n={i18n}>
      <WordCountMeter store={store} min={min} />
    </I18nextProvider>,
  )
  return store
}

describe('WordCountMeter (AC6/AC7)', () => {
  test('shows the count / min and a below-min delta when under length', () => {
    const store = createLiveTextStore('one two three')
    renderMeter(store, 250)
    expect(screen.getByTestId('writing-word-count')).toHaveAttribute('data-count', '3')
    expect(screen.getByTestId('writing-word-count')).toHaveAttribute(
      'data-below-min',
      'true',
    )
    expect(screen.getByTestId('writing-word-count-delta')).toHaveTextContent(
      i18n.t('writing.wordCount.belowMin', { n: 247 }),
    )
  })

  test('shows an above-min delta when at/over length', () => {
    const store = createLiveTextStore('a b c')
    renderMeter(store, 2)
    expect(screen.getByTestId('writing-word-count')).toHaveAttribute(
      'data-below-min',
      'false',
    )
    expect(screen.getByTestId('writing-word-count-delta')).toHaveTextContent(
      i18n.t('writing.wordCount.aboveMin', { n: 1 }),
    )
  })

  test('updates live when the store changes (decoupled from autosave, AC6)', () => {
    const store = renderMeter(createLiveTextStore(''), 5)
    expect(screen.getByTestId('writing-word-count')).toHaveAttribute('data-count', '0')
    act(() => store.set('now four words here'))
    expect(screen.getByTestId('writing-word-count')).toHaveAttribute('data-count', '4')
  })

  test('i18n keys exist in en + vi', () => {
    assertI18nParity([
      'writing.wordCount.countMin',
      'writing.wordCount.aboveMin',
      'writing.wordCount.belowMin',
    ])
  })
})
