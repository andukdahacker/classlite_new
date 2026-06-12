/**
 * useRole stub — Story 1-7c AC10.
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRole } from '@/hooks/useRole'

describe('useRole (1-7c stub)', () => {
  test('returns null until Story 2-6 fills the real implementation', () => {
    const { result } = renderHook(() => useRole())
    expect(result.current).toBeNull()
  })
})
