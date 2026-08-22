/**
 * computePeaks — Story 6.3a (AC1 · D7). The pure downsample at the heart of the
 * from-scratch waveform: one normalized amplitude (peak magnitude, abs) per bucket.
 * Extracted as a PURE FUNCTION (no canvas, no AudioContext) so the waveform shape has
 * deterministic coverage independent of jsdom's missing Web-Audio/canvas.
 *
 * @param channelData decoded PCM samples in [-1, 1] (one channel).
 * @param buckets how many amplitude bars to produce.
 * @returns exactly `buckets` values, each in [0, 1]; an EMPTY Float32Array for
 *   degenerate input (empty data or buckets <= 0) — never a throw, never NaN (it
 *   renders during decode/SSR).
 */
export function computePeaks(channelData: Float32Array, buckets: number): Float32Array {
  if (channelData.length === 0 || buckets <= 0) return new Float32Array(0)
  const peaks = new Float32Array(buckets)
  const bucketSize = channelData.length / buckets
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * bucketSize)
    const end = Math.min(channelData.length, Math.floor((i + 1) * bucketSize))
    let peak = 0
    for (let j = start; j < end; j++) {
      const mag = Math.abs(channelData[j])
      if (mag > peak) peak = mag
    }
    peaks[i] = peak
  }
  return peaks
}
