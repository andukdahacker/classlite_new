/**
 * useInviteSchema — Story 1-9c AC4. Four pinned tests: empty fullName /
 * whitespace-only fullName / short password / valid pair.
 *
 * Renders via I18nextProvider so `t()` resolves to the real en locale —
 * never hardcoded English (TEST-FE-4).
 */
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { useInviteSchema } from '@/features/auth/lib/inviteSchema'

function wrap({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children)
}

describe('useInviteSchema (Story 1-9c AC4)', () => {
  test('accepts a valid {fullName, password} pair', () => {
    const { result } = renderHook(() => useInviteSchema(), { wrapper: wrap })
    const parsed = result.current.safeParse({
      fullName: 'Linh Nguyen',
      password: 'goodPass123',
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects an empty fullName with the localized fullNameRequired key', () => {
    const { result } = renderHook(() => useInviteSchema(), { wrapper: wrap })
    const parsed = result.current.safeParse({
      fullName: '',
      password: 'goodPass123',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.invite.error.fullNameRequired'))
  })

  test('rejects a whitespace-only fullName via the .trim() refine', () => {
    const { result } = renderHook(() => useInviteSchema(), { wrapper: wrap })
    const parsed = result.current.safeParse({
      fullName: '   ',
      password: 'goodPass123',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.invite.error.fullNameRequired'))
  })

  test('rejects a short password with the localized passwordMin key', () => {
    const { result } = renderHook(() => useInviteSchema(), { wrapper: wrap })
    const parsed = result.current.safeParse({
      fullName: 'Linh Nguyen',
      password: 'short',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('expected parse failure')
    const messages = parsed.error.issues.map((issue) => issue.message)
    expect(messages).toContain(i18n.t('auth.common.validation.passwordMin'))
  })
})
