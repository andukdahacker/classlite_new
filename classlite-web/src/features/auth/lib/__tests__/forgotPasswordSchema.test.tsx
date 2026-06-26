/**
 * useForgotPasswordSchema — Story 1-9b AC3. Two tests covering happy +
 * invalid format.
 *
 * Renders via I18nextProvider so `t()` resolves to the real en locale —
 * never hardcoded English (TEST-FE-4).
 */
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { useForgotPasswordSchema } from '@/features/auth/lib/forgotPasswordSchema'

function wrap({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children)
}

describe('useForgotPasswordSchema (Story 1-9b AC3)', () => {
  test('accepts a well-formed email', () => {
    const { result } = renderHook(() => useForgotPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({ email: 'alice@example.com' })
    expect(parsed.success).toBe(true)
  })

  test('rejects an empty email with the localized emailRequired key', () => {
    const { result } = renderHook(() => useForgotPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({ email: '' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.common.validation.emailRequired'))
  })

  test('rejects an invalid email format with the localized emailFormat key', () => {
    const { result } = renderHook(() => useForgotPasswordSchema(), {
      wrapper: wrap,
    })
    const parsed = result.current.safeParse({ email: 'not-an-email' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.common.validation.emailFormat'))
  })
})
