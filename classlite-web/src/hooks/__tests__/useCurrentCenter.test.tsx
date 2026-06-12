/**
 * useCurrentCenter stub — Story 1-7c AC10.
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCurrentCenter } from '@/hooks/useCurrentCenter'

describe('useCurrentCenter (1-7c stub)', () => {
  test('returns null until Story 2-2 fills the real implementation', () => {
    const { result } = renderHook(() => useCurrentCenter())
    expect(result.current).toBeNull()
  })
})
