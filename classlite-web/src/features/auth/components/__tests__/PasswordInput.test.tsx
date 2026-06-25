/**
 * PasswordInput — 5 tests per Story 1-8 AC1.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import PasswordInput from '@/features/auth/components/PasswordInput'
import { assertI18nParity } from '@/lib/test/i18n-parity'

function renderInput(props: Partial<React.ComponentProps<typeof PasswordInput>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <PasswordInput aria-label="Password" {...props} />
    </I18nextProvider>,
  )
}

describe('PasswordInput (Story 1-8 AC1)', () => {
  test('defaults to type="password"', () => {
    renderInput()
    const field = screen.getByLabelText('Password') as HTMLInputElement
    expect(field.type).toBe('password')
  })

  test('clicking the eye toggle swaps to type="text"', async () => {
    const user = userEvent.setup()
    renderInput()
    const field = screen.getByLabelText('Password') as HTMLInputElement
    expect(field.type).toBe('password')
    await user.click(screen.getByTestId('password-toggle'))
    expect(field.type).toBe('text')
    await user.click(screen.getByTestId('password-toggle'))
    expect(field.type).toBe('password')
  })

  test('toggle aria-label resolves via t("auth.common.passwordToggleAria")', () => {
    renderInput()
    const toggle = screen.getByTestId('password-toggle')
    expect(toggle.getAttribute('aria-label')).toBe(
      i18n.t('auth.common.passwordToggleAria'),
    )
  })

  test('toggle aria-label exists in en + vi locales (parity)', () => {
    assertI18nParity(['auth.common.passwordToggleAria'])
  })

  test('vitest-axe returns zero violations', async () => {
    const { container } = renderInput()
    expect(await axe(container)).toHaveNoViolations()
  })
})
