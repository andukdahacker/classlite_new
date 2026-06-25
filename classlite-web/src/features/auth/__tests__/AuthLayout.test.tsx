/**
 * AuthLayout — 5 tests per Story 1-8 AC6.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { MemoryRouter, Routes, Route } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import AuthLayout from '@/features/auth/AuthLayout'

function renderLayout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/x" element={<p data-testid="outlet-child">child</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('AuthLayout (Story 1-8 AC6)', () => {
  test('renders the <Outlet /> child', () => {
    renderLayout()
    expect(screen.getByTestId('outlet-child').textContent).toBe('child')
  })

  test('renders the ClassLite wordmark with localized brand aria-label', () => {
    renderLayout()
    const link = screen.getByTestId('auth-layout-wordmark')
    expect(link.getAttribute('aria-label')).toBe(i18n.t('sidebar.brand'))
    expect(link.textContent).toContain('ClassLite')
  })

  test('renders the LanguageToggle (desktop EN + VI segments via role queries)', () => {
    renderLayout()
    // Both the desktop and mobile variants mount in DOM; just assert the
    // EN button is reachable by role.
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('app.layout.languageToggle.en'),
      }).length,
    ).toBeGreaterThan(0)
  })

  test('mobile collapsed control: clicking the icon expands to the full segmented control', async () => {
    const user = userEvent.setup()
    renderLayout()
    const trigger = screen.getByTestId('mobile-language-collapsed')
    // Collapsed control carries the same aria-label key.
    expect(trigger.getAttribute('aria-label')).toBe(
      i18n.t('app.layout.languageToggle.aria'),
    )
    await user.click(trigger)
    // After expansion the mobile container no longer renders the
    // collapsed icon button; the segmented control replaces it.
    expect(screen.queryByTestId('mobile-language-collapsed')).toBeNull()
  })

  test('vitest-axe returns zero violations', async () => {
    const { container } = renderLayout()
    expect(await axe(container)).toHaveNoViolations()
  })
})
