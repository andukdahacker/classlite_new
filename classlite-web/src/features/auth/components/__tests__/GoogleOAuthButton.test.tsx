/**
 * GoogleOAuthButton — 5 tests per Story 1-8 AC1.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'

function renderButton(
  props: Partial<React.ComponentProps<typeof GoogleOAuthButton>> = {},
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <GoogleOAuthButton label={i18n.t('auth.login.googleCta')} {...props} />
    </I18nextProvider>,
  )
}

describe('GoogleOAuthButton (Story 1-8 AC1)', () => {
  test('renders an <a> with href /api/auth/google + role="link"', () => {
    renderButton()
    const link = screen.getByRole('link', {
      name: i18n.t('auth.login.googleCta'),
    })
    expect(link.getAttribute('href')).toBe('/api/auth/google')
  })

  test('label resolves via t("auth.login.googleCta")', () => {
    renderButton()
    expect(
      screen.getByRole('link', { name: i18n.t('auth.login.googleCta') }),
    ).toBeTruthy()
  })

  test('disabled prop renders aria-disabled="true" and styled disabled state', () => {
    renderButton({ disabled: true })
    const link = screen.getByTestId('google-oauth-cta')
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(link.className).toContain('pointer-events-none')
  })

  test('clicking sets aria-busy="true" for the nav-teardown moment (Sally amendment)', async () => {
    const user = userEvent.setup()
    renderButton()
    const link = screen.getByTestId('google-oauth-cta')
    expect(link.getAttribute('aria-busy')).toBeNull()
    // Prevent jsdom from actually navigating during the click.
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(link.getAttribute('aria-busy')).toBe('true')
  })

  test('vitest-axe returns zero violations', async () => {
    const { container } = renderButton()
    expect(await axe(container)).toHaveNoViolations()
  })
})
