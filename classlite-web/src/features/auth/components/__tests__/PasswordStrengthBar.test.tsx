/**
 * PasswordStrengthBar — 6 tests per Story 1-8 AC1.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import PasswordStrengthBar from '@/features/auth/components/PasswordStrengthBar'
import { assertI18nParity } from '@/lib/test/i18n-parity'

function renderBar(password: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <PasswordStrengthBar password={password} />
    </I18nextProvider>,
  )
}

describe('PasswordStrengthBar (Story 1-8 AC1)', () => {
  test('renders no visible bar when password is empty (still mounts the aria-live region)', () => {
    renderBar('')
    expect(screen.queryByTestId('password-strength-bar')).toBeNull()
    // Empty-state announcement key is wired even when the bar is hidden so
    // a screen reader observes the transition on first keystroke.
    expect(
      screen.getByTestId('password-strength-announcement').textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.empty'))
  })

  test('score 1 (weak) renders the weak announcement', () => {
    renderBar('abc') // <8 chars → 1
    expect(
      screen.getByTestId('password-strength-announcement').textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.weak'))
  })

  test('score 2 (fair) renders the fair announcement', () => {
    renderBar('password1234') // 12 chars, lowercase + number → 2
    expect(
      screen.getByTestId('password-strength-announcement').textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.fair'))
  })

  test('score 3 (strong) renders the strong announcement', () => {
    renderBar('Password1') // 9 chars, mixed + number → 3
    expect(
      screen.getByTestId('password-strength-announcement').textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.strong'))
  })

  test('score 4 (very strong) renders the veryStrong announcement', () => {
    renderBar('Password1$@xyz') // 14 chars, all diversity → 4
    expect(
      screen.getByTestId('password-strength-announcement').textContent,
    ).toBe(i18n.t('auth.common.passwordStrength.veryStrong'))
  })

  test('vitest-axe returns zero violations + i18n keys exist in en + vi', async () => {
    const { container } = renderBar('Password1$@xyz')
    expect(await axe(container)).toHaveNoViolations()
    assertI18nParity([
      'auth.common.passwordStrength.empty',
      'auth.common.passwordStrength.weak',
      'auth.common.passwordStrength.fair',
      'auth.common.passwordStrength.strong',
      'auth.common.passwordStrength.veryStrong',
    ])
  })
})
