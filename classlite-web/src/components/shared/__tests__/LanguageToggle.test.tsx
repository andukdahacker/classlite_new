/**
 * LanguageToggle — i18n + a11y + store mutation contract (Story 1-7c AC6).
 */
import { describe, expect, test, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import LanguageToggle from '@/components/shared/LanguageToggle'
import { useLanguageStore } from '@/stores/languageStore'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import '@/lib/i18n'

describe('LanguageToggle', () => {
  beforeEach(() => {
    // TEST-FE-3 amendment: use the `.reset()` action so Zustand v5's
    // action surface stays intact.
    useLanguageStore.getState().reset()
  })

  test('renders both EN and VI segments with accessible names', () => {
    render(<LanguageToggle />)
    expect(screen.getByRole('button', { name: 'EN' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'VI' })).toBeDefined()
  })

  test('marks EN aria-pressed when store language is en (default)', () => {
    render(<LanguageToggle />)
    expect(
      screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'VI' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  test('marks VI aria-pressed after store language switches to vi', () => {
    useLanguageStore.getState().setLanguage('vi')
    render(<LanguageToggle />)
    expect(
      screen.getByRole('button', { name: 'VI' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  test('clicking VI mutates the store to language=vi', () => {
    render(<LanguageToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'VI' }))
    expect(useLanguageStore.getState().language).toBe('vi')
  })

  test('clicking EN mutates the store to language=en', () => {
    useLanguageStore.getState().setLanguage('vi')
    render(<LanguageToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(useLanguageStore.getState().language).toBe('en')
  })

  test('all i18n keys exist in en + vi', () => {
    assertI18nParity([
      'app.layout.languageToggle.aria',
      'app.layout.languageToggle.en',
      'app.layout.languageToggle.vi',
    ])
  })

  test('passes axe-core audit with zero violations', async () => {
    const { container } = render(<LanguageToggle />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
