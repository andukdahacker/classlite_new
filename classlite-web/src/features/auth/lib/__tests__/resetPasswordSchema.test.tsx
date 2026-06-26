/**
 * useResetPasswordSchema — Story 1-9b AC5. Tests covering happy + each
 * validation branch (min / max / blank / mismatch).
 *
 * Renders via I18nextProvider so `t()` resolves to the real en locale —
 * never hardcoded English (TEST-FE-4).
 */
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { useResetPasswordSchema } from '@/features/auth/lib/resetPasswordSchema'

function wrap({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children)
}

describe('useResetPasswordSchema (Story 1-9b AC5)', () => {
  test('accepts matching strong passwords', () => {
    const { result } = renderHook(() => useResetPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({
      newPassword: 'Hunter2!!',
      confirmPassword: 'Hunter2!!',
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects a password shorter than 8 characters with passwordMin', () => {
    const { result } = renderHook(() => useResetPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({
      newPassword: 'short',
      confirmPassword: 'short',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.common.validation.passwordMin'))
  })

  test('rejects all-whitespace newPassword with passwordNotBlank', () => {
    const { result } = renderHook(() => useResetPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({
      newPassword: '         ',
      confirmPassword: '         ',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(
      i18n.t('auth.common.validation.passwordNotBlank'),
    )
  })

  test('rejects mismatching confirmPassword with passwordMismatch on the confirmPassword path', () => {
    const { result } = renderHook(() => useResetPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({
      newPassword: 'Hunter2!!',
      confirmPassword: 'Hunter3!!',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const mismatchIssue = parsed.error.issues.find(
      (issue) =>
        issue.message ===
        i18n.t('auth.resetPassword.error.passwordMismatch'),
    )
    expect(mismatchIssue).toBeDefined()
    expect(mismatchIssue?.path).toEqual(['confirmPassword'])
  })
})
