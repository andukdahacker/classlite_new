// Story 8-4b, Task 5 (AC3, D6) — the platform-aware ⌘K/Ctrl K glyph on the
// topbar SearchPill. The glyph is chosen from `isMacPlatform()` and rendered via
// i18n keys inside a real <kbd> (no hardcoded glyph).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { SearchPill } from '@/components/domain/SearchPill'
import { assertI18nParity } from '@/lib/test/i18n-parity'

function renderPill(onActivate?: () => void): void {
  render(
    <I18nextProvider i18n={i18n}>
      <SearchPill placeholderKey="topbar.search.placeholder" onActivate={onActivate} />
    </I18nextProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('SearchPill — platform glyph (AC3, D6)', () => {
  test('renders ⌘K on a Mac platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    renderPill()
    expect(screen.getByText(i18n.t('search.hint.mac'))).toBeInTheDocument()
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  test('renders Ctrl K on a non-Mac platform', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    renderPill()
    expect(screen.getByText(i18n.t('search.hint.other'))).toBeInTheDocument()
    expect(screen.getByText('Ctrl K')).toBeInTheDocument()
    expect(screen.queryByText('⌘K')).not.toBeInTheDocument()
  })

  test('the glyph lives in a real <kbd> element (honest a11y semantics)', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SearchPill placeholderKey="topbar.search.placeholder" />
      </I18nextProvider>,
    )
    const kbd = container.querySelector('kbd')
    expect(kbd).not.toBeNull()
    expect(kbd?.textContent).toBe('⌘K')
  })

  test('clicking the pill fires onActivate (the palette open trigger, AC2)', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    const onActivate = vi.fn()
    renderPill(onActivate)
    await userEvent.click(screen.getByTestId('search-pill'))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  test('both glyph i18n keys exist in en + vi', () => {
    assertI18nParity(['search.hint.mac', 'search.hint.other'])
  })
})
