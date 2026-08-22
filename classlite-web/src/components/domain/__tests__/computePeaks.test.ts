/**
 * Story 6.3a (AC1 · D7) — RED PHASE. The pure downsample at the heart of the
 * from-scratch waveform: computePeaks(channelData, buckets) → one normalized
 * amplitude per bucket. Tested as a PURE FUNCTION (no canvas, no AudioContext) so
 * the waveform's shape has deterministic coverage independent of jsdom's missing
 * Web-Audio/canvas (party: Murat).
 *
 * FAILS at import today: `@/components/domain/computePeaks` does not exist.
 *
 * SEAM (dev, green phase):
 *   - computePeaks(channelData: Float32Array, buckets: number): Float32Array
 *       · returns exactly `buckets` values
 *       · each value is the bucket's peak magnitude (abs), in [0, 1] for [-1, 1] input
 *       · silence → all ~0; a full-scale region → ~1
 *       · degenerate input (empty data or buckets <= 0) → empty Float32Array (no throw,
 *         no NaN — it renders during decode/SSR)
 */
import { describe, expect, test } from 'vitest'

import { computePeaks } from '@/components/domain/computePeaks'

describe('computePeaks — pure waveform downsample (AC1/D7)', () => {
  test('returns exactly `buckets` values', () => {
    const data = new Float32Array(1000).fill(0.5)
    expect(computePeaks(data, 64)).toHaveLength(64)
    expect(computePeaks(data, 200)).toHaveLength(200)
  })

  test('silence downsamples to ~0', () => {
    const peaks = computePeaks(new Float32Array(512), 16)
    for (const p of peaks) expect(p).toBeCloseTo(0, 5)
  })

  test('a full-scale signal downsamples to ~1 (peak magnitude, abs)', () => {
    const data = new Float32Array(512)
    for (let i = 0; i < data.length; i++) data[i] = i % 2 === 0 ? 1 : -1
    const peaks = computePeaks(data, 16)
    for (const p of peaks) expect(p).toBeCloseTo(1, 5)
  })

  test('captures the negative extreme (magnitude, not signed)', () => {
    const data = new Float32Array(100).fill(-0.8)
    const peaks = computePeaks(data, 4)
    for (const p of peaks) expect(p).toBeCloseTo(0.8, 5)
  })

  test('a loud region and a quiet region land in different buckets', () => {
    const data = new Float32Array(200)
    for (let i = 0; i < 100; i++) data[i] = 0.9 // loud first half
    // second half stays silent
    const peaks = computePeaks(data, 2)
    expect(peaks[0]).toBeGreaterThan(0.5)
    expect(peaks[1]).toBeCloseTo(0, 5)
  })

  test('degenerate input never throws or yields NaN (renders during decode/SSR)', () => {
    expect(computePeaks(new Float32Array(0), 32)).toHaveLength(0)
    expect(computePeaks(new Float32Array(100), 0)).toHaveLength(0)
    for (const p of computePeaks(new Float32Array(100).fill(0.5), 8)) {
      expect(Number.isFinite(p)).toBe(true)
    }
  })
})
