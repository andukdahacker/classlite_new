/**
 * useAuth stub — Story 1-7c AC10.
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from '@/hooks/useAuth'

describe('useAuth (1-7c stub)', () => {
  test('returns the no-session shape with all fields populated', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current).toEqual({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })
  })

  test('user is null until Story 1-8 fills the real implementation', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.user).toBeNull()
  })
})
